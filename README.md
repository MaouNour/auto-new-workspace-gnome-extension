# Auto New Workspace

A GNOME Shell extension that automatically moves every newly created normal window to an empty workspace. If no empty workspace exists, it creates one and moves you to it.

## How it works

Based on `/home/runner/work/auto-new-workspace-gnome-extension/auto-new-workspace-gnome-extension/extension.js`:

- Listens to `global.display` `window-created` events.
- Waits for GNOME Shell to finish managing the new window (`GLib.idle_add`).
- Ignores special windows (like dialogs/popups) with `skip_taskbar`.
- Searches workspaces from index `0` to the last workspace.
- If an empty workspace is found, moves the new window there.
- If all workspaces are occupied, creates a new workspace and moves the window there.
- Activates the target workspace so your view follows the moved window.

## Metadata

Based on `/home/runner/work/auto-new-workspace-gnome-extension/auto-new-workspace-gnome-extension/metadata.json`:

- **UUID:** `auto-new-workspace@maounour`
- **Name:** `Auto New Workspace`
- **Description:** `Move every new window to an empty workspace.`
- **Supported GNOME Shell versions:** `50`
- **Extension version:** `1`

## Installation

### Option 1: Install from source (manual)

1. Clone this repository.
2. Copy the extension folder to your local GNOME extensions directory:

   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/auto-new-workspace@maounour
   cp /path/to/repo/metadata.json ~/.local/share/gnome-shell/extensions/auto-new-workspace@maounour/
   cp /path/to/repo/extension.js ~/.local/share/gnome-shell/extensions/auto-new-workspace@maounour/
   ```

3. Restart GNOME Shell session:
   - On X11: press `Alt+F2`, type `r`, press Enter.
   - On Wayland: log out and log back in.
4. Enable the extension using Extensions app or:

   ```bash
   gnome-extensions enable auto-new-workspace@maounour
   ```

## Development / Build

This project is plain JavaScript and JSON for GNOME Shell; no compile step is required.

Useful commands:

```bash
gnome-extensions disable auto-new-workspace@maounour
gnome-extensions enable auto-new-workspace@maounour
```

If you want to package a zip for distribution:

```bash
cd /path/to/repo
zip -r auto-new-workspace@maounour.zip extension.js metadata.json
```

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a branch for your change.
3. Keep changes focused and tested on GNOME Shell 50.
4. Open a pull request with a clear description.

## Filing bug reports

When opening an issue, please include:

- GNOME Shell version (`50` expected for this release)
- Distribution name and version
- Steps to reproduce
- Expected behavior
- Actual behavior
- Any relevant logs from GNOME Shell
