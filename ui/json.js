import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {compile} from '../lib/config.js';

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
    applications: {firefox: {workspace: 'browser', follow: true}},
    dynamic: {range: [4, 12], pick: 'first'},
    filtering: {mode: 'blacklist', blocklist: ['gnome-calculator', 'org.gnome.Settings']},
};

/** Live view of the same JSON the other tabs edit; also the place to paste/import. */
export function jsonPage(ctx, window) {
    const {store} = ctx;
    const page = new Adw.PreferencesPage({title: 'JSON', icon_name: 'text-x-generic-symbolic'});
    const group = new Adw.PreferencesGroup({
        title: 'Configuration (JSON)',
        description: 'This is exactly what the other tabs read and write. Edit here only if you prefer; press Apply. Problems found by the validator are listed below.',
    });

    const view = new Gtk.TextView({monospace: true, top_margin: 8, bottom_margin: 8, left_margin: 8, right_margin: 8});
    const scroller = new Gtk.ScrolledWindow({child: view, min_content_height: 420, hexpand: true});
    scroller.add_css_class('card');
    const status = new Gtk.Label({xalign: 0, wrap: true, selectable: true, margin_top: 6});

    const getText = () => view.buffer.get_text(view.buffer.get_start_iter(), view.buffer.get_end_iter(), false);
    const setText = t => { if (getText() !== t) view.buffer.set_text(t, -1); };
    const validate = text => {
        let errors;
        try {
            JSON.parse(text.trim() || '{}');
            errors = compile(text).errors;
        } catch (e) {
            status.label = `Invalid JSON: ${e.message}`;
            status.add_css_class('error');
            return;
        }
        status.remove_css_class('error');
        status.label = errors.length ? errors.join('\n') : 'Configuration OK';
    };
    const refresh = () => { setText(store.text()); validate(store.text()); };

    const button = (label, cb, css) => {
        const b = new Gtk.Button({label});
        if (css) b.add_css_class(css);
        b.connect('clicked', cb);
        return b;
    };
    const bar = new Gtk.Box({spacing: 6, margin_top: 6});
    bar.append(button('Apply', () => {
        const text = getText();
        try {
            JSON.parse(text.trim() || '{}');
        } catch (e) {
            validate(text);
            return;
        }
        store.replace(text);
        validate(text);
    }, 'suggested-action'));
    bar.append(button('Revert', refresh));
    bar.append(button('Insert example', () => { setText(JSON.stringify(EXAMPLE, null, 2)); validate(getText()); }));
    bar.append(button('Reset to defaults', () => { store.replace('{}'); ctx.toast('Configuration reset'); }));
    bar.append(button('Import…', () => importFile(window, t => { setText(t); validate(t); }, ctx.toast)));
    bar.append(button('Export…', () => exportFile(window, getText(), ctx.toast)));

    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    box.append(scroller);
    box.append(bar);
    box.append(status);
    group.add(box);
    page.add(group);

    refresh();
    store.onAny(refresh);
    return page;
}

function importFile(window, done, toast) {
    new Gtk.FileDialog({title: 'Import configuration'}).open(window, null, (dlg, res) => {
        try {
            const [, bytes] = dlg.open_finish(res).load_contents(null);
            done(new TextDecoder().decode(bytes));
            toast('Imported: review it and press Apply');
        } catch (e) {
            if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                toast(`Import failed: ${e.message}`);
        }
    });
}

function exportFile(window, text, toast) {
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
