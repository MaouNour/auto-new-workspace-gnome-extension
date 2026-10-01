import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {getPath, TIERS} from '../lib/config.js';
import {switchRow, comboRow, choiceRow, spinRow, rangeRow, matcherList, iconButton} from './fields.js';
import {dynamicPage} from './page.js';

// Adding a global option = adding a row here.
const SECTIONS = [
    ['Window behavior', [
        {path: 'behavior.follow', type: 'bool', title: 'Switch to the target workspace'},
        {path: 'behavior.focus', type: 'bool', title: 'Focus the moved window', subtitle: 'May steal focus; implies switching'},
        {path: 'behavior.windows', type: 'enum', values: ['own', 'together'], title: 'Windows on dynamic workspaces', subtitle: 'own = one workspace per window, together = join the app\'s workspace'},
        {path: 'behavior.enforce', type: 'enum', values: ['new', 'first', 'always'], title: 'Enforcement', subtitle: 'new = only new windows (default), first = only an app\'s first window, always = move back after manual moves'},
        {path: 'behavior.fallback', type: 'enum', values: ['dynamic', 'ignore'], title: 'If a target is unavailable'},
        {path: 'behavior.handleExisting', type: 'bool', title: 'Handle already-open windows on start'},
        {path: 'behavior.reevaluateOnChange', type: 'bool', title: 'Re-evaluate open windows when the config changes'},
    ]],
    ['Dynamic workspaces', [
        {path: 'dynamic.reuse', type: 'enum', values: ['any', 'managed', 'never'], title: 'Reuse empty workspaces', subtitle: 'managed = only ones this extension created'},
        {path: 'dynamic.pick', type: 'enum', values: ['first', 'last', 'nearest', 'current'], title: 'Preferred empty workspace'},
        {path: 'dynamic.create', type: 'bool', title: 'Create workspaces when needed'},
        {path: 'dynamic.range', type: 'range', title: 'Restrict to a workspace range', subtitle: 'Dynamic windows only use these workspaces'},
    ]],
    ['Lifecycle & limits', [
        {path: 'lifecycle.cleanup', type: 'enum', values: ['never', 'managed'], title: 'Remove empty extension-created workspaces', subtitle: 'Only when GNOME\'s dynamic workspaces are off'},
        {path: 'lifecycle.applyNames', type: 'bool', title: 'Apply workspace names', subtitle: 'Writes GNOME\'s workspace-names; restored on disable'},
        {path: 'limits.min', type: 'int', min: 1, max: 36, title: 'Minimum workspaces kept'},
        {path: 'limits.max', type: 'int', min: 0, max: 36, title: 'Maximum workspaces', subtitle: '0 = GNOME\'s limit'},
        {path: 'limits.maxManaged', type: 'int', min: 0, max: 36, title: 'Maximum extension-created workspaces', subtitle: '0 = unlimited'},
        {path: 'limits.whenFull', type: 'enum', values: ['leave', 'last'], title: 'When a limit is reached', subtitle: 'leave = keep the window where it is, last = use the last workspace'},
    ]],
    ['Exclusions', [
        {path: 'exclude.allowTypes', type: 'types', title: 'Window types the extension may move', subtitle: 'Only normal windows by default'},
        {path: 'exclude.ignoreTransient', type: 'bool', title: 'Ignore transient windows'},
        {path: 'exclude.ignoreSkipTaskbar', type: 'bool', title: 'Ignore windows hidden from the taskbar'},
        {path: 'exclude.ignoreSticky', type: 'bool', title: 'Ignore windows on all workspaces'},
        {path: 'exclude.ignoreFullscreen', type: 'bool', title: 'Ignore fullscreen windows'},
    ]],
    ['Global workspace grid (advanced)', [
        {path: 'layout.override', type: 'bool', title: 'Override GNOME\'s workspace grid', subtitle: 'One global grid only; GNOME has no per-workspace layouts'},
        {path: 'layout.vertical', type: 'bool', title: 'Fill columns first'},
        {path: 'layout.corner', type: 'enum', values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], required: true, title: 'Starting corner'},
        {path: 'layout.rows', type: 'int', min: -1, max: 36, title: 'Rows', subtitle: '-1 = automatic'},
        {path: 'layout.columns', type: 'int', min: -1, max: 36, title: 'Columns', subtitle: '-1 = automatic'},
    ]],
    ['Debugging', [
        {type: 'debug', title: 'Debug logging', subtitle: 'journalctl -f -o cat /usr/bin/gnome-shell'},
    ]],
];

const WINDOW_TYPES = ['NORMAL', 'DIALOG', 'MODAL_DIALOG', 'UTILITY', 'SPLASHSCREEN', 'TOOLBAR'];

