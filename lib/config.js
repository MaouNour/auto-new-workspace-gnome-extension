// Pure JS (no GNOME imports). JSON config -> validated, compiled, sorted rules.
import {compileMatcher, anyOf, allOf} from './matcher.js';

export const DEFAULTS = {
    version: 1,
    matching: {mode: 'icase'},
    behavior: {
        follow: true,            // switch to the target workspace (original behavior)
        focus: false,            // also focus the window (implies follow)
        windows: 'own',          // dynamic targets: own | together
        enforce: 'new',          // new | first | always
        fallback: 'dynamic',     // when a target is unusable: dynamic | ignore
        handleExisting: false,   // sweep already-open windows on enable
        reevaluateOnChange: false,
    },
    filtering: {
        mode: 'blacklist',       // all | blacklist | whitelist
        blocklist: [],
        allowlist: [],
        precedence: ['window', 'app', 'static', 'list'],
    },
    exclude: {
        allowTypes: ['NORMAL'],
        ignoreTransient: true,
        ignoreSkipTaskbar: true,
        ignoreSticky: true,
        ignoreFullscreen: false,
    },
    dynamic: {reuse: 'any', pick: 'first', create: true, range: null},
    lifecycle: {cleanup: 'never', applyNames: false},
    limits: {min: 1, max: 0, maxManaged: 0, whenFull: 'leave'},
    layout: {override: false, vertical: false, rows: 1, columns: -1, corner: 'top-left'},
    groups: {},
    applications: {},
    workspaces: {},
    rules: [],
};

export const TIERS = ['window', 'app', 'static', 'list'];
const MAX_WS = 36; // Mutter's hard limit

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** Deep merge; arrays/scalars replaced, unknown keys preserved. */
export function merge(base, over) {
    const out = {};
    const o = isObj(over) ? over : {};
    for (const k of Object.keys(base)) {
        const b = base[k];
        if (isObj(b))
            out[k] = merge(b, o[k]);
        else if (o[k] !== undefined)
            out[k] = o[k];
        else
            out[k] = Array.isArray(b) ? b.slice() : b;
    }
    for (const k of Object.keys(o)) {
        if (!(k in out))
            out[k] = o[k];
    }
    return out;
}

export const withDefaults = raw => merge(DEFAULTS, raw);

export function getPath(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let o = obj;
    for (const k of keys)
        o = isObj(o[k]) ? o[k] : (o[k] = {});
    o[last] = value;
}

const oneOf = (v, allowed, dflt, path, errors) => {
    if (allowed.includes(v))
        return v;
    errors.push(`${path}: invalid "${v}", using "${dflt}"`);
    return dflt;
};
const int = (v, dflt, min, max) =>
    Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : dflt;

function readRange(r, path, errors) {
    if (r === null || r === undefined)
        return null;
    if (Array.isArray(r) && r.length === 2 && r.every(Number.isInteger) &&
        r[0] >= 1 && r[1] >= r[0])
        return {lo: Math.min(r[0], MAX_WS) - 1, hi: Math.min(r[1], MAX_WS) - 1};
    errors.push(`${path}.range: expected [lo, hi] (1-based, lo<=hi), ignored`);
    return null;
}

function readPolicy(p, base, path, errors) {
    return {
        reuse: oneOf(p.reuse ?? base.reuse, ['any', 'managed', 'never'], base.reuse, `${path}.reuse`, errors),
        pick: oneOf(p.pick ?? base.pick, ['first', 'last', 'nearest', 'current'], base.pick, `${path}.pick`, errors),
        create: p.create === undefined ? base.create : !!p.create,
        range: p.range === undefined ? base.range : readRange(p.range, path, errors),
    };
}

// Per-rule overridable options (merged over global `behavior`).
function readOptions(o, path, errors) {
    const out = {};
    if (!isObj(o))
        return out;
    if ('follow' in o) out.follow = !!o.follow;
    if ('focus' in o) out.focus = !!o.focus;
    if (o.windows !== undefined) out.windows = oneOf(o.windows, ['own', 'together'], 'own', `${path}.windows`, errors);
    if (o.enforce !== undefined) out.enforce = oneOf(o.enforce, ['new', 'first', 'always'], 'new', `${path}.enforce`, errors);
    if (o.fallback !== undefined) out.fallback = oneOf(o.fallback, ['dynamic', 'ignore'], 'dynamic', `${path}.fallback`, errors);
    return out;
}

