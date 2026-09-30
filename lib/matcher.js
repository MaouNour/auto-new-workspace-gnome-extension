// Pure JS (no GNOME imports). Patterns are compiled once per config change.

export const FIELDS = ['any', 'app', 'class', 'exec', 'title'];
export const MODES = ['exact', 'icase', 'glob', 'regex'];

// info property read by each field ('any' is handled separately)
const PROP = {app: 'appId', class: 'wmClass', exec: 'exec', title: 'title'};
const ANY_ORDER = ['appId', 'wmClass', 'exec']; // cheapest first, lazily evaluated

export function globToRegExp(glob, flags = '') {
    const src = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${src}$`, `s${flags}`);
}

/**
 * Accepts "firefox", "class:Foo", "title:*Mail*" or
 * {field, mode, pattern, ignoreCase}. Throws on invalid input.
 */
export function compileMatcher(spec, defaultMode = 'icase') {
    let field = 'any', mode = defaultMode, pattern, ignoreCase = false;

    if (typeof spec === 'string') {
        pattern = spec;
        const m = /^(any|app|class|exec|title):(.*)$/s.exec(spec);
        if (m)
            [, field, pattern] = m;
    } else if (spec && typeof spec === 'object' && typeof spec.pattern === 'string') {
        pattern = spec.pattern;
        field = spec.field ?? field;
        mode = spec.mode ?? mode;
        ignoreCase = !!spec.ignoreCase;
    } else {
        throw new Error('matcher must be a string or {pattern, field?, mode?}');
    }

    if (!FIELDS.includes(field))
        throw new Error(`unknown field "${field}"`);
    if (!MODES.includes(mode))
        throw new Error(`unknown mode "${mode}"`);

    // "firefox.desktop" and "firefox" are equivalent for app ids
    if (mode !== 'regex' && (field === 'app' || field === 'any'))
        pattern = pattern.replace(/\.desktop$/, '');

    let test;
    switch (mode) {
    case 'exact':
        test = v => v === pattern;
        break;
    case 'icase': {
        const p = pattern.toLowerCase();
        test = v => v.toLowerCase() === p;
        break;
    }
    case 'glob': {
        const re = globToRegExp(pattern, ignoreCase ? 'i' : '');
        test = v => re.test(v);
        break;
    }
    case 'regex': {
        const re = new RegExp(pattern, ignoreCase ? 'i' : '');
        test = v => re.test(v);
        break;
    }
    }
    return {field, mode, pattern, test};
}

export function matches(m, info) {
    if (m.field === 'any') {
        for (const p of ANY_ORDER) {
            const v = info[p];
            if (v && m.test(v))
                return true;
        }
        return false;
    }
    const v = info[PROP[m.field]];
    return !!v && m.test(v);
}

export const anyOf = ms => info => ms.some(m => matches(m, info));
export const allOf = ms => info => ms.every(m => matches(m, info));
