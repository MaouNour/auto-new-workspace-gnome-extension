import Adw from 'gi://Adw';

import {
    isObj, switchRow, choiceRow, enumRow, triRow, spinRow, entryRow, comboRow,
    matcherList, rangeRow, iconButton, buttonRow, deleteRow,
} from './fields.js';
import {dynamicPage, expander, emptyRow} from './page.js';

const arr = v => (v === undefined || v === null ? [] : [].concat(v));
const setKey = (o, k, v, dflt) => { if (v === undefined || v === dflt) delete o[k]; else o[k] = v; };
const uniqueKey = (obj, base) => { let i = 1; while (`${base}${i}` in obj) i++; return `${base}${i}`; };
const renameKey = (o, from, to) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k === from ? to : k, v]));
const addButton = cb => iconButton('list-add-symbolic', 'Add', cb);

// edit(fn[, structural]): runs fn(item, cfg) on the stored item located by `locate`
const editor = (ctx, locate) => (fn, structural = false) =>
    ctx.store.update(cfg => {
        const it = locate(cfg);
        return it === undefined || it === null ? false : fn(it, cfg);
    }, structural);

// ---- reference maintenance (rename/delete keep the rest of the config valid) ----

function eachMatcherHolder(cfg, fn) {
    for (const w of Object.values(cfg.workspaces ?? {})) if (isObj(w)) fn(w, 'apps');
    for (const a of Object.values(cfg.applications ?? {})) if (isObj(a)) fn(a, 'match');
    for (const r of arr(cfg.rules)) if (isObj(r)) fn(r, 'match');
    if (isObj(cfg.filtering)) { fn(cfg.filtering, 'blocklist'); fn(cfg.filtering, 'allowlist'); }
}

/** to = null removes the references */
function rewriteGroupRefs(cfg, from, to) {
    eachMatcherHolder(cfg, (h, k) => {
        if (h[k] === undefined)
            return;
        const old = arr(h[k]);
        const out = [];
        for (const m of old) {
            if (m !== `@${from}`) out.push(m);
            else if (to) out.push(`@${to}`);
        }
        if (out.length !== old.length || out.some((m, i) => m !== old[i]))
            h[k] = out;
    });
    for (const w of Object.values(cfg.workspaces ?? {})) {
        if (isObj(w) && w.groups !== undefined)
            w.groups = arr(w.groups).map(g => (g === from ? to : g)).filter(Boolean);
    }
}

function rewriteWorkspaceRefs(cfg, from, to) {
    for (const x of [...Object.values(cfg.applications ?? {}), ...arr(cfg.rules)]) {
        if (!isObj(x) || x.workspace !== from)
            continue;
        if (to) {
            x.workspace = to;
        } else {
            delete x.workspace;
            if (x.action === 'assign')
                delete x.action;
        }
    }
}

function renameIn(ctx, section, from, to, cascade) {
    if (!to || to === from)
        return;
    const ok = ctx.store.update(cfg => {
        const m = cfg[section];
        if (!isObj(m) || !(from in m))
            return false;
        if (to in m) {
            ctx.toast(`"${to}" already exists`);
            return false;
        }
        cfg[section] = renameKey(m, from, to);
        cascade?.(cfg);
    }, true);
    if (ok && ctx.expanded.delete(`${section}:${from}`))
        ctx.expanded.add(`${section}:${to}`);
}

// ---- shared row sets -----------------------------------------------------------

function optionRows(item, edit, wsMode) {
    const h = isObj(item.options) ? item.options : (wsMode ? {} : item);
    const set = (k, v) => edit(it => {
        let t = it;
        if (wsMode || isObj(it.options)) {
            if (!isObj(it.options))
                it.options = {};
            t = it.options;
        }
        setKey(t, k, v);
        if (t === it.options && !Object.keys(t).length)
            delete it.options;
    });
    return [
        triRow('Switch to the workspace', 'Inherit = global setting', h.follow, v => set('follow', v)),
        triRow('Focus the window', 'May steal focus', h.focus, v => set('focus', v)),
        enumRow('Windows on dynamic workspaces', 'own = one each, together = join the app\'s workspace', ['own', 'together'], h.windows, v => set('windows', v)),
        enumRow('Enforcement', 'new = only new windows, first = only the first window, always = move back after manual moves', ['new', 'first', 'always'], h.enforce, v => set('enforce', v)),
        enumRow('If the target is unavailable', '', ['dynamic', 'ignore'], h.fallback, v => set('fallback', v)),
    ];
}

