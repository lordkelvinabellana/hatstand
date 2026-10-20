# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-20

### Added

- **Remove Hatstand’s changes** (Settings → Local data): turns off menu-bar pets and every second brain and removes their hooks, CLAUDE.md sections and notes tool from each profile’s Claude settings. Notes, vaults and backups are kept; your own hooks and settings are left alone.
- **Second brain backup** (Settings): pick a folder (for example one Obsidian opens) and every vault is copied into its own subfolder after each Claude reply. It only adds and updates notes, never deletes.
- **Notes you can find**: a profile’s first vault now goes to `Documents/Hatstand Notes/<profile>` instead of Hatstand’s data folder. Existing vaults stay where they are.
- **Build marker**: the sidebar shows the commit a build came from next to the version.
- After a Claude update, the untested-version banner says which version profiles last worked on.

### Changed

- On Windows, the profile page says running tasks are macOS-only for now instead of pointing to a pets setting that doesn’t exist there.

- Clicking anywhere on a profile's row opens its page; the checkbox, drag handle, Launch and actions menu keep their own jobs.
- A vault now opens on its graph; clicking a note opens the editor as before.
- **Deep graph**: a button on a vault's graph asks that profile's own Claude (a new Code session in the vault, via the usual `claude://` link) to find connections the notes don't link yet and write them to `.hatstand/inferred-links.json`. Hatstand checks the file (only notes that exist, no repeats, capped) and draws those links in orange on the vault graph and the all-vaults graph, with an **AI links** toggle and an **AI-suggested links** list (with Claude's reason) beside each note. Notes are never edited, and nothing beyond the signed-in Claude is needed.
- **“Works for me” for untested Claude versions**: the untested-version banner has a **Works for me** button; once you mark your installed Claude version as working, the banner stays away for that version. Undo it, or report a problem, under Compatibility. The diagnostic summary says whether you confirmed the version.
- **Second brain page and profile page**: a Second brain item in the sidebar shows every vault in one graph (each vault around its own hub, coloured by profile), a card per vault and setup buttons for profiles without one; a vault's notes open inside the main window instead of a separate Notes window. **Share…** points other profiles at a vault (a default vault first moves to its own folder; their own vaults are kept, with an offer to copy their notes in) and each can leave again. Clicking a profile opens its page: details, its running Claude Code tasks (as the menu-bar pet shows them, click to open one) and its second brain.
- **Second brain (opt-in, per profile)**: a profile can keep its own Markdown notes vault. Claude Code hooks log each session (prompts with secrets and emails redacted, files written, skills and apps used) and a daily index; a managed block in the profile's `CLAUDE.md` asks Claude to keep client, project, people and tool notes and a to-do list. Runs on Hatstand's own executable, no Python. Turning it off removes the hooks and block and keeps the notes. Profiles with their own `capture.py` hooks are left alone.
- **Second brain vault picker and templates**: start a new vault, adopt an existing folder or Obsidian vault without changing its notes, or go back to the default; switching can copy notes over and never deletes or replaces any. Folders that overlap another profile's vault are refused. The note templates and the to-do format (now `_templates/To-Do format.md`) can be edited in Hatstand, each with **Restore default**.
- **Notes editor**: each profile's vault opens in its own Notes window: file tree (create, rename, move, Move to Trash; never a hard delete), tabs, a CodeMirror 6 live-preview Markdown editor with autosave, `[[wikilink]]` completion from note names and aliases, click to open or create, rename that updates links, full-text search (MiniSearch), quick open, and a backlinks panel. The vault is watched, so notes Claude writes appear live; unsaved edits are never overwritten (reload, keep mine or keep both). A window can only reach its own profile's vault.
- **Graph view**: a Graph tab in the Notes window draws the vault's notes and `[[wikilinks]]` (sigma.js, graphology, ForceAtlas2 in a worker), coloured by folder and sized by links, with a legend, folder toggles, hide Sessions and Daily, hide orphans, faint dots for missing notes, and search highlighting. Click opens a note, hover lights up its neighbours, and it updates live. A local graph (one or two links deep) sits above the backlinks.
- **Claude in the Notes window**: session notes open their Claude Code session in the profile's own Claude Desktop; an **Ask** panel starts a new Code session in the vault there with the question filled in; and a read-only `hatstand-notes` MCP server (search, read, links) is registered in the profile's Claude Code and Claude Desktop settings while the second brain is on. Links only ever go to that profile's own Claude.

### Changed

- Creating or editing a profile now opens a centered popup instead of a side panel. The Create / Save button stays visible at the bottom, so there's no scrolling to finish. Escape or clicking outside closes it.

## [0.2.0] - 2026-10-19

Adds the macOS app. Mac downloads are unsigned: the first time, open it from System Settings → Privacy & Security → Open Anyway.

### Added

- **Mac downloads**: each release now includes DMGs for Apple silicon (arm64) and Intel (x64), and one `SHA256SUMS.txt` covers every file.
- **macOS preview**: menu bar and Dock actions, Cmd shortcuts, start at login, and `.app`/DMG/ZIP packaging.
- **Menu-bar pets (macOS)**: one pixel pet per profile replaces Hatstand's menu bar icon and shows when that account's Claude Code is working, needs input, or is done, with a generated sound in each pet's own key. State comes from Claude Code hooks that Hatstand adds to each profile's settings.
- **Session panel**: hover a pet to see that account's active sessions (title, folder, last prompt, task progress, background tasks, token usage, model); click to pin it; click a session to open that conversation in the right account's Claude.
- **Optional profile sync**: keep profile names, labels, colors, pets, order and shortcuts in your own Supabase project, with email-code sign-in and newest-change-wins merging. Sign-ins, Claude data, settings and work folders never sync. Off by default; see [docs/SYNC.md](docs/SYNC.md).
- **Pet settings (macOS)**: Settings → Menu-bar pets turns the pets off (the Hatstand icon comes back) or keeps them but silences their sounds.
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
