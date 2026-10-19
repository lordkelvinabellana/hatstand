# Architecture

Hatstand is an Electron app written in TypeScript: a React renderer, an Electron main process, and a core library with no Electron dependency.

```text
React renderer (sandboxed, no Node)          src/ui
        │  window.hatstand.request(action, payload)
        ▼
preload: one validated IPC channel           src/main/preload.ts
        ▼
main process                                 src/main
  handlers.ts ── validates payloads, dialogs, shell integration
  tray.ts · integration.ts (shortcuts, jump list, login item) · squirrel.ts
        ▼
core (plain Node, unit-tested)               src/core
  Controller ── launch / focus / close / restart lifecycle, status
  ProfileStore ── profiles.json with atomic writes and a backup
  windows.ts ── Claude detection, process listing, spawn, taskkill
  launch.ts · paths.ts · storage.ts · profiles.ts · settings.ts
        ▼
Claude.exe per profile, with its own --user-data-dir
```

Notes windows (one per profile) are a second React renderer, `src/notes`, built to `dist/notes.html`.
They talk to the main process over their own channel, `window.notes.request(action, payload)` →
`notes:request`, handled by `src/main/notes.ts`. Each window is bound to its profile when it opens:
requests never name a profile or a vault, and every path is vault-relative and checked by
`src/core/notes.ts` (no `..`, no hidden folders, no symlinks out of the vault, writes to `.md` only,
nothing overwritten, removal through the system trash). The main window can't use this channel and
notes windows can't use `hatstand:request`. The vault is watched with `fs.watch` (recursive) and the
window reloads on change. Wikilinks, aliases, backlinks and search (MiniSearch) live in
`src/core/links.ts`, which is pure and unit-tested. The graph view builds its nodes and edges from
that same link index in `src/core/graph.ts` (also pure: filters, local graph, search matches) and
draws them with sigma.js 3 and graphology in `src/notes/GraphView.tsx`. ForceAtlas2 runs in a web
worker that the library starts from a blob, which is why the notes page's CSP allows `worker-src blob:`.

Claude features in the notes window never pick an account themselves: main builds a `claude://code/…`
link (`src/core/ask.ts`) and delivers it to the window's own profile's running Claude through the macOS
helper (`open-url`, by PID), launching the profile first when needed. "Open session" maps the note's
Claude Code session id to Claude Desktop's `local_…` id from that profile's `claude-code-sessions/`.
"Ask" opens `claude://code/new?q=…&folder=<vault>`. The read-only recall MCP server is
`src/core/recall.ts` (JSON-RPC over stdio, no SDK), bundled as `dist/recall.cjs`, copied to
`<data>/second-brain/recall.cjs` and registered by `wireBrains` in the profile's `code/.claude.json` and
`desktop/claude_desktop_config.json` (only its own `hatstand-notes` entry, only in files that already
exist and parse), run as `ELECTRON_RUN_AS_NODE=1 <Hatstand> recall.cjs --vault <vault>`.

## Principles

- **Measured status only.** "Running" means a Claude main process with that profile's exact `--user-data-dir` exists. Hatstand never infers sign-in state or task progress.
- **Preserve data by default.** Removing a profile only unregisters it. Anything that removes data goes to the Recycle Bin after path and link checks.
- **The renderer is untrusted.** IPC accepts requests only from the app's own main frame, and every handler validates its payload.
- **Core logic is testable.** The `Controller` receives process listing, spawning, closing, sleeping, and the clock as dependencies, so tests simulate Windows without starting Claude.

## Storage

```text
%LOCALAPPDATA%\HatstandData\
  profiles.json          schema 2; profiles.json.backup is the previous version
  settings.json
  bindings.json          optional: attached existing profile folders
  logs\manager.log       actions and profile IDs only
  manager\               Hatstand's own Electron data
  profiles\<uuid>\desktop   Claude Desktop user data (signed-in session)
  profiles\<uuid>\code      CLAUDE_CONFIG_DIR
  profiles\<uuid>\pet       macOS: one state file per Claude Code session, written by the pet hook
  pet-hook.sh, pet-sounds\  macOS: the hook Hatstand adds to each profile's Code settings, and generated sounds
  second-brain.json      optional second brain: which profiles have it on, and custom vault folders (never synced)
  second-brain\capture.cjs  the capture script the second-brain hooks run (copied out of the app at start)
  profiles\<uuid>\vault    optional second brain: that profile's notes (default location)
  sync-session.bin       optional profile sync: Supabase sign-in, encrypted with safeStorage
  sync-deleted.json      optional profile sync: removed profiles not yet deleted remotely
```

The data folder is deliberately separate from the Squirrel install folder `%LOCALAPPDATA%\Hatstand`, which the uninstaller deletes. `migrateLegacyData` moves 0.0.1 data out of it by renaming.

Profile folders are named by a stable UUID, so renaming a client never moves data. `ensurePlainDirectory` creates folders below the data root and refuses links or junctions beneath it.

## Process lifecycle

1. **Detect** Claude: the MSIX package through `Get-AppxPackage`, otherwise the newest `app-*` folder of a Squirrel install, or a user-chosen `Claude.exe`. Detection repeats before launches because Claude updates change its path.
2. **Launch**: spawn `Claude.exe` detached with an argument array (see [COMPATIBILITY.md](COMPATIBILITY.md)). The profile shows *Opening…* until a matching process appears, or *Needs attention* after 20 seconds.
3. **Focus**: launching a running profile again spawns Claude with the same data folder. Claude's single-instance lock forwards the request to the existing window, and the new process exits.
4. **Close**: re-read the process, confirm it's still the same PID and creation time with the same ownership, run `taskkill /PID` (plus `/T /F` when forcing), then poll until it exits or the wait expires.
5. **Status polling**: every 8 seconds while the manager is visible and every 30 seconds while it's in the tray.

Process listing uses PowerShell and CIM, because Node can't read other processes' command lines.

## Windows integration

Squirrel installs `Hatstand.exe` under a versioned `app-x.y.z` folder that is replaced on update. Shortcuts, jump-list entries, and the Start with Windows entry therefore run `Update.exe --processStart Hatstand.exe --process-start-args "…"` (`stableLauncher` in `paths.ts`). Command-line `--profile=` values reach the running instance through Electron's `second-instance` event.

## Testing

- `npm test`: core units, including lifecycle tests with a fake process table, storage safety with real junctions, schema migration, and argument quoting.
- `npm run test:ui`: Playwright drives the built Electron app against a temporary data folder with synthetic clients. It never launches Claude.
- `scripts/dev/verify-packaged.mjs`: a manual smoke test of the packaged app against real profiles. It only focuses profiles that are already running.
