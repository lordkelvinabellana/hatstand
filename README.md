# Hatstand

[![Windows build](https://github.com/lordkelvinabellana/hatstand/actions/workflows/windows.yml/badge.svg)](https://github.com/lordkelvinabellana/hatstand/actions/workflows/windows.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-236553.svg)](LICENSE)

**One hat per client.** Keep each client's Claude Desktop account in its own profile, and switch between them without signing out.

**[Website](https://lordkelvinabellana.github.io/hatstand/)** · **[Download](https://github.com/lordkelvinabellana/hatstand/releases/latest)** · **[Compatibility](docs/COMPATIBILITY.md)**

Hatstand is a small, open-source Windows and macOS launcher for people who use Claude Desktop with several accounts, such as consultants and agencies working for multiple clients. Create a profile per client, sign in once inside the official Claude app, then launch or focus any client from a list, the tray, a keyboard shortcut, or a desktop shortcut. On a Mac, each client also gets a pixel pet in the menu bar that tells you when that account's Claude needs you or has finished.

![Hatstand profile list with three sample clients](docs/images/profiles.png)

> [!IMPORTANT]
> Hatstand is an independent project. It is **not affiliated with, endorsed by, or supported by Anthropic**. Claude is a trademark of Anthropic, PBC. Hatstand does not include or modify Claude Desktop; you install Claude separately and sign in inside it.

## Status

**Preview.** It has been tested on Windows 11 x64 with Claude Desktop (MSIX) 1.52386 and 2.110, but several behaviors are not yet verified. Read [what has and hasn't been tested](docs/COMPATIBILITY.md) before relying on it for client work.

Hatstand starts Claude with a separate data folder for each profile by setting `CLAUDE_USER_DATA_DIR`. **Anthropic does not document this setting**, and a Claude update could change or remove it. If that happens, Hatstand shows the profile as failing to start. It does not touch your default Claude sign-in.

## Features

- **One profile per client**: name, color, a pixel pet (or initials) as its picture, and an optional account label you enter yourself.
- **Launch or focus** a client's Claude window, or **open several at once**.
- **Status you can trust**: shows whether that profile's Claude process is running. It never claims an account is signed in, and only reports a task as finished when Claude Code itself says so (see [menu-bar pets](#menu-bar-pets-macos)).
- **Menu-bar pets (macOS)**: one pet per client that shows working, needs input, or done, with its own sound, and a panel of that account's active sessions.
- **Keyboard first**: a global shortcut opens Hatstand (Ctrl+Shift+Space by default), per-profile shortcuts jump straight to a client, and Ctrl+K searches.
- **Windows integration**: tray menu, taskbar jump list, per-client desktop shortcuts, optional start with Windows, and profiles that open at sign-in.
- **Client work folders**: one click to open the client's files. This is a convenience only; it doesn't restrict what Claude can access.
- **Safe data handling**: removing a profile keeps its data by default. Leftover data can be moved to the Recycle Bin (never deleted outright), and uninstalling Hatstand keeps every profile.
- **Metadata export/import**: names, labels, colors, and pets only. Sign-ins never leave your computer.
- Light, dark, and system themes; keyboard navigation; no telemetry.

## macOS preview

macOS support includes a menu bar icon, Dock profile actions, Cmd shortcuts,
start at login, and `.app`/DMG/ZIP packaging. Two simultaneous accounts, retention
after quit/reopen, and sign-out isolation were verified with user confirmation on
Claude Desktop 2.2553.1 on Apple silicon. Reboot retention and Cowork/Code isolation
remain unverified.

Build locally with Node.js 24+ and Xcode Command Line Tools: `npm ci`, then
`npm run make`. The app is in `out/Hatstand-darwin-arm64/` (or `x64` on Intel).
Local previews are not Developer ID signed or notarized. See
[Mac build, verification and signing instructions](docs/MACOS.md).
Mac data is stored in `~/Library/Application Support/HatstandData` and survives
removing the app. The remaining instructions below describe Windows.

### Menu-bar pets (macOS)

![Eight pixel pets, and one pet sleeping, idle, working, asking and done](docs/images/pets.png)

Instead of one Claude icon per account, the menu bar shows one pet per client.
Pick it in the profile editor (cat, frog, ghost, bunny, bear, chick, slime or robot);
it is also the client's picture in Hatstand.

| The pet shows | When |
|---|---|
| Asleep, grey | That client's Claude isn't running |
| A bubble with dots, bobbing | Claude Code is working |
| A red **!**, hopping, plus a sound | It asked you something or needs a permission |
| A green **✓**, plus a sound | The whole task is finished: every step of its task list and every background task |

Each pet plays its jingle in its own key, so you can tell by ear which account wants you.
Claude's own menu bar icon can be turned off per account in Claude's Settings → General.

<img src="docs/images/panel.png" width="340" alt="A pet's panel listing three sessions: one asking a question with its task list and token usage, one working, one done">

Hover a pet for a panel of that account's active sessions: title, project folder, your
last prompt, task progress, background tasks, context and output tokens, and the model.
Click the pet to keep the panel open, and click a session to open that conversation in
the right account's Claude. Right-click for the Hatstand menu.

How it works: Hatstand adds a small hook script (`HatstandData/pet-hook.sh`) to each
profile's Claude Code `settings.json`. The hook writes one tiny file per session
(state, time, transcript path) to `profiles/<id>/pet/`, and the panel reads that
session's local transcript. Nothing is sent anywhere. Opening a session sends a
`claude://code/continue` link to that profile's own Claude process, so macOS asks
once for permission to control Claude.

## Install (Windows)

1. Install [Claude Desktop for Windows](https://claude.com/download).
2. Download `Hatstand-<version> Setup.exe` from [Releases](https://github.com/lordkelvinabellana/hatstand/releases) and run it. A ZIP is also available; extract the whole folder before running `Hatstand.exe`.
3. Optional: verify the download against `SHA256SUMS.txt` from the same release:

   ```powershell
   Get-FileHash '.\Hatstand-0.1.0 Setup.exe' -Algorithm SHA256
   ```

Preview builds are **not code-signed** yet, so Windows SmartScreen may warn about an unknown publisher. Choose **More info → Run anyway** only if the checksum matches.

## Using Hatstand

The first run walks you through three steps: finding Claude, what stays separate, and creating your first client. Then, for each client:

1. Choose **Add profile**, enter the client's name, and pick a color.
2. Choose **Launch**. A new Claude window opens with an empty profile. **Sign in there**; Hatstand never sees your password.
3. Next time, **Launch** reopens that client already signed in, and **Focus** brings its window forward if it's running.

Other everyday actions:

| To… | Do this |
|---|---|
| Open several clients | Tick them in the list, then **Open selected** |
| Jump to a client from any app | Set a **Profile shortcut** in its details |
| Open clients when Windows starts | Turn on **Start with Windows** in Settings, then **Open when Windows starts** on each profile |
| Reorder clients | Drag the handle, or use **Move up/down** in the ⋯ menu |
| Open from a script | `Hatstand.exe --profile="North Studio"` (a name or profile ID) |
| Close a client's Claude | ⋯ → **Close Claude**. If Claude only hides in its tray, use File → Exit in that window, or **Force close** |

Closing the Hatstand window keeps it in the tray. **Quit Hatstand** from the tray to exit; your Claude windows keep running.

## What stays separate, and what doesn't

Each profile gets its own Claude Desktop data folder, so each keeps its own sign-in, chats, and Desktop settings.

Profiles still run as **the same Windows user**. They share your files, clipboard, network, and anything else your account can reach. Hatstand is **not a security sandbox**. For strict separation between clients, use separate Windows accounts or virtual machines.

Cowork and Desktop Code separation, sign-out isolation, and staying signed in after a reboot are **not verified yet**. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Where your data lives

| What | Location |
|---|---|
| Profiles, settings, logs | `%LOCALAPPDATA%\HatstandData\` |
| Each profile's Claude session | `%LOCALAPPDATA%\HatstandData\profiles\<profile-id>\` |
| The installed app | `%LOCALAPPDATA%\Hatstand\` (replaced on update, removed on uninstall) |

Profile folders contain signed-in sessions: **treat them like passwords** and never share or upload them. Uninstalling Hatstand leaves `HatstandData` in place. Remove that folder yourself if you want everything gone.

Removing a profile keeps its data unless you tick **Also move this profile's local Claude data to the Recycle Bin**. **Settings → Local data** finds data left behind by removed profiles. Removing a profile doesn't sign out of or delete the Claude account, or any conversations stored by Claude.

Hatstand logs actions with profile IDs only (no names, labels, or paths) and makes no network requests except **Check for updates** in Settings, which contacts the GitHub API when you ask.

## Development

Requires Node.js 24+. Windows packaging requires Windows x64; Mac builds also require Xcode Command Line Tools. See [macOS development](docs/MACOS.md).

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

`npm start` uses your real `%LOCALAPPDATA%\HatstandData`. The UI tests use a temporary folder.

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and [docs/RELEASING.md](docs/RELEASING.md). Planned work is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Never post profile folders, cookies, account emails, or client content in issues.

## License

[MIT](LICENSE) for Hatstand's code. Claude Desktop is Anthropic's software and is subject to Anthropic's terms. Using several Claude accounts must comply with those terms and with your clients' agreements.