function bindingRows(item, edit, wsIds) {
    const ids = [...wsIds];
    if (item.workspace && !ids.includes(item.workspace))
        ids.push(item.workspace);
    const labels = ['(none)', ...ids.map(i => (wsIds.includes(i) ? i : `${i} (missing)`))];
    return [
        enumRow('Action', 'Automatic = assign if a workspace is set, otherwise dynamic', ['assign', 'dynamic', 'ignore'],
            item.action, v => edit(it => setKey(it, 'action', v)), 'Automatic'),
        comboRow('Workspace', 'Target workspace (static workspace or dynamic pool)', labels,
            item.workspace ? ids.indexOf(item.workspace) + 1 : 0,
            i => edit(it => setKey(it, 'workspace', i === 0 ? undefined : ids[i - 1]))),
        spinRow('Priority', 'Higher wins within the same tier', -1000, 1000, item.priority ?? 0,
            v => edit(it => setKey(it, 'priority', v, 0))),
    ];
}

function matchRow(ctx, cfg, item, edit, title, subtitle) {
    return matcherList({
        title, subtitle, value: item.match, groupIds: Object.keys(cfg.groups ?? {}),
        defaultMode: cfg.matching?.mode ?? 'icase',
        onChange: v => edit(it => setKey(it, 'match', v.length ? v : undefined)),
    });
}

function collection(ctx, {title, icon, heading, description, empty, onAdd, items}) {
    return dynamicPage(ctx, {
        title, icon,
        build: (view, cfg) => {
            const g = new Adw.PreferencesGroup({title: heading, description});
            g.set_header_suffix(addButton(() => ctx.store.update(c => onAdd(c), true)));
            const rows = items(cfg);
            if (rows.length) rows.forEach(r => g.add(r)); else g.add(emptyRow(empty));
            return [g];
        },
    });
}

// ---- Groups ----------------------------------------------------------------------

export function groupsPage(ctx) {
    return collection(ctx, {
        title: 'Groups', icon: 'view-grid-symbolic', heading: 'Application groups',
        description: 'Named sets of applications. Use "@name" in any matcher list, or attach a group to a workspace.',
        empty: 'No groups yet. Press + to add one.',
        onAdd: c => {
            c.groups ??= {};
            const id = uniqueKey(c.groups, 'group');
            c.groups[id] = [];
            ctx.expanded.add(`groups:${id}`);
        },
        items: cfg => Object.entries(cfg.groups ?? {}).map(([id, val]) => {
            const members = Array.isArray(val) ? val : val?.apps;
            const ex = expander(ctx, `groups:${id}`, id, `${arr(members).length} application(s)`);
            ex.add_row(entryRow('Group ID', id, to => renameIn(ctx, 'groups', id, to, c => rewriteGroupRefs(c, id, to))));
            ex.add_row(matcherList({
                title: 'Members', subtitle: 'none', value: members, allowGroups: false,
                defaultMode: cfg.matching?.mode ?? 'icase',
                onChange: list => ctx.store.update(c => {
                    const cur = c.groups?.[id];
                    if (cur === undefined)
                        return false;
                    if (isObj(cur)) cur.apps = list; else c.groups[id] = list;
                }),
            }));
            ex.add_row(deleteRow('group', () => ctx.store.update(c => {
                delete c.groups[id];
                rewriteGroupRefs(c, id, null);
            }, true)));
            return ex;
        }),
    });
}

// ---- Workspaces ------------------------------------------------------------------