function sanitizeSettings(cfg, errors) {
    const {behavior: b, filtering: f, exclude: x, lifecycle: l, limits: m, layout: y} = cfg;

    cfg.matching.mode = oneOf(cfg.matching.mode, ['exact', 'icase', 'glob', 'regex'], 'icase', 'matching.mode', errors);
    b.windows = oneOf(b.windows, ['own', 'together'], 'own', 'behavior.windows', errors);
    b.enforce = oneOf(b.enforce, ['new', 'first', 'always'], 'new', 'behavior.enforce', errors);
    b.fallback = oneOf(b.fallback, ['dynamic', 'ignore'], 'dynamic', 'behavior.fallback', errors);
    for (const k of ['follow', 'focus', 'handleExisting', 'reevaluateOnChange'])
        b[k] = !!b[k];

    f.mode = oneOf(f.mode, ['all', 'blacklist', 'whitelist'], 'blacklist', 'filtering.mode', errors);
    const prec = Array.isArray(f.precedence) ? f.precedence.filter(t => TIERS.includes(t)) : [];
    f.precedence = [...new Set([...prec, ...TIERS])];

    x.allowTypes = Array.isArray(x.allowTypes) ? x.allowTypes.filter(t => typeof t === 'string') : ['NORMAL'];
    for (const k of ['ignoreTransient', 'ignoreSkipTaskbar', 'ignoreSticky', 'ignoreFullscreen'])
        x[k] = !!x[k];

    cfg.dynamic = readPolicy(cfg.dynamic, DEFAULTS.dynamic, 'dynamic', errors);

    l.cleanup = oneOf(l.cleanup, ['never', 'managed'], 'never', 'lifecycle.cleanup', errors);
    l.applyNames = !!l.applyNames;

    m.min = int(m.min, 1, 1, MAX_WS);
    m.max = int(m.max, 0, 0, MAX_WS);           // 0 = GNOME's limit
    m.maxManaged = int(m.maxManaged, 0, 0, MAX_WS); // 0 = unlimited
    m.whenFull = oneOf(m.whenFull, ['leave', 'last'], 'leave', 'limits.whenFull', errors);

    y.override = !!y.override;
    y.vertical = !!y.vertical;
    y.corner = oneOf(y.corner, ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'top-left', 'layout.corner', errors);
    y.rows = int(y.rows, 1, -1, MAX_WS);
    y.columns = int(y.columns, -1, -1, MAX_WS);
    if (y.override && (y.rows === 0 || y.columns === 0 || (y.rows < 0 && y.columns < 0))) {
        errors.push('layout: rows/columns must be >=1 (at most one may be -1); override disabled');
        y.override = false;
    }
}

/**
 * @param {string|object} input  raw JSON text or object
 * @returns {{compiled: object, errors: string[]}} never throws
 */
