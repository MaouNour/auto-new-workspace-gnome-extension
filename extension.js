import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {compile} from './lib/config.js';
import {Engine} from './lib/engine.js';
import {WindowInfo} from './lib/identity.js';
import {WorkspaceManager} from './lib/workspaces.js';
import {applyLayout, resetLayout, applyWindowLayout} from './lib/layout.js';

// Used if a rule misbehaves: never leave a window unmanaged because of it.
const DEFAULT_DECISION = {move: true, action: 'dynamic', workspace: null, options: {}, reason: 'fail-safe default'};

export default class AutoNewWorkspaceExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._tracker = Shell.WindowTracker.get_default();
        this._ws = new WorkspaceManager();
        this._handled = new WeakSet();   // windows already decided
        this._pending = new Map();       // window -> {source, actor, id} (awaiting identity)
        this._enforced = new Map();      // window -> {index, ids} (opt-in enforce: always)
        this._moving = false;

        this._reload(false);
        this._settingIds = ['config-json', 'debug'].map(k =>
            this._settings.connect(`changed::${k}`, () => this._reload(true)));
        this._createdId = global.display.connect('window-created',
            (_display, window) => this._queue(window));

        if (this._c.settings.behavior.handleExisting)
            this._sweep();
    }

    disable() {
        global.display.disconnect(this._createdId);
        this._settingIds.forEach(id => this._settings.disconnect(id));

        for (const p of this._pending.values()) {
            if (p.source)
                GLib.source_remove(p.source);
            if (p.id) {
                try { p.actor.disconnect(p.id); } catch (_e) { /* actor already gone */ }
            }
        }
        for (const [w, rec] of this._enforced) {
            for (const id of rec.ids) {
                try { w.disconnect(id); } catch (_e) { /* window already gone */ }
            }
        }

        this._ws.destroy();
        resetLayout();
        this._pending = this._enforced = this._handled = null;
        this._ws = this._engine = this._c = this._tracker = this._settings = null;
    }

    // ---- configuration ------------------------------------------------------

    _reload(changed) {
        const {compiled, errors} = compile(this._settings.get_string('config-json'));
        this._c = compiled;
        this._engine = new Engine(compiled);
        this._log = this._settings.get_boolean('debug')
            ? m => console.log(`[AutoNewWorkspace] ${m}`) : null;

        this._ws.setLog(this._log);
        this._ws.setConfig(compiled);
        errors.forEach(e => this._log?.(`config: ${e}`));

        try {
            applyLayout(compiled.settings.layout);
        } catch (e) {
            console.error('[AutoNewWorkspace] layout override failed:', e);
        }

        if (changed && compiled.settings.behavior.reevaluateOnChange) {
            this._handled = new WeakSet();
            this._sweep();
        }
    }

    // ---- WindowMonitor ------------------------------------------------------

    // Let Mutter finish managing the window first (same idea as the original).
    _queue(window) {
        if (this._pending.has(window) || this._handled.has(window))
            return;
        const p = {source: 0, actor: null, id: 0};
        p.source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            p.source = 0;
            this._onIdle(window, p);
            return GLib.SOURCE_REMOVE;
        });
        this._pending.set(window, p);
    }

    _onIdle(window, p) {
        const actor = window.get_compositor_private();
        if (!actor) {                       // closed before we got to it
            this._pending.delete(window);
            return;
        }
        const info = new WindowInfo(window, this._tracker);
        // Identity (app / wm class) may not exist until the window maps: wait
        // for its first frame once, instead of guessing or polling.
        if (!info.ready && !actor.mapped) {
            p.actor = actor;
            p.id = actor.connect('first-frame', () => {
                actor.disconnect(p.id);
                p.id = 0;
                this._pending.delete(window);
                this._place(window, new WindowInfo(window, this._tracker), false);
            });
            return;
        }
        this._pending.delete(window);
        this._place(window, info, false);
    }

    _sweep() {
        for (const actor of global.get_window_actors()) {
            const w = actor.meta_window;
            if (w)
                this._place(w, new WindowInfo(w, this._tracker), true);
        }
    }

    // ---- decide + act -------------------------------------------------------

    _place(window, info, quiet) {
        if (this._handled.has(window))
            return;
        this._handled.add(window);
        try {
            const d = this._engine.decide(info);
            this._log?.(`${info.appId ?? info.wmClass ?? '?'} "${info.title}" [${info.type}] ` +
                `-> ${d.move ? `${d.action} ${d.workspace ?? ''}` : 'ignored'} | ${d.reason}`);
            if (d.move)
                this._apply(window, info, d, quiet);
        } catch (e) {
            console.error('[AutoNewWorkspace] failed, using default behavior:', e);
            try {
                this._apply(window, info, DEFAULT_DECISION, quiet);
            } catch (e2) {
                console.error('[AutoNewWorkspace] default behavior failed:', e2);
            }
        }
    }

    // WindowAction
    _apply(window, info, d, quiet) {
        const opts = {...this._c.settings.behavior, ...d.options};
        const def = d.workspace ? this._c.workspaces.get(d.workspace) : null;

        if (opts.enforce === 'first' && info.app &&
            info.app.get_windows().some(w => w !== window && this._ws.occupies(w))) {
            this._log?.('enforce:first -> app already has a window, leaving this one');
            return;
        }

        const ws = this._target(window, info, def, opts);
        if (!ws) {
            this._log?.('no target workspace, window left in place');
            return;
        }

        if (window.get_workspace() !== ws) {
            this._moving = true;
            try {
                window.change_workspace(ws);
            } finally {
                this._moving = false;
            }
        }

        if (!quiet) {
            const t = global.get_current_time();
            if (opts.focus)
                ws.activate_with_focus(window, t);
            else if (opts.follow)
                ws.activate(t);
        }

        applyWindowLayout(window, def);
        if (opts.enforce === 'always' && def?.type === 'static')
            this._enforce(window, def.index);
    }

    // ---- target resolution (WorkspaceManager does the GNOME work) -------------

    _target(window, info, def, opts) {
        if (def?.type === 'static') {
            const ws = this._ws.forIndex(def.index, def.create);
            if (ws && this._sharingOk(ws, def, window, info))
                return ws;
            this._log?.(`static workspace "${def.id}" (index ${def.index + 1}) unavailable`);
            return opts.fallback === 'ignore' ? null : this._dynamic(window, info, null, opts);
        }
        return this._dynamic(window, info, def, opts);
    }

    _dynamic(window, info, pool, opts) {
        if (opts.windows === 'together' && info.app) {
            for (const w of info.app.get_windows()) {
                const ws = w !== window && this._ws.occupies(w) ? w.get_workspace() : null;
                if (ws) {
                    this._log?.('windows:together -> joining the app\'s workspace');
                    return ws;
                }
            }
        }
        const ws = this._ws.pickDynamic(pool?.policy ?? this._c.settings.dynamic, window);
        if (ws)
            return ws;
        return this._c.settings.limits.whenFull === 'last' ? this._ws.last() : null;
    }

    _sharingOk(ws, def, window, info) {
        if (def.shareApps && def.shareWindows)
            return true;
        for (const w of ws.list_windows()) {
            if (w === window || !this._ws.occupies(w))
                continue;
            const same = !!info.app && this._tracker.get_window_app(w) === info.app;
            if (same ? !def.shareWindows : !def.shareApps)
                return false;
        }
        return true;
    }

    // ---- opt-in "enforce: always" (static targets only; avoids move loops) ---

    _enforce(window, index) {
        const rec = this._enforced.get(window);
        if (rec) {
            rec.index = index;
            return;
        }
        const ids = [
            window.connect('workspace-changed', () => this._reenforce(window)),
            window.connect('unmanaged', () => this._enforced.delete(window)),
        ];
        this._enforced.set(window, {index, ids});
    }

    _reenforce(window) {
        const rec = this._enforced.get(window);
        if (!rec || this._moving)
            return;
        const ws = this._ws.forIndex(rec.index, false);
        if (!ws || window.get_workspace() === ws)
            return;
        this._moving = true;
        try {
            window.change_workspace(ws);
        } finally {
            this._moving = false;
        }
    }
}