export function workspacesPage(ctx) {
    return collection(ctx, {
        title: 'Workspaces', icon: 'view-paged-symbolic', heading: 'Workspaces',
        description: 'Static: a fixed position reserved for its apps/groups (kept even when empty). Dynamic: a pool used for apps without a static workspace.',
        empty: 'No workspace rules yet. Press + to add one.',
        onAdd: c => {
            c.workspaces ??= {};
            const id = uniqueKey(c.workspaces, 'workspace');
            const used = new Set(Object.values(c.workspaces).map(w => w?.index ?? w?.preferred_index));
            let n = 1;
            while (used.has(n) && n < 36) n++;
            c.workspaces[id] = {type: 'static', name: `Workspace ${n}`, index: n};
            ctx.expanded.add(`workspaces:${id}`);
        },
        items: cfg => Object.entries(cfg.workspaces ?? {}).filter(([, w]) => isObj(w)).map(([id, w]) => {
            const isStatic = (w.type ?? 'static') === 'static';
            const edit = editor(ctx, c => c.workspaces?.[id]);
            const apps = [...arr(w.apps), ...arr(w.groups).map(g => `@${g}`)];
            const ex = expander(ctx, `workspaces:${id}`, w.name ? `${w.name} (${id})` : id,
                `${isStatic ? `static · position ${w.index ?? w.preferred_index ?? '?'}` : 'dynamic pool'}${apps.length ? ` · ${apps.join(', ')}` : ''}`);

            ex.add_row(entryRow('ID', id, to => renameIn(ctx, 'workspaces', id, to, c => rewriteWorkspaceRefs(c, id, to))));
            ex.add_row(switchRow('Enabled', '', w.enabled !== false, v => edit(it => setKey(it, 'enabled', v, true))));
            ex.add_row(choiceRow('Type', 'static = fixed position, dynamic = a pool of workspaces', ['static', 'dynamic'],
                isStatic ? 'static' : 'dynamic', v => edit(it => setKey(it, 'type', v, 'static'), true)));

            if (isStatic) {
                ex.add_row(entryRow('Name', w.name, v => edit(it => setKey(it, 'name', v || undefined), true)));
                ex.add_row(spinRow('Position', '1 = first workspace', 1, 36, w.index ?? w.preferred_index ?? 1,
                    v => edit(it => { it.index = v; delete it.preferred_index; })));
            }
            ex.add_row(spinRow('Priority', 'Higher wins when several workspaces claim the same app', -1000, 1000, w.priority ?? 0,
                v => edit(it => setKey(it, 'priority', v, 0))));

            ex.add_row(matcherList({
                title: 'Applications', subtitle: 'none', value: w.apps, groupIds: Object.keys(cfg.groups ?? {}),
                defaultMode: cfg.matching?.mode ?? 'icase',
                onChange: v => edit(it => setKey(it, 'apps', v.length ? v : undefined)),
            }));
            const groups = entryRow('Groups (comma separated ids)', arr(w.groups).join(', '), t => {
                const list = t.split(/[\s,]+/).filter(Boolean);
                edit(it => setKey(it, 'groups', list.length ? list : undefined), true);
            });
            if (arr(w.groups).some(g => !(g in (cfg.groups ?? {}))))
                groups.add_css_class('error');
            ex.add_row(groups);

            if (isStatic) {
                ex.add_row(switchRow('Create when missing', 'Create this workspace if GNOME has fewer', w.create !== false, v => edit(it => setKey(it, 'create', v, true))));
                ex.add_row(switchRow('Keep when empty', 'Never remove it automatically', w.keep !== false, v => edit(it => setKey(it, 'keep', v, true))));
                ex.add_row(switchRow('Reusable by other apps', 'Let dynamic windows use it when empty', !!w.reuseByOthers, v => edit(it => setKey(it, 'reuseByOthers', v, false))));
                ex.add_row(switchRow('Several apps may share it', 'Off = only one app at a time', w.shareApps !== false, v => edit(it => setKey(it, 'shareApps', v, true))));
                ex.add_row(switchRow('Several windows of an app may share it', 'Off = one window per app', w.shareWindows !== false, v => edit(it => setKey(it, 'shareWindows', v, true))));
            } else {
                ex.add_row(enumRow('Reuse empty workspaces', '', ['any', 'managed', 'never'], w.reuse, v => edit(it => setKey(it, 'reuse', v))));
                ex.add_row(enumRow('Preferred empty workspace', '', ['first', 'last', 'nearest', 'current'], w.pick, v => edit(it => setKey(it, 'pick', v))));
                ex.add_row(triRow('Create workspaces when needed', '', w.create, v => edit(it => setKey(it, 'create', v))));
                ex.add_row(rangeRow('Restrict to a range', 'Positions this pool may use', w.range, v => edit(it => setKey(it, 'range', v))));
            }

            optionRows(w, edit, true).forEach(r => ex.add_row(r));
            ex.add_row(deleteRow('workspace', () => ctx.store.update(c => {
                delete c.workspaces[id];
                rewriteWorkspaceRefs(c, id, null);
            }, true)));
            return ex;
        }),
    });
}

// ---- Applications ----------------------------------------------------------------

