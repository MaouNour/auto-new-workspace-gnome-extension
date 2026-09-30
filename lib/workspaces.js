import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const MAX_WS = 36; // Mutter's hard limit

/**
 * All workspace mutations live here. It never polls: cleanup is triggered by a
 * `window-removed` handler that exists only on workspaces *we* created and only
 * when lifecycle.cleanup is enabled.
 */
export class WorkspaceManager {
    /** @param {?function(string):void} log  null when debug is off */
    constructor(log = null) {
        this._log = log;
        this._c = null;
        this._managed = new Map(); // Meta.Workspace -> 'window-removed' handler id (0 = none)
        this._cleanupId = 0;
        this._mutter = null;
        this._wmPrefs = null;
        this._origNames = null;
    }

    get _wm() {
        return global.workspace_manager;
    }

    setLog(log) {
        this._log = log;
    }

    setConfig(compiled) {
        this._c = compiled;
        for (const ws of this._managed.keys())
            this._syncHook(ws);
        this._applyNames();
    }

    destroy() {
        for (const [ws, id] of this._managed) {
            if (id)
                ws.disconnect(id);
        }
        this._managed.clear();
        if (this._cleanupId)
            GLib.source_remove(this._cleanupId);
        this._cleanupId = 0;
        this._restoreNames();
        this._c = this._mutter = this._wmPrefs = null;
    }

    // ---- queries -----------------------------------------------------------

    /** Does this window make its workspace "non-empty"? (sticky/skip-taskbar don't) */
    occupies(w) {
        return !w.is_on_all_workspaces() && !w.is_skip_taskbar();
    }

    isEmpty(ws, ignore = null) {
        return ws.list_windows().every(w => w === ignore || !this.occupies(w));
    }

    last() {
        return this._wm.get_workspace_by_index(this._wm.n_workspaces - 1);
    }

    // ---- targets -----------------------------------------------------------

    /** Static target by 0-based index; creates missing ones only if allowed. */
    forIndex(i, create) {
        while (this._wm.n_workspaces <= i) {
            if (!create || !this._canGrow())
                return null;
            this._append();
        }
        return this._wm.get_workspace_by_index(i);
    }

    /** Dynamic target per policy. `ignore` = the window being placed. */
    pickDynamic(policy, ignore) {
        const wm = this._wm;
        const cur = wm.get_active_workspace_index();
        const reserved = this._c.reserved;
        const lo = policy.range?.lo ?? 0;
        const hiMax = policy.range?.hi ?? MAX_WS - 1;

        if (policy.reuse !== 'never') {
            const cands = [];
            const hi = Math.min(hiMax, wm.n_workspaces - 1);
            for (let i = lo; i <= hi; i++) {
                if (reserved.has(i))
                    continue;
                const ws = wm.get_workspace_by_index(i);
                if (policy.reuse === 'managed' && !this._managed.has(ws))
                    continue;
                if (this.isEmpty(ws, ignore))
                    cands.push(i);
            }
            if (cands.length) {
                const i = this._choose(cands, policy.pick, cur);
                this._log?.(`reuse empty workspace ${i + 1}`);
                return wm.get_workspace_by_index(i);
            }
        }

        if (!policy.create)
            return null;
        // Grow; indices reserved for static workspaces (or below range) are
        // skipped by creating them empty, which is exactly their reservation.
        while (this._canGrow()) {
            const idx = wm.n_workspaces;
            if (idx > hiMax)
                return null;
            const ws = this._append();
            if (idx >= lo && !reserved.has(idx)) {
                this._log?.(`created workspace ${idx + 1}`);
                return ws;
            }
        }
        return null;
    }

    _choose(cands, pick, cur) {
        switch (pick) {
        case 'last':
            return cands[cands.length - 1];
        case 'current':
            if (cands.includes(cur))
                return cur;
            // fall through: nearest to the current workspace
        case 'nearest':
            return cands.reduce((b, i) => Math.abs(i - cur) < Math.abs(b - cur) ? i : b);
        default:
            return cands[0];
        }
    }

    // ---- creation & lifecycle ---------------------------------------------

    _canGrow() {
        const {max, maxManaged} = this._c.settings.limits;
        const n = this._wm.n_workspaces;
        if (n >= MAX_WS || (max && n >= max))
            return false;
        if (maxManaged) {
            this._prune();
            if (this._managed.size >= maxManaged)
                return false;
        }
        return true;
    }

    _append() {
        const wm = this._wm;
        const ws = wm.append_new_workspace(false, global.get_current_time()) ??
            wm.get_workspace_by_index(wm.n_workspaces - 1);
        this._managed.set(ws, 0);
        this._syncHook(ws);
        return ws;
    }

    _prune() {
        for (const ws of this._managed.keys()) {
            if (ws.index() < 0)
                this._managed.delete(ws);
        }
    }

    _syncHook(ws) {
        const want = this._c.settings.lifecycle.cleanup === 'managed';
        const id = this._managed.get(ws);
        if (want && !id)
            this._managed.set(ws, ws.connect('window-removed', () => this._scheduleCleanup()));
        else if (!want && id) {
            ws.disconnect(id);
            this._managed.set(ws, 0);
        }
    }

    _scheduleCleanup() {
        if (this._cleanupId)
            return;
        this._cleanupId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._cleanupId = 0;
            try {
                this._cleanup();
            } catch (e) {
                console.error('[AutoNewWorkspace] cleanup failed:', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Only when GNOME's own dynamic workspaces are off; otherwise Shell does it.
    _cleanup() {
        const s = this._c?.settings;
        if (!s || s.lifecycle.cleanup !== 'managed')
            return;
        this._mutter ??= new Gio.Settings({schema_id: 'org.gnome.mutter'});
        if (this._mutter.get_boolean('dynamic-workspaces'))
            return;

        const wm = this._wm;
        this._prune();
        for (const ws of [...this._managed.keys()]) {
            if (wm.n_workspaces <= s.limits.min)
                break;
            const i = ws.index();
            if (i < 0 || this._c.keep.has(i) || ws === wm.get_active_workspace() || !this.isEmpty(ws))
                continue;
            this._log?.(`cleanup: removing workspace ${i + 1}`);
            this._managed.delete(ws);
            wm.remove_workspace(ws, global.get_current_time());
        }
    }

    // ---- names (GNOME has no per-workspace API; uses wm preferences) --------

    _applyNames() {
        if (!this._c.settings.lifecycle.applyNames) {
            this._restoreNames();
            return;
        }
        this._wmPrefs ??= new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._origNames ??= this._wmPrefs.get_strv('workspace-names');
        const names = this._origNames.slice();
        for (const d of this._c.workspaces.values()) {
            if (d.type !== 'static' || !d.name)
                continue;
            while (names.length <= d.index)
                names.push('');
            names[d.index] = d.name;
        }
        this._wmPrefs.set_strv('workspace-names', names);
    }

    _restoreNames() {
        if (this._origNames && this._wmPrefs)
            this._wmPrefs.set_strv('workspace-names', this._origNames);
        this._origNames = null;
    }
}
