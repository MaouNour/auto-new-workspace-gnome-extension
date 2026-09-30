import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

// Resolved by name so a type missing in a given Mutter build is simply skipped.
const TYPE_NAMES = [
    'NORMAL', 'DESKTOP', 'DOCK', 'DIALOG', 'MODAL_DIALOG', 'TOOLBAR', 'MENU',
    'UTILITY', 'SPLASHSCREEN', 'DROPDOWN_MENU', 'POPUP_MENU', 'TOOLTIP',
    'NOTIFICATION', 'COMBO', 'DND', 'OVERRIDE_OTHER',
];
const TYPES = new Map();
for (const n of TYPE_NAMES) {
    if (Meta.WindowType[n] !== undefined)
        TYPES.set(Meta.WindowType[n], n);
}

/** Lazy view of a window: each field is read only if a rule needs it. */
export class WindowInfo {
    constructor(window, tracker) {
        this.window = window;
        this._tracker = tracker;
        this._app = undefined;
        this._appId = undefined;
        this._exec = undefined;
        this.type = TYPES.get(window.get_window_type()) ?? 'UNKNOWN';
    }

    get app() {
        if (this._app === undefined)
            this._app = this._tracker.get_window_app(this.window) ?? null;
        return this._app;
    }

    get appId() {
        if (this._appId === undefined)
            this._appId = this.app?.get_id()?.replace(/\.desktop$/, '') ?? null;
        return this._appId;
    }

    get wmClass() {
        return this.window.get_wm_class() ?? null;
    }

    get exec() {
        if (this._exec === undefined) {
            const path = this.app?.get_app_info()?.get_executable();
            this._exec = path ? GLib.path_get_basename(path) : null;
        }
        return this._exec;
    }

    get title() {
        return this.window.get_title() ?? '';
    }

    get transient() { return this.window.get_transient_for() !== null; }
    get skipTaskbar() { return this.window.is_skip_taskbar(); }
    get sticky() { return this.window.is_on_all_workspaces(); }
    get fullscreen() { return this.window.is_fullscreen(); }
    get overrideRedirect() { return this.window.is_override_redirect(); }

    /** Identity is known well enough to match rules. */
    get ready() {
        return !!(this.wmClass || this.app);
    }
}