export function applicationsPage(ctx) {
    return collection(ctx, {
        title: 'Applications', icon: 'application-x-executable-symbolic', heading: 'Per-application rules',
        description: 'The name is also the default pattern (matches app id, window class or executable). Add matchers to be more specific.',
        empty: 'No application rules yet. Press + to add one.',
        onAdd: c => {
            c.applications ??= {};
            const key = uniqueKey(c.applications, 'app');
            c.applications[key] = {};
            ctx.expanded.add(`applications:${key}`);
        },
        items: cfg => {
            const wsIds = Object.keys(cfg.workspaces ?? {});
            return Object.entries(cfg.applications ?? {}).filter(([, a]) => isObj(a)).map(([key, a]) => {
                const edit = editor(ctx, c => c.applications?.[key]);
                const act = a.action ?? (a.workspace ? 'assign' : 'dynamic');
                const ex = expander(ctx, `applications:${key}`, key, `${act}${a.workspace ? ` → ${a.workspace}` : ''}`);
                ex.add_row(entryRow('Application name', key, to => renameIn(ctx, 'applications', key, to)));
                ex.add_row(switchRow('Enabled', '', a.enabled !== false, v => edit(it => setKey(it, 'enabled', v, true))));
                ex.add_row(matchRow(ctx, cfg, a, edit, 'Match (optional)', 'empty = use the name as pattern'));
                ex.add_row(switchRow('Require all matchers', 'Off = any matcher is enough', !!a.all, v => edit(it => setKey(it, 'all', v, false))));
                bindingRows(a, edit, wsIds).forEach(r => ex.add_row(r));
                optionRows(a, edit, false).forEach(r => ex.add_row(r));
                ex.add_row(deleteRow('application rule', () => ctx.store.update(c => { delete c.applications[key]; }, true)));
                return ex;
            });
        },
    });
}

// ---- Rules (window-level, highest tier by default) --------------------------------

const dropExpanded = ctx => [...ctx.expanded].filter(k => k.startsWith('rules:')).forEach(k => ctx.expanded.delete(k));

export function rulesPage(ctx) {
    return collection(ctx, {
        title: 'Rules', icon: 'view-list-symbolic', heading: 'Window rules',
        description: 'Most specific tier: match any field, including window title or class. Among equal priorities the earlier rule wins.',
        empty: 'No window rules yet. Press + to add one.',
        onAdd: c => {
            c.rules = arr(c.rules);
            c.rules.push({id: `rule${c.rules.length + 1}`, match: [], action: 'dynamic'});
            ctx.expanded.add(`rules:${c.rules.length - 1}`);
        },
        items: cfg => {
            const wsIds = Object.keys(cfg.workspaces ?? {});
            const rules = arr(cfg.rules);
            return rules.map((r, i) => {
                if (!isObj(r))
                    return null;
                const edit = editor(ctx, c => c.rules?.[i]);
                const act = r.action ?? (r.workspace ? 'assign' : 'dynamic');
                const ex = expander(ctx, `rules:${i}`, `${i + 1}. ${r.id ?? 'rule'}`, `${act}${r.workspace ? ` → ${r.workspace}` : ''}`);
                ex.add_row(entryRow('ID (optional label)', r.id, v => edit(it => setKey(it, 'id', v || undefined), true)));
                ex.add_row(switchRow('Enabled', '', r.enabled !== false, v => edit(it => setKey(it, 'enabled', v, true))));
                ex.add_row(matchRow(ctx, cfg, r, edit, 'Match', 'none'));
                ex.add_row(switchRow('Require all matchers', 'Off = any matcher is enough', !!r.all, v => edit(it => setKey(it, 'all', v, false))));
                bindingRows(r, edit, wsIds).forEach(x => ex.add_row(x));
                optionRows(r, edit, false).forEach(x => ex.add_row(x));

                const move = d => () => {
                    ctx.store.update(c => {
                        [c.rules[i], c.rules[i + d]] = [c.rules[i + d], c.rules[i]];
                    }, true);
                    const a = ctx.expanded.has(`rules:${i}`), b = ctx.expanded.has(`rules:${i + d}`);
                    ctx.expanded[b ? 'add' : 'delete'](`rules:${i}`);
                    ctx.expanded[a ? 'add' : 'delete'](`rules:${i + d}`);
                };
                const up = iconButton('go-up-symbolic', 'Earlier', move(-1));
                const down = iconButton('go-down-symbolic', 'Later', move(1));
                up.sensitive = i > 0;
                down.sensitive = i < rules.length - 1;
                ex.add_row(buttonRow('Order', [up, down]));
                ex.add_row(deleteRow('rule', () => {
                    dropExpanded(ctx);
                    ctx.store.update(c => { c.rules.splice(i, 1); }, true);
                }));
                return ex;
            }).filter(Boolean);
        },
    });
}
