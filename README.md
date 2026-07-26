# 🚀 Auto New Workspace

Automatically keeps new app windows organized by moving them to an available workspace.

## ✨ What it does

- Moves newly opened **taskbar-visible application windows** to a workspace with no windows.
- Creates a new workspace when all existing workspaces are already in use.
- Switches your view to the workspace where the new window was placed.

## 🚫 What it does *not* do

- It does not manage windows that are not shown in the taskbar (such as many dialogs/popups).
- It does not provide per-app rules or custom workspace mappings.
- It does not include a settings UI at this time.

## 🧩 Compatibility

- **Extension UUID:** `auto-new-workspace@maounour`
- **Name:** Auto New Workspace
- **Version:** 1
- **GNOME Shell:** 50

## 📦 Installation (local)

1. Create the extension directory:
   - `~/.local/share/gnome-shell/extensions/auto-new-workspace@maounour`
2. Copy this repository’s files into that directory.
3. Restart GNOME Shell:
   - On X11: press `Alt` + `F2`, type `r`, then press Enter.
   - On Wayland: log out and log back in.
4. Enable the extension:
   - Use the **Extensions** app, or
   - Run: `gnome-extensions enable auto-new-workspace@maounour`

## 🛠️ Building / Packaging

There is **no compile step** for this project.

Optional packaging command:

- `cd ~/.local/share/gnome-shell/extensions && zip -r auto-new-workspace@maounour.zip auto-new-workspace@maounour`

## 🤝 Contributing

Contributions are welcome!

- Keep changes focused and easy to review.
- Test behavior on GNOME Shell 50 when possible.
- Open a pull request with a clear summary of what changed and why.

## 🐞 Reporting bugs

Please include:

- GNOME Shell version
- Linux distribution
- Steps to reproduce
- Expected behavior
- Actual behavior
- Relevant logs or screenshots (if available)

