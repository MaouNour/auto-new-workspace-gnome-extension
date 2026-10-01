import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';

import {Store} from './ui/store.js';
import {generalPage, filteringPage} from './ui/general.js';
import {workspacesPage, applicationsPage, groupsPage, rulesPage} from './ui/collections.js';
import {jsonPage} from './ui/json.js';

// The JSON in GSettings is the single source of truth. Every tab below reads
// it and writes it back through the Store; the JSON tab is a live view of it.
export default class AutoNewWorkspacePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(780, 860);

        const toast = title => window.add_toast(new Adw.Toast({title}));
        const store = new Store(settings, toast);
        const ctx = {store, settings, toast, expanded: new Set()};

        [
            generalPage(ctx),
            workspacesPage(ctx),
            applicationsPage(ctx),
            groupsPage(ctx),
            rulesPage(ctx),
            filteringPage(ctx),
            jsonPage(ctx, window),
        ].forEach(p => window.add(p));

        window.connect('close-request', () => {
            store.destroy();
            return false;
        });
    }
}
