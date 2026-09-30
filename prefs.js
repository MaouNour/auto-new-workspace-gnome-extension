import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {compile, withDefaults, getPath, setPath} from './lib/config.js';

// Global options are table-driven: adding an option = adding a row here.
// Rules (applications / groups / workspaces / rules) are edited as validated JSON.
const SECTIONS = [
    ['Window behavior', [
        {path: 'behavior.follow', type: 'bool', title: 'Switch to the target workspace'},
        {path: 'behavior.focus', type: 'bool', title: 'Focus the moved window', subtitle: 'May steal focus; implies switching'},
        {path: 'behavior.windows', type: 'enum', values: ['own', 'together'], title: 'Windows on dynamic workspaces', subtitle: 'own = one workspace per window, together = join the app\'s workspace'},
        {path: 'behavior.enforce', type: 'enum', values: ['new', 'first', 'always'], title: 'Enforcement', subtitle: 'new = only new windows (default), always = move back after manual moves'},
        {path: 'behavior.fallback', type: 'enum', values: ['dynamic', 'ignore'], title: 'If a target is unavailable'},
        {path: 'behavior.handleExisting', type: 'bool', title: 'Handle already-open windows on start'},
        {path: 'behavior.reevaluateOnChange', type: 'bool', title: 'Re-evaluate open windows when config changes'},
    ]],
    ['Filtering', [
        {path: 'filtering.mode', type: 'enum', values: ['all', 'blacklist', 'whitelist'], title: 'Mode', subtitle: 'blacklist = everything except the blocklist, whitelist = only the allowlist'},
        {path: 'matching.mode', type: 'enum', values: ['exact', 'icase', 'glob', 'regex'], title: 'Default matching method'},
    ]],
    ['Dynamic workspaces', [
        {path: 'dynamic.reuse', type: 'enum', values: ['any', 'managed', 'never'], title: 'Reuse empty workspaces'},
        {path: 'dynamic.pick', type: 'enum', values: ['first', 'last', 'nearest', 'current'], title: 'Preferred empty workspace'},
        {path: 'dynamic.create', type: 'bool', title: 'Create workspaces when needed'},
    ]],
    ['Lifecycle & limits', [
        {path: 'lifecycle.cleanup', type: 'enum', values: ['never', 'managed'], title: 'Remove empty extension-created workspaces', subtitle: 'Only when GNOME\'s dynamic workspaces are off'},
        {path: 'lifecycle.applyNames', type: 'bool', title: 'Apply workspace names', subtitle: 'Writes GNOME\'s workspace-names; restored on disable'},
        {path: 'limits.min', type: 'int', min: 1, max: 36, title: 'Minimum workspaces kept'},
        {path: 'limits.max', type: 'int', min: 0, max: 36, title: 'Maximum workspaces', subtitle: '0 = GNOME\'s limit'},
        {path: 'limits.maxManaged', type: 'int', min: 0, max: 36, title: 'Maximum extension-created workspaces', subtitle: '0 = unlimited'},
        {path: 'limits.whenFull', type: 'enum', values: ['leave', 'last'], title: 'When the limit is reached'},
    ]],
    ['Exclusions', [
        {path: 'exclude.ignoreTransient', type: 'bool', title: 'Ignore transient windows'},
        {path: 'exclude.ignoreSkipTaskbar', type: 'bool', title: 'Ignore windows hidden from the taskbar'},
        {path: 'exclude.ignoreSticky', type: 'bool', title: 'Ignore windows on all workspaces'},
        {path: 'exclude.ignoreFullscreen', type: 'bool', title: 'Ignore fullscreen windows'},
    ]],
    ['Global workspace grid (advanced)', [
        {path: 'layout.override', type: 'bool', title: 'Override GNOME\'s workspace grid', subtitle: 'One global grid only; per-workspace layouts are not supported by GNOME'},
        {path: 'layout.vertical', type: 'bool', title: 'Fill columns first'},
        {path: 'layout.rows', type: 'int', min: -1, max: 36, title: 'Rows', subtitle: '-1 = automatic'},
        {path: 'layout.columns', type: 'int', min: -1, max: 36, title: 'Columns', subtitle: '-1 = automatic'},
    ]],
];

const EXAMPLE = {
    groups: {
        dev: ['code', 'kitty', 'alacritty'],
        chat: ['discord', 'telegram', 'thunderbird'],
    },
    workspaces: {
        browser: {name: 'Browser', index: 1, apps: ['firefox', 'chromium']},
        develop: {name: 'Development', index: 2, groups: ['dev']},
        comms: {name: 'Communication', index: 3, groups: ['chat'], options: {follow: false}},
    },
    applications: {
        firefox: {workspace: 'browser', follow: true},
    },
    dynamic: {range: [4, 12], pick: 'first'},
    filtering: {mode: 'blacklist', blocklist: ['gnome-calculator', 'org.gnome.Settings']},
};

