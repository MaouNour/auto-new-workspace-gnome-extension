import Meta from 'gi://Meta';

// GNOME/Mutter supports ONE global workspace grid (rows/columns/corner/fill
// direction). Per-workspace size or orientation does not exist and is not faked.
// This module is also the future hook for a window-tiling subsystem.

const CORNERS = {
    'top-left': Meta.DisplayCorner.TOPLEFT,
    'top-right': Meta.DisplayCorner.TOPRIGHT,
    'bottom-left': Meta.DisplayCorner.BOTTOMLEFT,
    'bottom-right': Meta.DisplayCorner.BOTTOMRIGHT,
};

let _saved = null; // {rows, columns} as found before we touched anything

export function applyLayout(cfg) {
    const wm = global.workspace_manager;
    if (!cfg.override) {
        resetLayout();
        return;
    }
    _saved ??= {rows: wm.layout_rows, columns: wm.layout_columns};
    wm.override_workspace_layout(CORNERS[cfg.corner], cfg.vertical, cfg.rows, cfg.columns);
}

/** Restore what Shell had (rows/columns; corner/direction reset to top-left/row-major). */
export function resetLayout() {
    if (!_saved)
        return;
    global.workspace_manager.override_workspace_layout(
        Meta.DisplayCorner.TOPLEFT, false, _saved.rows, _saved.columns);
    _saved = null;
}

/**
 * Future tiling hook: called after a window is placed. Intentionally a no-op;
 * workspace assignment and window layout are separate concerns.
 */
export function applyWindowLayout(_window, _workspaceDef) {}
