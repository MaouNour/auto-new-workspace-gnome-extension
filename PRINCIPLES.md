# Auto New Workspace 2 — Principles & Architecture

Target: GNOME Shell 50, GJS ES modules. Default behavior = the original extension (new normal window → empty workspace, create one if needed, switch to it).

## 1. Principles

1. **Event-driven, idle when idle.** Signals only: `display::window-created` (+ a one-shot idle per new window). No polling, no recurring timers.
2. **Per-window work.** A new window is evaluated alone. No global rescans, except two opt-in sweeps (startup, config change).
3. **Pure core, thin adapter.** `matcher` / `config` / `engine` have no GNOME imports, so they are fast, cached and unit-testable (`tests/`). Only `identity`, `workspaces`, `layout` and `extension` touch GNOME.
4. **Data, not code.** Behavior comes from one JSON config. No hardcoded apps or workspaces.
5. **Deterministic.** Rules are compiled once into a single sorted list; the first match wins. Every decision carries a `reason` string.
6. **Don't fight the user.** Default is "place new windows only". Re-enforcement is opt-in per rule.
7. **Fail safe.** Invalid config → defaults + error list (shown in prefs / debug log). A failing rule falls back to the default dynamic behavior; a window is never left stuck because of an optional rule.
8. **Don't fake GNOME.** Unsupported features are flagged, not emulated (see §6).

## 2. Architecture

```
display::window-created
   └─ extension.js  WindowMonitor: queue → idle → (wait first-frame only if identity missing)
        ├─ identity.js    WindowInfo (lazy: app id, wm class, exec, title, flags)
        ├─ engine.js      decide(info) → {move, workspace, options, reason}   [pure, cached]
        │    ├─ matcher.js  exact | icase | glob | regex  (compiled once)
        │    └─ config.js   validate + compile JSON → sorted entry list     [pure]
        └─ workspaces.js  WorkspaceManager: static index / dynamic pick / create / cleanup / names
             layout.js     optional global grid override (+ tiling hook, no-op)
```

## 3. Rule model

Everything compiles to **entries**: `{tier, priority, order, test(info), action, workspace, options}`.

- Actions: `assign` (to a workspace id), `dynamic` (use a pool), `ignore`.
- Sources → tiers:
  - `rules[]` → **window** (any matcher incl. title/class; most specific)
  - `applications{}` → **app** (key is an alias; default matcher is the key itself)
  - `workspaces{}.apps/groups` → **static**
  - `filtering.blocklist/allowlist` → **list**
- `groups{}` are named matcher sets, referenced as `"@group"` anywhere a matcher list is accepted.
- Matcher: string (`"firefox"`, `"class:Foo"`, `"title:*Mail*"`) or `{field, mode, pattern, ignoreCase}`. Fields: `any` (app id | wm class | executable), `app`, `class`, `exec`, `title`.

### Precedence (deterministic)
Sort key: **tier order** → **priority (higher first)** → **config order (earlier first)**. First matching entry wins.
Default tier order: `window > app > static > list`, configurable via `filtering.precedence`. Put `"list"` first to make the blocklist absolute. No match → `filtering.mode`: `blacklist`/`all` = manage dynamically, `whitelist` = ignore.
Priority belongs to the thing that assigns (rule, app, workspace). Groups have none, so an app in several groups resolves by the priority of the workspaces that reference them.

Exclusions run **before** rules and are not overridable by them: window types (default only `NORMAL`), override-redirect, transient, skip-taskbar, sticky, optionally fullscreen. Exception: add a type to `exclude.allowTypes` to opt in.

## 4. Workspace lifecycle

- **Static** (`type: static`, 1-based `index`): fixed index, reserved while empty (`reuseByOthers:false`), created on demand (`create`), never cleaned up (`keep`), optional `shareApps` / `shareWindows` (if violated → `fallback`).
- **Dynamic pool** (`dynamic` section, overridable by a `type: dynamic` workspace entry): `reuse` any|managed|never, `pick` first|last|nearest|current, `create`, `range:[lo,hi]`. Empty-ness ignores the window being placed and sticky/skip-taskbar windows.
- **Limits**: `min`, `max`, `maxManaged`, `whenFull` (leave the window | use last).
- **Tracking**: extension-created workspaces are kept in a set (pruned lazily, no extra signal). A `window-removed` handler exists only on those, and only if `lifecycle.cleanup: "managed"`.
- **Cleanup** (opt-in) removes empty, non-kept, extension-created, non-active workspaces, **only when GNOME's own dynamic-workspaces is off** (otherwise GNOME does it; we never fight it).
- **Window grouping**: `windows: own | together` (dynamic targets; `together` joins the workspace of the app's other window), `enforce: new | first | always` (`always` re-applies after manual moves; static targets only).

## 5. Performance strategy

| Concern | Approach |
|---|---|
| Idle cost | Only one permanent signal (`window-created`) + settings `changed`. |
| Rule eval | Single sorted array; decisions cached by `appId + wmClass` (disabled automatically if any title matcher exists; cache capped at 256). |
| Identity | Lazy getters; exec/title only read if a matcher needs them. |
| Regex/glob | Compiled once per config change. |
| Timers | None. One-shot idles, removed on disable. `first-frame` wait only when identity is not yet known. |
| Memory | Weak sets for handled windows; workspace set pruned lazily; no per-window state except opt-in `always`. |
| Config change | Recompile + clear cache; sweep only if the user enabled it. |

## 6. GNOME 50 API choices & limits

- Windows: `Meta.Window` (`change_workspace`, `get_window_type`, `is_skip_taskbar`, …), `Shell.WindowTracker.get_window_app`.
- Workspaces: `global.workspace_manager` (`append_new_workspace`, `remove_workspace`, `get_workspace_by_index`); `Meta.Workspace.activate / activate_with_focus`.
- **Names**: no per-workspace API. Written to `org.gnome.desktop.wm.preferences workspace-names` only if `lifecycle.applyNames`; original restored on disable.
- **Layout**: GNOME has one *global* grid (`override_workspace_layout`). Per-workspace size/orientation does **not exist** → not implemented (accepted in config, reported as a warning). Global grid is opt-in (`layout.override`), restored on disable.
- **Dynamic workspaces**: if GNOME's dynamic-workspaces is on, Shell may delete an empty middle workspace. Static workspaces are therefore *logically* reserved and re-created on demand when their app returns; keeping them physically requires turning GNOME dynamic workspaces off (we never change that setting).
- **Tiling**: out of scope; `layout.js` is the future hook.

## 7. Safety

Invalid JSON/enums/regexes are reported and replaced by defaults or skipped per entry. Unknown keys are preserved, so later versions can add options without migrations (`version` field reserved).
