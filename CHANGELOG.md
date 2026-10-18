# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **macOS preview**: menu bar and Dock actions, Cmd shortcuts, start at login, and `.app`/DMG/ZIP packaging.
- **Menu-bar pets (macOS)**: one pixel pet per profile replaces Hatstand's menu bar icon and shows when that account's Claude Code is working, needs input, or is done, with a generated sound in each pet's own key. State comes from Claude Code hooks that Hatstand adds to each profile's settings.
- **Session panel**: hover a pet to see that account's active sessions (title, folder, last prompt, task progress, background tasks, token usage, model); click to pin it; click a session to open that conversation in the right account's Claude.
- **Pet picker**: eight pets, or initials, as each profile's picture. Existing profiles get a pet each, in order. Export and import include it.

### Changed

- A session counts as done only when its whole task list and its background tasks are finished; a turn that ends on a question shows as needing input.
- Picking a theme applies it immediately.

## [0.1.0] - 2026-09-16

First public preview.

**The app is renamed from ClientDeck to Hatstand**, to avoid confusion with an unrelated product of the same name.

### Added

- First-run setup: finds Claude, explains what stays separate, and creates the first client.
- Open several selected profiles at once, and a startup group that opens with Windows.
- Per-profile global shortcuts, with conflict detection and a key recorder.
- Optional client work folder per profile.
- Taskbar jump list with one entry per client; tray menu shows which clients are running and can close all of them.
- Drag-and-drop reordering.
- `--profile=` accepts a profile name as well as an ID.
- **Check for updates** in Settings (on demand only).
- **Settings → Local data** finds data left by removed profiles and moves it to the Recycle Bin. Removing a profile can also move its data to the Recycle Bin.
- Warning when the installed Claude version hasn't been tested.
- Detection of Claude's non-MSIX installer (not yet verified). A manually chosen `Claude.exe` now follows Claude's updates.
- Multi-resolution app and tray icon.

### Changed

- **Profile data moved to `%LOCALAPPDATA%\HatstandData`.** The 0.0.1 preview kept data inside its own install folder, `%LOCALAPPDATA%\ClientDeck`, which Squirrel deletes on uninstall. Data from 0.0.1 is moved automatically on first start (renamed, never copied or deleted); uninstall ClientDeck 0.0.1 separately afterwards. Metadata exported from ClientDeck still imports.
- Desktop shortcuts, the jump list, and Start with Windows now launch through Squirrel's `Update.exe`, so they keep working after updates. Shortcuts created by 0.0.1 should be recreated.
- Closing a profile waits for Claude to exit before reporting a result, which makes Restart reliable.
- Status checks run every 30 seconds while Hatstand is hidden, instead of every 8.
- Storage safety checks ignore links above the data folder, so redirected profile folders work.
- The profile file is now schema 2; older versions of Hatstand refuse to open it rather than silently dropping new fields.

### Fixed

- The app quit immediately on its first launch after installation.
- Move up/down did nothing when an archived profile sat next to the one being moved.
- Diagnostics reported zero running profiles unless a profile was attached to an existing folder.
- The Compatibility page showed an outdated tested version.
- The global shortcut field accepted shortcuts that swallowed normal typing.

## [0.0.1] - 2026-09-16

Local preview, released as ClientDeck: profile management, separate Desktop data paths, launch/focus, exact process matching, tray, global shortcut, search, themes, metadata import/export, diagnostics, and a Windows x64 installer/ZIP.
