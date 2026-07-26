import GLib from "gi://GLib";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

export default class AutoNewWorkspaceExtension extends Extension {
  enable() {
    this._windowCreatedId = global.display.connect("window-created", (display, window) =>
      this._onWindowCreated(window),
    );
  }

  disable() {
    if (this._windowCreatedId) {
      global.display.disconnect(this._windowCreatedId);
      this._windowCreatedId = null;
    }
  }

  _onWindowCreated(window) {
    // Wait until GNOME has finished managing the window
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      if (!window) return GLib.SOURCE_REMOVE;

      // Ignore dialogs, popups, etc.
      if (window.skip_taskbar) return GLib.SOURCE_REMOVE;

      let workspaceManager = global.workspace_manager;

      // Find an empty workspace
      let target = null;

      for (let i = 0; i < workspaceManager.n_workspaces; i++) {
        let ws = workspaceManager.get_workspace_by_index(i);

        if (ws.list_windows().length === 0) {
          target = ws;
          break;
        }
      }

      // No empty workspace? Create one.
      if (!target) {
        workspaceManager.append_new_workspace(false, global.get_current_time());
        target = workspaceManager.get_workspace_by_index(workspaceManager.n_workspaces - 1);
      }

      window.change_workspace(target);

      // Optional: follow the window
      target.activate(global.get_current_time());

      return GLib.SOURCE_REMOVE;
    });
  }
}
