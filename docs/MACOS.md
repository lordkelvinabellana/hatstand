# Plan: Hatstand for macOS

**Status:** planned, not started. Nothing on this page has been tested on a Mac yet.

Claude Desktop for macOS is also an Electron app, so the Windows approach (a separate user data folder per profile) will probably carry over. Most of Hatstand is already platform-neutral: the React UI, profile store, validation, and the launch/close lifecycle in `Controller`. The Windows-specific parts sit behind a few functions in `src/core/windows.ts` and `src/main/`.

## Step 1: feasibility spike (before any product work)

On a Mac with Claude Desktop installed, using throwaway test accounts:

| Question | How to check |
|---|---|
| Does `CLAUDE_USER_DATA_DIR` / `--user-data-dir` give a separate profile? | Start `/Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=/tmp/hs-a` directly, with the environment variable set |
| Can two or three profiles run at once? | Start a second profile the same way; confirm separate windows and processes |
| Does focusing work? | Start the same profile again; the existing window should come forward and the new process exit |
| Do sign-ins stay separate and persist? | Sign into different accounts, quit, reopen, reboot |
| Is anything shared through the Keychain? | Watch for Keychain prompts; check whether signing out in one profile affects another |
| Do sign-in links return to the right window? | Test email and Google sign-in; the `claude://` URL handler is registered once per app bundle |
| What do Cowork and Code do? | Same checks as the Windows checklist in [COMPATIBILITY.md](COMPATIBILITY.md) |

If separate profiles don't work, stop and record the findings. Don't work around it by copying app bundles or modifying Claude.

## Step 2: platform adapter

Move the OS-specific functions behind one interface so the controller and UI stay shared:

```ts
interface Platform {
  detectInstallation(override: string): Promise<Installation | null>;
  listProcesses(): Promise<ProcessObservation[]>;
  launch(installation: Installation, desktop: string, code: string): Promise<number>;
  close(installation: Installation, desktop: string, process: ProcessObservation, force: boolean): Promise<void>;
  samePath(a: string, b: string): boolean;
  stableLauncher(execPath: string): Launcher;
}
```

| Concern | Windows (today) | macOS (planned) |
|---|---|---|
| Find Claude | `Get-AppxPackage`, Squirrel `app-*` folders | `/Applications/Claude.app`, `~/Applications`, or via `mdfind` by bundle ID; version from `Info.plist` |
| Start a profile | Spawn `Claude.exe` with arguments | Spawn `Claude.app/Contents/MacOS/Claude` directly. `open -n` loses control over the process and environment |
| List processes | PowerShell + CIM | `ps -axww -o pid=,lstart=,command=` |
| Close | `taskkill` (plus `/T /F`) | `SIGTERM`, then `SIGKILL` for Force close |
| Path comparison | Case-insensitive | Case-sensitive by default; compare realpaths |
| Data folder | `%LOCALAPPDATA%\HatstandData` | `~/Library/Application Support/HatstandData` |
| Link safety | Junctions and symlinks | Symlinks (`lstat`); same `ensurePlainDirectory` rules |
| Tray | Notification area | Menu bar icon (template image) |
| Jump list | Taskbar jump list | Dock menu (`app.dock.setMenu`) |
| Start at login | Login item via `Update.exe` | `app.setLoginItemSettings` (uses SMAppService on macOS 13+) |
| Shortcuts | `.lnk` desktop shortcuts | Skip, or offer Shortcuts/Automator actions calling `hatstand://open?profile=` |
| Shortcut keys | `CommandOrControl` means Ctrl | Means Cmd; the key recorder must use `metaKey` |

## Step 3: packaging and release

- Electron Forge makers: `@electron-forge/maker-dmg` and `maker-zip` for `darwin` (universal, or separate arm64 and x64 builds).
- **Code signing and notarization are required.** Unsigned apps are blocked by Gatekeeper by default. This needs an Apple Developer Program membership, a Developer ID Application certificate, and `notarytool` credentials stored as GitHub secrets.
- Updates: on-demand checks work as they do today. Automatic updates need signed builds and `update.electronjs.org` or a similar service.
- CI: add a `macos-latest` job running lint, typecheck, unit tests, and the UI tests. The UI tests never start Claude, so they run on macOS as they are.

## Step 4: verification before release

- Repeat the full compatibility checklist on the current Claude for macOS, on Apple silicon and (if still supported) Intel.
- Check accessibility with VoiceOver and keyboard-only use.
- Test install from DMG, first launch through Gatekeeper, update, and removal. Confirm the data folder survives removing the app.

## Rough effort

| Work | Size |
|---|---|
| Feasibility spike | 1–2 days on a Mac |
| Platform adapter refactor (Windows behavior unchanged, tests kept green) | 2–3 days |
| macOS adapter, tray/Dock/login item, shortcut keys | 3–5 days |
| Signing, notarization, DMG, CI | 2–3 days, plus Apple account setup |
| Manual verification and docs | 2 days |
