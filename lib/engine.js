// Pure JS (no GNOME imports): WindowInfo -> Decision. No side effects.

const CACHE_MAX = 256;
const ignore = reason => ({move: false, action: 'ignore', workspace: null, options: {}, reason});

export class Engine {
    constructor(compiled) {
        this._c = compiled;
        this._cache = new Map();
    }

    /**
     * @param {object} info lazy window info (type, appId, wmClass, exec, title, flags)
     * @returns {{move:boolean, action:string, workspace:?string, options:object, reason:string}}
     */
    decide(info) {
        const x = this._c.settings.exclude;

        // Exclusions are hard: rules cannot pull GNOME UI / transient windows in.
        if (!x.allowTypes.includes(info.type))
            return ignore(`excluded:type:${info.type}`);
        if (info.overrideRedirect)
            return ignore('excluded:override-redirect');
        if (x.ignoreSkipTaskbar && info.skipTaskbar)
            return ignore('excluded:skip-taskbar');
        if (x.ignoreTransient && info.transient)
            return ignore('excluded:transient');
        if (x.ignoreSticky && info.sticky)
            return ignore('excluded:sticky');
        if (x.ignoreFullscreen && info.fullscreen)
            return ignore('excluded:fullscreen');

        // Title-based rules depend on volatile data: never cache those.
        const key = this._c.usesTitle ? null : `${info.appId}\0${info.wmClass}`;
        if (key !== null) {
            const hit = this._cache.get(key);
            if (hit)
                return hit;
        }

        const d = this._resolve(info);
        if (key !== null) {
            if (this._cache.size >= CACHE_MAX)
                this._cache.clear();
            this._cache.set(key, d);
        }
        return d;
    }

    _resolve(info) {
        // Entries are pre-sorted (tier -> priority -> order): first match wins.
        for (const e of this._c.entries) {
            if (!e.test(info))
                continue;
            return {
                move: e.action !== 'ignore',
                action: e.action,
                workspace: e.workspace,
                options: e.options,
                reason: `${e.tier}:${e.id} (prio ${e.priority})`,
            };
        }
        const move = this._c.unmatched === 'dynamic';
        return {
            move, action: move ? 'dynamic' : 'ignore', workspace: null, options: {},
            reason: `default:${this._c.settings.filtering.mode}`,
        };
    }
}
