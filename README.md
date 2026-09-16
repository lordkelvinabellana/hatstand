# ClientDeck

An independent, open-source Windows profile launcher for the official Claude Desktop app. **Local preview 0.0.1** supports separate persistent client profiles, with two accounts tested locally.

The intended workflow is one persistent Claude Desktop profile per client, with convenient launch and switching controls. Claude Desktop must be installed separately. This project is not affiliated with Anthropic and does not distribute Claude.

## Current state

- Three fresh Claude instances have been observed running concurrently on the tested MSIX build.
- Profile creation, editing, reorder, archive/restore, launch/focus, process status, tray controls, global shortcut, themes, and packaged desktop shortcuts are implemented.
- Metadata import/export creates fresh profiles without transferring sign-ins. Diagnostics show versions and counts without client names or session contents.
- Two different account sign-ins were confirmed by the user and both profiles reopened signed in on Claude 2.110.0.0. The packaged app reused both existing processes and left them running when it exited.
- Cowork/Code task execution and separation, logout isolation, all authentication methods, and Windows reboot persistence remain unverified. See [compatibility results](docs/COMPATIBILITY.md).

## Using the preview

Run the Windows x64 Setup.exe, or extract the **entire ZIP** and run ClientDeck.exe inside it. The executable needs its companion files. End users do not need Node.js. These preview binaries are unsigned; signing is not configured.

Choose **Add profile**, name the client, then **Launch** and sign in inside Claude. Repeat for a second client; add a third later with the same button. There is no minimum of three profiles or artificial account limit.

Ctrl+Shift+Space opens ClientDeck; Ctrl+K focuses client search. If the global shortcut is occupied, change it in Settings. Closing the manager window minimizes it to the tray by default. Quit ClientDeck from the tray to exit while leaving Claude running.

New profiles live in `%LOCALAPPDATA%\ClientDeck\profiles\<id>`. The development setup adopted the user's two existing test folders through local `bindings.json`; their session data stays in `.local/probe/`. Do not delete this checkout until those profiles are deliberately migrated. Bindings and session data are never exported or packaged.

Removing a profile preserves its session folder. Permanent data deletion, grouped launch, per-profile hotkeys, client work-folder shortcuts, and GitHub update checks are deferred; see [the roadmap](docs/ROADMAP.md).

Running status means a process is running, not that an account is authenticated or a task succeeded. Account labels are entered by the user. Profiles share the Windows user's filesystem, clipboard, and local services; this is not an operating-system sandbox.

## Development

Requires Node.js 24 or newer. The final packaged launcher is intended to include its own runtime.

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run test:ui
npm run make
```

On a Windows machine with the Claude MSIX package installed:

```powershell
npm run probe -- launch
npm run probe -- status
```

The launch experiment creates three fresh profiles below `.local/probe/`, which is excluded from Git. Sign in yourself inside the official Claude app. Treat those directories as sensitive once authenticated; never upload them.

The experimental profile mechanism is undocumented by Anthropic and may change. Separate app data does not isolate access to the Windows user's files, clipboard, or services.

`npm start` runs the development app. Installer/ZIP outputs are under `out/make/`. UI tests use an isolated temporary store with sample clients. CI builds unsigned artifacts and does not publish releases automatically.

Packaging uses patched Electron Packager 20 directly followed by Forge's makers with `--skip-package`: Forge 7's internal hooks use the older callback API. The package allowlist contains only compiled code, the original icon, package metadata, and LICENSE. No client data enters the executable. Run `node scripts/verify-artifacts.mjs` to verify the allowlist and generate SHA256SUMS.txt.

## License

MIT for ClientDeck's original code. Claude Desktop remains subject to its own terms and license.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Public GitHub publication and signing are still separate steps.
