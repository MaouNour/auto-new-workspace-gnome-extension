import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {compileMatcher, specToState as parse, stateToSpec as serialize} from '../lib/matcher.js';

const CENTER = Gtk.Align.CENTER;
export const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// ---- simple rows (values are set BEFORE connecting, so no spurious writes) ----

export function switchRow(title, subtitle, value, cb) {
    const r = new Adw.SwitchRow({title, subtitle: subtitle ?? '', active: !!value});
    r.connect('notify::active', () => cb(r.active));
    return r;
}

export function comboRow(title, subtitle, labels, index, cb) {
    const r = new Adw.ComboRow({title, subtitle: subtitle ?? '', model: Gtk.StringList.new(labels)});
    r.selected = Math.max(0, index);
    r.connect('notify::selected', () => cb(r.selected));
    return r;
}

export function spinRow(title, subtitle, min, max, value, cb) {
    const r = new Adw.SpinRow({
        title, subtitle: subtitle ?? '',
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: 1, page_increment: 1, value: Math.min(max, Math.max(min, value ?? min))}),
    });
    r.connect('notify::value', () => cb(Math.round(r.value)));
    return r;
}

/** Text entry committed with Enter / the apply button (not per keystroke). */
export function entryRow(title, text, cb) {
    const r = new Adw.EntryRow({title, text: text ?? '', show_apply_button: true});
    r.connect('apply', () => cb(r.text.trim()));
    return r;
}

/** Inherit / Yes / No. cb(undefined | true | false). */
export function triRow(title, subtitle, value, cb) {
    return comboRow(title, subtitle, ['Inherit', 'Yes', 'No'],
        value === undefined ? 0 : value ? 1 : 2,
        i => cb(i === 0 ? undefined : i === 1));
}

/** Inherit + fixed values. cb(undefined | value). */
export function enumRow(title, subtitle, values, value, cb, unsetLabel = 'Inherit') {
    return comboRow(title, subtitle, [unsetLabel, ...values], value === undefined ? 0 : values.indexOf(value) + 1,
        i => cb(i === 0 ? undefined : values[i - 1]));
}

/** Required enum (no inherit). */
export function choiceRow(title, subtitle, values, value, cb) {
    return comboRow(title, subtitle, values, values.indexOf(value), i => cb(values[i]));
}

export function iconButton(icon, tooltip, cb, classes = ['flat']) {
    const b = new Gtk.Button({icon_name: icon, tooltip_text: tooltip, valign: CENTER});
    classes.forEach(c => b.add_css_class(c));
    b.connect('clicked', cb);
    return b;
}

export function buttonRow(title, buttons) {
    const r = new Adw.ActionRow({title});
    buttons.forEach(b => r.add_suffix(b));
    return r;
}

export function deleteRow(what, cb) {
    const b = new Gtk.Button({label: 'Delete', valign: CENTER});
    b.add_css_class('destructive-action');
    b.connect('clicked', cb);
    return buttonRow(`Delete this ${what}`, [b]);
}

// ---- range: optional [from, to] (1-based) ----------------------------------

export function rangeRow(title, subtitle, range, cb) {
    const on = Array.isArray(range) && range.length === 2;
    const ex = new Adw.ExpanderRow({title, subtitle: subtitle ?? '', show_enable_switch: true, enable_expansion: on});
    const lo = spinRow('From workspace', '', 1, 36, on ? range[0] : 1, () => commit());
    const hi = spinRow('To workspace', '', 1, 36, on ? range[1] : 12, () => commit());
    const commit = () => {
        if (!ex.enable_expansion)
            return cb(undefined);
        if (hi.value < lo.value)
            hi.value = lo.value;
        return cb([Math.round(lo.value), Math.round(hi.value)]);
    };
    ex.add_row(lo);
    ex.add_row(hi);
    ex.connect('notify::enable-expansion', commit);
    return ex;
}

// ---- matcher list -------------------------------------------------------------
// JSON shapes handled: "firefox", "class:Foo", "@group", {field, mode, pattern, ignoreCase}