function rowFor(ctx, cfg, def) {
    const v = def.path ? getPath(cfg, def.path) : undefined;
    const set = value => ctx.store.set(def.path, value);

    switch (def.type) {
    case 'bool':
        return switchRow(def.title, def.subtitle, v, set);
    case 'enum':
        return choiceRow(def.title, def.subtitle, def.values, v, set);
    case 'int':
        return spinRow(def.title, def.subtitle, def.min, def.max, v, set);
    case 'range':
        return rangeRow(def.title, def.subtitle, v, set);
    case 'types': {
        const ex = new Adw.ExpanderRow({title: def.title, subtitle: def.subtitle});
        const cur = new Set(v);
        for (const t of WINDOW_TYPES) {
            ex.add_row(switchRow(t, '', cur.has(t), on => {
                if (on) cur.add(t); else cur.delete(t);
                // keep unknown types the user may have typed in the JSON
                set([...WINDOW_TYPES.filter(x => cur.has(x)), ...[...cur].filter(x => !WINDOW_TYPES.includes(x))]);
            }));
        }
        return ex;
    }
    case 'debug': {
        const r = new Adw.SwitchRow({title: def.title, subtitle: def.subtitle});
        ctx.settings.bind('debug', r, 'active', Gio.SettingsBindFlags.DEFAULT);
        return r;
    }
    }
    return comboRow(def.title, '', [], 0, () => {});
}

export function generalPage(ctx) {
    return dynamicPage(ctx, {
        title: 'General', icon: 'preferences-system-symbolic',
        build: cfg => SECTIONS.map(([title, rows]) => {
            const g = new Adw.PreferencesGroup({title});
            rows.forEach(def => g.add(rowFor(ctx, cfg, def)));
            return g;
        }),
    });
}

const TIER_INFO = {
    window: ['Window rules', 'Rules tab: match title, class, anything'],
    app: ['Application rules', 'Applications tab'],
    static: ['Static workspaces', 'Apps and groups listed on a workspace'],
    list: ['Block / allow lists', 'The lists on this page'],
};

export function filteringPage(ctx) {
    return dynamicPage(ctx, {
        title: 'Filtering', icon: 'funnel-symbolic',
        build: cfg => {
            const groupIds = Object.keys(cfg.groups ?? {});
            const mode = cfg.matching.mode;
            const list = (title, subtitle, path) => matcherList({
                title, subtitle, groupIds, defaultMode: mode, value: getPath(cfg, path),
                onChange: v => ctx.store.set(path, v),
            });

            const top = new Adw.PreferencesGroup({
                title: 'Filtering',
                description: 'What happens to a window that no rule claims.',
            });
            top.add(choiceRow('Mode', 'blacklist = move everything except the blocklist, whitelist = only the allowlist, all = ignore both lists',
                ['all', 'blacklist', 'whitelist'], cfg.filtering.mode, v => ctx.store.set('filtering.mode', v)));
            top.add(choiceRow('Default matching method', 'Used by patterns that do not choose their own',
                ['exact', 'icase', 'glob', 'regex'], mode, v => ctx.store.set('matching.mode', v, true)));

            const lists = new Adw.PreferencesGroup({title: 'Lists'});
            lists.add(list('Blocklist', 'never move these (used in blacklist and whitelist mode)', 'filtering.blocklist'));
            lists.add(list('Allowlist', 'only these are moved (whitelist mode)', 'filtering.allowlist'));

            const prec = new Adw.PreferencesGroup({
                title: 'Precedence',
                description: 'When several rules match, the highest tier wins; then priority; then list order. Move "Block / allow lists" to the top to make the blocklist absolute.',
            });
            const order = [...new Set([...cfg.filtering.precedence.filter(t => TIERS.includes(t)), ...TIERS])];
            order.forEach((tier, i) => {
                const r = new Adw.ActionRow({title: `${i + 1}. ${TIER_INFO[tier][0]}`, subtitle: TIER_INFO[tier][1]});
                const move = d => () => {
                    const o = order.slice();
                    [o[i], o[i + d]] = [o[i + d], o[i]];
                    ctx.store.set('filtering.precedence', o, true);
                };
                const up = iconButton('go-up-symbolic', 'Higher precedence', move(-1));
                const down = iconButton('go-down-symbolic', 'Lower precedence', move(1));
                up.sensitive = i > 0;
                down.sensitive = i < order.length - 1;
                r.add_suffix(up);
                r.add_suffix(down);
                prec.add(r);
            });
            return [top, lists, prec];
        },
    });
}
