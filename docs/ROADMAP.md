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
