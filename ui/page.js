import Adw from 'gi://Adw';

/**
 * A preferences page whose groups are rebuilt from the JSON whenever a
 * structural change or an external edit happens.
 * build(view, raw) -> Adw.PreferencesGroup[]   (view = with defaults, raw = as stored)
 */
export function dynamicPage(ctx, {title, icon, build}) {
    const page = new Adw.PreferencesPage({title, icon_name: icon});
    let groups = [];
    const fill = () => {
        groups.forEach(g => page.remove(g));
        const raw = ctx.store.read();
        groups = raw === null ? [invalidGroup()] : build(ctx.store.view(), raw);
        groups.forEach(g => page.add(g));
    };
    ctx.store.onRebuild(fill);
    fill();
    return page;
}

function invalidGroup() {
    const g = new Adw.PreferencesGroup();
    g.add(new Adw.ActionRow({
        title: 'The configuration JSON is invalid',
        subtitle: 'Fix it in the JSON tab (or press Reset there). Nothing here can be edited meanwhile.',
    }));
    return g;
}

/** ExpanderRow that remembers its open/closed state across rebuilds. */
export function expander(ctx, key, title, subtitle = '') {
    const ex = new Adw.ExpanderRow({title, subtitle, expanded: ctx.expanded.has(key)});
    ex.connect('notify::expanded', () => {
        if (ex.expanded) ctx.expanded.add(key); else ctx.expanded.delete(key);
    });
    return ex;
}

export function emptyRow(text) {
    return new Adw.ActionRow({title: text, sensitive: false});
}
