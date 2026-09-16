# ClientDeck

[![Windows build](https://github.com/lordkelvinabellana/clientdeck/actions/workflows/windows.yml/badge.svg)](https://github.com/lordkelvinabellana/clientdeck/actions/workflows/windows.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-236553.svg)](LICENSE)

**Keep each client's Claude Desktop account in its own profile, and switch between them without signing out.**

ClientDeck is a small, open-source Windows launcher for people who use Claude Desktop with several accounts, such as consultants and agencies working for multiple clients. Create a profile per client, sign in once inside the official Claude app, then launch or focus any client from a list, the tray, a keyboard shortcut, or a desktop shortcut.

![ClientDeck profile list with three sample clients](docs/images/profiles.png)

> [!IMPORTANT]
> ClientDeck is an independent project. It is **not affiliated with, endorsed by, or supported by Anthropic**. Claude is a trademark of Anthropic, PBC. ClientDeck does not include or modify Claude Desktop; you install Claude separately and sign in inside it.

## Status

**Preview.** It has been tested on Windows 11 x64 with Claude Desktop (MSIX) 1.52386 and 2.110, but several behaviors are not yet verified. Read [what has and hasn't been tested](docs/COMPATIBILITY.md) before relying on it for client work.

ClientDeck starts Claude with a separate data folder for each profile by setting `CLAUDE_USER_DATA_DIR`. **Anthropic does not document this setting**, and a Claude update could change or remove it. If that happens, ClientDeck shows the profile as failing to start. It does not touch your default Claude sign-in.

## Features

- **One profile per client**: name, color, initials, and an optional account label you enter yourself.
- **Launch or focus** a client's Claude window, or **open several at once**.
- **Status you can trust**: shows whether that profile's Claude process is running. It never claims an account is signed in or a task finished.
- **Keyboard first**: a global shortcut opens ClientDeck (Ctrl+Shift+Space by default), per-profile shortcuts jump straight to a client, and Ctrl+K searches.
- **Windows integration**: tray menu, taskbar jump list, per-client desktop shortcuts, optional start with Windows, and profiles that open at sign-in.
- **Client work folders**: one click to open the client's files. This is a convenience only; it doesn't restrict what Claude can access.
- **Safe data handling**: removing a profile keeps its data by default. Leftover data can be moved to the Recycle Bin (never deleted outright), and uninstalling ClientDeck keeps every profile.
- **Metadata export/import**: names, labels, and colors only. Sign-ins never leave your computer.
- Light, dark, and system themes; keyboard navigation; no telemetry.

## Install

1. Install [Claude Desktop for Windows](https://claude.com/download).
2. Download `ClientDeck-<version> Setup.exe` from [Releases](https://github.com/lordkelvinabellana/clientdeck/releases) and run it. A ZIP is also available; extract the whole folder before running `ClientDeck.exe`.
3. Optional: verify the download against `SHA256SUMS.txt` from the same release:

   ```powershell
   Get-FileHash '.\ClientDeck-0.1.0 Setup.exe' -Algorithm SHA256
   ```

Preview builds are **not code-signed** yet, so Windows SmartScreen may warn about an unknown publisher. Choose **More info → Run anyway** only if the checksum matches.

## Using ClientDeck

The first run walks you through three steps: finding Claude, what stays separate, and creating your first client. Then, for each client:

1. Choose **Add profile**, enter the client's name, and pick a color.
2. Choose **Launch**. A new Claude window opens with an empty profile. **Sign in there**; ClientDeck never sees your password.
3. Next time, **Launch** reopens that client already signed in, and **Focus** brings its window forward if it's running.

Other everyday actions:

| To… | Do this |
|---|---|
| Open several clients | Tick them in the list, then **Open selected** |
| Jump to a client from any app | Set a **Profile shortcut** in its details |
| Open clients when Windows starts | Turn on **Start with Windows** in Settings, then **Open when Windows starts** on each profile |
| Reorder clients | Drag the handle, or use **Move up/down** in the ⋯ menu |
| Open from a script | `ClientDeck.exe --profile="North Studio"` (a name or profile ID) |
| Close a client's Claude | ⋯ → **Close Claude**. If Claude only hides in its tray, use File → Exit in that window, or **Force close** |

Closing the ClientDeck window keeps it in the tray. **Quit ClientDeck** from the tray to exit; your Claude windows keep running.

## What stays separate, and what doesn't

Each profile gets its own Claude Desktop data folder, so each keeps its own sign-in, chats, and Desktop settings.

Profiles still run as **the same Windows user**. They share your files, clipboard, network, and anything else your account can reach. ClientDeck is **not a security sandbox**. For strict separation between clients, use separate Windows accounts or virtual machines.

Cowork and Desktop Code separation, sign-out isolation, and staying signed in after a reboot are **not verified yet**. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Where your data lives

| What | Location |
|---|---|
| Profiles, settings, logs | `%LOCALAPPDATA%\ClientDeckData\` |
| Each profile's Claude session | `%LOCALAPPDATA%\ClientDeckData\profiles\<profile-id>\` |
| The installed app | `%LOCALAPPDATA%\ClientDeck\` (replaced on update, removed on uninstall) |

Profile folders contain signed-in sessions: **treat them like passwords** and never share or upload them. Uninstalling ClientDeck leaves `ClientDeckData` in place. Remove that folder yourself if you want everything gone.

Removing a profile keeps its data unless you tick **Also move this profile's local Claude data to the Recycle Bin**. **Settings → Local data** finds data left behind by removed profiles. Removing a profile doesn't sign out of or delete the Claude account, or any conversations stored by Claude.

ClientDeck logs actions with profile IDs only (no names, labels, or paths) and makes no network requests except **Check for updates** in Settings, which contacts the GitHub API when you ask.

## Development

Requires Windows x64 and Node.js 24.

```powershell
npm ci
npm run lint        # Biome formatting and lint checks
npm run typecheck
npm test            # unit tests (node:test)
npm run build
npm run test:ui     # Electron UI tests with synthetic clients; never launches Claude
npm start           # run the app from source
npm run make        # installer and ZIP in out/make/
```

`npm start` uses your real `%LOCALAPPDATA%\ClientDeckData`. The UI tests use a temporary folder.

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/RELEASING.md](docs/RELEASING.md). Planned work is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Never post profile folders, cookies, account emails, or client content in issues.

## License

[MIT](LICENSE) for ClientDeck's code. Claude Desktop is Anthropic's software and is subject to Anthropic's terms. Using several Claude accounts must comply with those terms and with your clients' agreements.