export function compile(input) {
    const errors = [];
    let raw = input;
    if (typeof input === 'string') {
        try {
            raw = JSON.parse(input.trim() || '{}');
        } catch (e) {
            errors.push(`JSON: ${e.message}`);
            raw = {};
        }
    }
    if (!isObj(raw)) {
        errors.push('config must be a JSON object');
        raw = {};
    }

    const cfg = withDefaults(raw);
    sanitizeSettings(cfg, errors);
    const mode = cfg.matching.mode;
    let usesTitle = false;

    // ---- groups: named matcher sets, referenced as "@name"
    const groupM = new Map();
    const resolve = (list, path) => {
        const out = [];
        for (const item of [].concat(list ?? [])) {
            try {
                if (typeof item === 'string' && item.startsWith('@')) {
                    const g = groupM.get(item.slice(1));
                    if (!g)
                        throw new Error(`unknown group "${item.slice(1)}"`);
                    out.push(...g);
                } else {
                    out.push(compileMatcher(item, mode));
                }
            } catch (e) {
                errors.push(`${path}: ${e.message}`);
            }
        }
        if (out.some(m => m.field === 'title'))
            usesTitle = true;
        return out;
    };

    for (const [id, g] of Object.entries(cfg.groups)) {
        const ms = [];
        for (const item of [].concat(Array.isArray(g) ? g : g?.apps ?? [])) {
            try {
                ms.push(compileMatcher(item, mode));
            } catch (e) {
                errors.push(`groups.${id}: ${e.message}`);
            }
        }
        groupM.set(id, ms);
    }

    // ---- workspaces
    const workspaces = new Map();
    const reserved = new Set(), keep = new Set(), usedIdx = new Set();
    for (const [id, w] of Object.entries(cfg.workspaces)) {
        const path = `workspaces.${id}`;
        if (!isObj(w)) {
            errors.push(`${path}: must be an object`);
            continue;
        }
        if (w.enabled === false)
            continue;
        const type = oneOf(w.type ?? 'static', ['static', 'dynamic'], 'static', `${path}.type`, errors);
        const def = {
            id, type, priority: int(w.priority, 0, -1000, 1000),
            name: typeof w.name === 'string' && w.name ? w.name : null,
            options: readOptions(w.options, `${path}.options`, errors),
            apps: [].concat(w.apps ?? []), groups: [].concat(w.groups ?? []),
        };
        if ('orientation' in w || 'rows' in w || 'columns' in w || 'width' in w || 'height' in w)
            errors.push(`warning: ${path}: per-workspace layout is not supported by GNOME (only a global grid, see "layout"); ignored`);

        if (type === 'static') {
            const n = w.index ?? w.preferred_index;
            if (!Number.isInteger(n) || n < 1 || n > MAX_WS) {
                errors.push(`${path}: static workspace needs "index" 1..${MAX_WS}; skipped`);
                continue;
            }
            if (usedIdx.has(n)) {
                errors.push(`${path}: index ${n} already used by another workspace; skipped`);
                continue;
            }
            usedIdx.add(n);
            Object.assign(def, {
                index: n - 1,
                create: w.create === undefined ? true : !!w.create,
                keep: w.keep === undefined ? true : !!w.keep,
                reuseByOthers: !!w.reuseByOthers,
                shareApps: w.shareApps === undefined ? true : !!w.shareApps,
                shareWindows: w.shareWindows === undefined ? true : !!w.shareWindows,
            });
            if (!def.reuseByOthers)
                reserved.add(def.index);
            if (def.keep)
                keep.add(def.index);
        } else {
            def.policy = readPolicy(w, cfg.dynamic, path, errors);
        }
        workspaces.set(id, def);
    }

    // ---- entries
    const entries = [];
    const add = (tier, id, ms, all, action, workspace, priority, own) => {
        if (!ms.length) {
            errors.push(`${tier}:${id}: no valid matchers; skipped`);
            return;
        }
        entries.push({
            tier, id, priority, order: entries.length, action, workspace,
            test: all ? allOf(ms) : anyOf(ms),
            options: {...(workspaces.get(workspace)?.options), ...own},
        });
    };
    const actionOf = (r, path) => {
        const a = oneOf(r.action ?? (r.workspace ? 'assign' : 'dynamic'), ['assign', 'dynamic', 'ignore'], 'dynamic', `${path}.action`, errors);
        if (a === 'assign' && !workspaces.has(r.workspace)) {
            errors.push(`${path}: unknown workspace "${r.workspace}"; skipped`);
            return null;
        }
        return a;
    };

    cfg.rules.forEach((r, i) => {
        const id = r?.id ?? `rule${i + 1}`, path = `rules[${i}]`;
        if (!isObj(r) || r.enabled === false)
            return;
        const action = actionOf(r, path);
        if (action)
            add('window', id, resolve(r.match, `${path}.match`), !!r.all, action, r.workspace, int(r.priority, 0, -1000, 1000), readOptions(r.options ?? r, path, errors));
    });

    for (const [key, a] of Object.entries(cfg.applications)) {
        const path = `applications.${key}`;
        if (!isObj(a) || a.enabled === false)
            continue;
        const action = actionOf(a, path);
        if (action)
            add('app', key, resolve(a.match ?? key, `${path}.match`), !!a.all, action, a.workspace, int(a.priority, 0, -1000, 1000), readOptions(a.options ?? a, path, errors));
    }

    for (const def of workspaces.values()) {
        const refs = [...def.apps, ...def.groups.map(g => `@${g}`)];
        if (refs.length)
            add('static', def.id, resolve(refs, `workspaces.${def.id}`), false, 'assign', def.id, def.priority, {});
    }

    const f = cfg.filtering;
    if (f.mode !== 'all')
        add('list', 'blocklist', resolve(f.blocklist, 'filtering.blocklist'), false, 'ignore', null, 10, {});
    if (f.mode === 'whitelist')
        add('list', 'allowlist', resolve(f.allowlist, 'filtering.allowlist'), false, 'dynamic', null, 0, {});
    // empty list entries are expected, don't report them
    for (let i = errors.length - 1; i >= 0; i--) {
        if (/^list:(block|allow)list: no valid matchers/.test(errors[i]))
            errors.splice(i, 1);
    }

    const rank = Object.fromEntries(f.precedence.map((t, i) => [t, i]));
    entries.sort((a, b) => rank[a.tier] - rank[b.tier] || b.priority - a.priority || a.order - b.order);

    return {
        compiled: {
            settings: cfg, workspaces, entries, usesTitle, reserved, keep,
            unmatched: f.mode === 'whitelist' ? 'ignore' : 'dynamic',
        },
        errors,
    };
}
