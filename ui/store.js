import GLib from 'gi://GLib';
import {setPath, withDefaults} from '../lib/config.js';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/**
 * The JSON in GSettings is the only source of truth. The UI reads it, edits a
 * fresh copy and writes it back (unknown keys are preserved).
 *
 *  - update()/set(): write from a widget; other widgets are NOT rebuilt, so
 *    typing/focus is never disturbed.
 *  - update(fn, true): structural change (add/remove/rename): every page is
 *    rebuilt from the JSON (deferred to idle, never inside a widget callback).
 *  - external writes (dconf, reset, JSON tab, import) rebuild everything too.
 */
export class Store {
    constructor(settings, toast) {
        this.settings = settings;
        this.toast = toast;
        this._last = null;          // last text we wrote ourselves
        this._rebuild = new Set();
        this._any = new Set();
        this._idle = 0;
        this._id = settings.connect('changed::config-json', () => {
            if (this.text() === this._last)
                return;             // our own write
            this._last = this.text();
            this._any.forEach(f => f());
            this._scheduleRebuild();
        });
    }

    destroy() {
        this.settings.disconnect(this._id);
        if (this._idle)
            GLib.source_remove(this._idle);
        this._rebuild.clear();
        this._any.clear();
    }

    text() { return this.settings.get_string('config-json'); }

    /** Fresh parsed copy, or null if the JSON is invalid. */
    read() {
        try {
            const o = JSON.parse(this.text().trim() || '{}');
            return isObj(o) ? o : null;
        } catch (_e) {
            return null;
        }
    }

    /** Config with defaults applied (read-only use). */
    view() { return withDefaults(this.read() ?? {}); }

    onRebuild(fn) { this._rebuild.add(fn); }
    onAny(fn) { this._any.add(fn); }

    update(fn, structural = false) {
        const cfg = this.read();
        if (!cfg) {
            this.toast('Config JSON is invalid: fix it in the JSON tab first');
            return false;
        }
        if (fn(cfg) === false)
            return false;
        this._commit(JSON.stringify(cfg, null, 2), structural);
        return true;
    }

    set(path, value, structural = false) {
        return this.update(cfg => setPath(cfg, path, value), structural);
    }

    /** Replace the whole document (JSON tab / import). */
    replace(text) { this._commit(text, true); }

    _commit(text, structural) {
        this._last = text;
        this.settings.set_string('config-json', text);
        this._any.forEach(f => f());
        if (structural)
            this._scheduleRebuild();
    }

    _scheduleRebuild() {
        if (this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idle = 0;
            this._rebuild.forEach(f => f());
            return GLib.SOURCE_REMOVE;
        });
    }
}
