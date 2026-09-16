# Compatibility

Hatstand depends on Claude Desktop behavior that Anthropic does not document. This page records only what has been **observed**, on which versions. The in-app Compatibility page reads from `src/core/compat.ts`; keep the two in sync.

**Host tested:** Windows 11 x64.
**Claude Desktop tested:** MSIX 1.52386.6.0 and 2.110.0.0.

## How it works

Claude Desktop contains an override, `CLAUDE_USER_DATA_DIR`, that sets Electron's user data folder. Hatstand launches the installed `Claude.exe` with, for each profile:

- `CLAUDE_USER_DATA_DIR` and a matching `--user-data-dir=` argument pointing to `profiles\<id>\desktop`;
- `CLAUDE_CONFIG_DIR` pointing to `profiles\<id>\code`;
- a unique inert `--hatstand-activation=` argument, so Claude's single-instance handling treats a second launch as a request to focus rather than ignoring it;
- the parent environment without `CLAUDE_*`, `ANTHROPIC_*`, `ELECTRON_*`, and `NODE_OPTIONS`.

This is an implementation detail of Claude Desktop, not a supported interface, and may change in any update.

## Results

| Capability | Result | Notes |
|---|---|---|
| MSIX installation discovery | Observed | Rediscovered after Claude updated from 1.52386.6.0 to 2.110.0.0 |
| Non-MSIX installer discovery | **Unverified** | Looks for `%LOCALAPPDATA%\AnthropicClaude\app-*\claude.exe`; not tested against a real install |
| Three Claude profiles running at once | Observed | Separate processes, windows, and data folders. The default Claude instance kept running |
| Separate browser storage and config per profile | Observed | Only folder names were inspected, not contents |
| Two different accounts signed in | User confirmed | Signed-in Chat/Cowork/Code interface seen in both windows |
| Stays signed in after quit and reopen | Observed | Both profiles, as new processes, on 2.110.0.0 |
| Focus reuses the running process | Observed | Packaged app, both profiles |
| Quitting Hatstand leaves Claude running | Observed | Packaged app |
| Stays signed in after a Windows reboot | **Unverified** | |
| Signing out affects only that profile | **Unverified** | |
| Email, Google, and SSO sign-in return to the right window | Partly | Two sign-ins succeeded; each method not tested separately |
| Cowork task execution and separation | **Unverified** | |
| Desktop Code task execution and separation | **Unverified** | |
| MCP servers, browser integration, local services | **Unverified** | Shared components are possible |
| Future Claude versions | **Unverified** | Hatstand warns when the installed version isn't in the tested list |

## Manual test checklist

Use synthetic client folders and harmless content. Never paste credentials into Hatstand, and never copy one profile's folder to create another.

1. Create two or three profiles and **Launch** each. Sign into a different authorized account in each Claude window.
2. Confirm the intended account appears in each window. Record pass/fail without emails or screenshots of private content.
3. Quit and reopen one profile; confirm it's still signed in to the right account and the others are unaffected.
4. Sign out in one profile; confirm the others stay signed in.
5. Reboot Windows, then launch each profile and confirm its account.
6. Run harmless Cowork and Desktop Code tasks in separate empty folders. Check account, history visibility, permissions, and connectors in each profile.
7. Repeat the sign-in check for each authentication method you use (email link, Google, SSO).

Report results in an issue with the Hatstand, Claude Desktop, and Windows versions. Don't declare isolation from a successful sign-in test alone: all profiles run as the same Windows user.

## Maintainer tools

`scripts/dev/probe.mjs` launches up to three fresh profiles under `.local/probe/` (ignored by Git) and reports their processes. `scripts/dev/adopt-folder.mjs` attaches such a folder to Hatstand without moving it. Treat those folders as sensitive once you sign in.
