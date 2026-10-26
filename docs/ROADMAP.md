# Roadmap

Priorities can change based on compatibility findings and feedback. Open an issue to discuss anything here before starting work.

## Before a stable 1.0

- Verify reboot persistence, sign-out isolation, each authentication method, and Cowork/Desktop Code separation (see [COMPATIBILITY.md](COMPATIBILITY.md)).
- Test a clean-machine install, upgrade from each previous release, and uninstall on a fresh Windows VM.
- Verify detection of Claude's non-MSIX installer against a real installation.
- Code-sign releases (see [RELEASING.md](RELEASING.md)).

## Next

- **Window identity**: make it obvious which client a Claude window belongs to. Candidate approaches and their risks are in [WINDOW-IDENTITY.md](WINDOW-IDENTITY.md); each needs a proof of concept first.
- Attach an existing profile folder from the UI (today: `scripts/dev/adopt-folder.mjs`), and move profile data to another drive deliberately.
- Per-profile environment presets for Desktop Code, only where separate configuration paths are verified.
- Localization.

## Second brain

Done: capture, per-profile vaults, hook and CLAUDE.md wiring, opt-in toggle, vault picker and editable templates, the notes editor (file tree, tabs, live preview, wikilinks, search, backlinks, live reload), the graph view (global and local, live, filters), and Claude features (open the session behind a note, an Ask box, a read-only recall MCP server). Next:

1. Inline answers in the Ask box, once a profile's Claude Code can be signed in without risking the wrong account.
2. Editor extras if wanted: images and attachments, tables, split panes, links by path updated when a folder moves.
3. Maybe later: one-way linking between vaults on one machine, and end-to-end-encrypted hosted sync. Moving notes between computers is done by hand with Export notes… / Import notes… until then.

## Exploring

Ideas from early users and the website's roadmap; each needs a feasibility check before any commitment.

- **ChatGPT and Codex**: the same one-profile-per-client launcher for ChatGPT's desktop app and Codex, next to Claude.
- **Agent view**: a pixel-art office where each client's pet works at its desk, showing which account is busy and on what (from the same Claude Code hooks the pets use).
- **Time and usage per client**: sessions and tokens per client from Claude Code transcripts, for invoicing.
- **A morning brief**: each client's open to-dos and what's waiting on whom, from its second brain.

## Later, only if compatibility allows

- Per-profile MCP configuration editor with validation and backup.
- Terminals that open with a profile's Code configuration.
- Window layout restore across clients.
- Resource usage per profile, where process ownership is certain.
- Automatic updates with a verified pipeline and explicit user control.
- ARM64 Windows builds.

## macOS

A macOS preview is in progress, including menu-bar pets that show each account's Claude Code sessions (task indicators from Claude Code hooks, never inferred from process state). Details and remaining work are in [MACOS.md](MACOS.md).

- Pets on Windows (the tray hides most icons, so this needs its own design).

## Done in 0.1.0

First-run setup, open several profiles at once, startup group, per-profile shortcuts, work folders, jump list, tray status and Close all, drag-and-drop reordering, launching by name, on-demand update checks, leftover-data cleanup through the Recycle Bin, and a data folder that survives uninstall.