export default class AutoNewWorkspacePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(760, 820);

        const toast = title => window.add_toast(new Adw.Toast({title}));
        const readCfg = () => {
            try {
                const o = JSON.parse(settings.get_string('config-json').trim() || '{}');
                return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
            } catch (_e) {
                return null;
            }
        };
        const io = {
            get: path => getPath(withDefaults(readCfg() ?? {}), path),
            set: (path, value) => {
                const cfg = readCfg();
                if (!cfg) {
                    toast('Config JSON is invalid: fix it in the Rules tab first');
                    return;
                }
                setPath(cfg, path, value);
                settings.set_string('config-json', JSON.stringify(cfg, null, 2));
            },
        };

        // ---- General page ---------------------------------------------------
        const syncers = [];
        const general = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});
        for (const [title, rows] of SECTIONS) {
            const group = new Adw.PreferencesGroup({title});
            for (const def of rows)
                group.add(this._makeRow(def, io, syncers));
            general.add(group);
        }
        const adv = new Adw.PreferencesGroup({title: 'Debugging'});
        const dbg = new Adw.SwitchRow({title: 'Debug logging', subtitle: 'journalctl -f -o cat /usr/bin/gnome-shell'});
        settings.bind('debug', dbg, 'active', Gio.SettingsBindFlags.DEFAULT);
        adv.add(dbg);
        general.add(adv);
        window.add(general);

        // ---- Rules page -----------------------------------------------------
        const rules = new Adw.PreferencesPage({title: 'Rules', icon_name: 'view-list-symbolic'});
        const group = new Adw.PreferencesGroup({
            title: 'Applications, groups, workspaces, rules',
            description: 'Sparse JSON; missing keys use defaults. Matchers: "firefox", "class:Foo", "@group" or {"field","mode","pattern"}. See PRINCIPLES.md.',
        });

        const view = new Gtk.TextView({monospace: true, top_margin: 8, bottom_margin: 8, left_margin: 8, right_margin: 8});
        const scroller = new Gtk.ScrolledWindow({child: view, min_content_height: 380, hexpand: true});
        scroller.add_css_class('card');
        const status = new Gtk.Label({xalign: 0, wrap: true, selectable: true});
        status.add_css_class('dim-label');

        const getText = () => view.buffer.get_text(view.buffer.get_start_iter(), view.buffer.get_end_iter(), false);
        const setText = t => { if (getText() !== t) view.buffer.set_text(t, -1); };
        const validate = text => {
            const {errors} = compile(text);
            status.label = errors.length ? errors.join('\n') : 'Configuration OK';
            return errors;
        };
        const stored = () => settings.get_string('config-json');

        const button = (label, cb, cls) => {
            const b = new Gtk.Button({label});
            if (cls) b.add_css_class(cls);
            b.connect('clicked', cb);
            return b;
        };
        const bar = new Gtk.Box({spacing: 6, margin_top: 6});
        bar.append(button('Apply', () => {
            const text = getText();
            try {
                JSON.parse(text.trim() || '{}');
            } catch (e) {
                status.label = `Not applied, invalid JSON: ${e.message}`;
                return;
            }
            settings.set_string('config-json', text);
            validate(text);
        }, 'suggested-action'));
        bar.append(button('Revert', () => { setText(stored()); validate(stored()); }));
        bar.append(button('Insert example', () => { setText(JSON.stringify(EXAMPLE, null, 2)); validate(getText()); }));
        bar.append(button('Reset to defaults', () => { settings.reset('config-json'); toast('Configuration reset'); }));
        bar.append(button('Import…', () => this._importFile(window, t => { setText(t); validate(t); }, toast)));
        bar.append(button('Export…', () => this._exportFile(window, getText(), toast)));

        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        box.append(scroller);
        box.append(bar);
        box.append(status);
        group.add(box);
        rules.add(group);
        window.add(rules);

        setText(stored());
        validate(stored());

        const id = settings.connect('changed::config-json', () => {
            syncers.forEach(f => f());
            setText(stored());
            validate(stored());
        });
        window.connect('close-request', () => {
            settings.disconnect(id);
            return false;
        });
    }

    _makeRow(def, io, syncers) {
        let busy = false;
        const guarded = fn => () => { if (!busy) fn(); };
        const sync = fn => { syncers.push(() => { busy = true; fn(); busy = false; }); syncers.at(-1)(); };
        const common = {title: def.title, subtitle: def.subtitle ?? ''};
        let row;

        if (def.type === 'bool') {
            row = new Adw.SwitchRow(common);
            sync(() => { row.active = !!io.get(def.path); });
            row.connect('notify::active', guarded(() => io.set(def.path, row.active)));
        } else if (def.type === 'enum') {
            row = new Adw.ComboRow({...common, model: Gtk.StringList.new(def.values)});
            sync(() => { row.selected = Math.max(0, def.values.indexOf(io.get(def.path))); });
            row.connect('notify::selected', guarded(() => io.set(def.path, def.values[row.selected])));
        } else {
            row = new Adw.SpinRow({
                ...common,
                adjustment: new Gtk.Adjustment({lower: def.min, upper: def.max, step_increment: 1, page_increment: 1, value: def.min}),
            });
            sync(() => { row.value = io.get(def.path) ?? def.min; });
            row.connect('notify::value', guarded(() => io.set(def.path, Math.round(row.value))));
        }
        return row;
    }

    _importFile(window, done, toast) {
        new Gtk.FileDialog({title: 'Import configuration'}).open(window, null, (dlg, res) => {
            try {
                const [, bytes] = dlg.open_finish(res).load_contents(null);
                done(new TextDecoder().decode(bytes));
                toast('Imported: review and press Apply');
            } catch (e) {
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    toast(`Import failed: ${e.message}`);
            }
        });
    }

    _exportFile(window, text, toast) {
        const dlg = new Gtk.FileDialog({title: 'Export configuration', initial_name: 'auto-new-workspace.json'});
        dlg.save(window, null, (d, res) => {
            try {
                d.save_finish(res).replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);
                toast('Exported');
            } catch (e) {
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    toast(`Export failed: ${e.message}`);
            }
        });
    }
}