const FIELDS = [
    ['any', 'Any (app / class / exec)'], ['app', 'App ID'], ['class', 'Window class'],
    ['exec', 'Executable'], ['title', 'Window title'], ['group', 'Group'],
];
const MODES = [
    ['default', false, 'Default method'], ['exact', false, 'Exact'], ['icase', false, 'Case-insensitive'],
    ['glob', false, 'Glob'], ['glob', true, 'Glob (ignore case)'],
    ['regex', false, 'Regex'], ['regex', true, 'Regex (ignore case)'],
];
/**
 * Expander with one row per matcher. Patterns commit on Enter/apply; invalid
 * regexes and unknown groups are flagged in red.
 * @param {*} value raw JSON value (string | object | array | undefined)
 * @param {function(Array):void} onChange called with the new raw array
 */
export function matcherList({title, subtitle, value, groupIds = [], allowGroups = true, defaultMode = 'icase', onChange}) {
    const states = (value === undefined || value === null ? [] : [].concat(value)).map(parse);
    const fields = allowGroups ? FIELDS : FIELDS.filter(f => f[0] !== 'group');
    const ex = new Adw.ExpanderRow({title, subtitle: ''});

    const summary = () => {
        const names = states.filter(s => s.raw === undefined && s.pattern)
            .map(s => s.field === 'group' ? `@${s.pattern}` : s.pattern);
        ex.subtitle = names.length ? names.join(', ') : (subtitle ?? 'none');
    };
    const commit = () => {
        summary();
        onChange(states.map(serialize).filter(x => x !== undefined));
    };

    const dropDown = (labels, index, cb) => {
        const d = new Gtk.DropDown({model: Gtk.StringList.new(labels), valign: CENTER});
        d.selected = Math.max(0, index);
        d.connect('notify::selected', () => cb(d.selected));
        return d;
    };

    const makeRow = s => {
        const remove = row => iconButton('edit-delete-symbolic', 'Remove', () => {
            states.splice(states.indexOf(s), 1);
            ex.remove(row);
            commit();
        });
        if (s.raw !== undefined) {
            const r = new Adw.ActionRow({title: JSON.stringify(s.raw), subtitle: 'Unsupported entry (kept as is)'});
            r.add_suffix(remove(r));
            return r;
        }

        const row = new Adw.EntryRow({title: 'Pattern', text: s.pattern, show_apply_button: true});
        const check = () => {
            let ok = true;
            if (s.field === 'group') {
                ok = !s.pattern || groupIds.includes(s.pattern);
            } else if (s.pattern) {
                try {
                    compileMatcher({pattern: s.pattern, field: s.field, mode: s.mode === 'default' ? defaultMode : s.mode, ignoreCase: s.ic});
                } catch (_e) {
                    ok = false;
                }
            }
            if (ok) row.remove_css_class('error'); else row.add_css_class('error');
        };

        const modeDd = dropDown(MODES.map(m => m[2]), MODES.findIndex(m => m[0] === s.mode && m[1] === s.ic), i => {
            [s.mode, s.ic] = MODES[i];
            commit(); check();
        });
        const fieldDd = dropDown(fields.map(f => f[1]), fields.findIndex(f => f[0] === s.field), i => {
            s.field = fields[i][0];
            modeDd.sensitive = s.field !== 'group';
            commit(); check();
        });
        modeDd.sensitive = s.field !== 'group';

        row.add_prefix(fieldDd);
        row.add_prefix(modeDd);
        row.add_suffix(remove(row));
        row.connect('apply', () => { s.pattern = row.text.trim(); commit(); check(); });
        check();
        return row;
    };

    const add = new Adw.ActionRow({title: 'Add matcher', activatable: true});
    add.add_prefix(new Gtk.Image({icon_name: 'list-add-symbolic'}));
    add.connect('activated', () => {
        const s = {field: 'any', mode: 'default', ic: false, pattern: ''};
        states.push(s);
        const r = makeRow(s);
        ex.add_row(r);
        r.grab_focus();
    });
    ex.add_row(add);
    states.forEach(s => ex.add_row(makeRow(s)));
    summary();
    return ex;
}
