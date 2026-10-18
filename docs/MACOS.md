# Hatstand for macOS

**Status:** implemented as an Electron Mac desktop app, sharing the React UI and
profile lifecycle with Windows. Local Apple silicon verification is recorded
below. Public distribution still requires signing/notarization and the remaining
manual checks. This is not a SwiftUI rewrite.

## Feasibility evidence — 2026-09-22

Using the unmodified Claude Desktop **2.2553.1** in `/Applications/Claude.app`:

- Two fresh profiles launched simultaneously with different
  `CLAUDE_USER_DATA_DIR`, `CLAUDE_CONFIG_DIR`, and `--user-data-dir` values.
  Separate main processes and separate Desktop data directories were observed.
- The user signed into different accounts and confirmed both worked concurrently.
- Both test main processes were gracefully stopped with SIGTERM and restarted
  with their original folders. The user confirmed both retained their accounts.
- The user confirmed signing out of one profile left the other signed in.
- A repeated executable launch left an extra process alive instead of reliably
  focusing. The adapter therefore focuses the existing PID through
  `NSRunningApplication` plus a PID-addressed Dock-style reopen event (so closing
  the window does not leave Focus unable to restore it). Focus requests succeeded for both original processes
  without increasing the number of main profile processes.

Test profile paths and PIDs are in ignored `.local/macos-feasibility.json` on the
test machine only. No account identifiers or session contents are stored in Git.
The test directories are retained outside the default Claude data directory.

Still unverified: retention after reboot, authentication callback routing across
all sign-in methods, Keychain behavior beyond the observed sign-out check,
Cowork/Code execution and separation, and Intel hardware compatibility with
Claude. Separate profiles are not a filesystem or security sandbox.

## Implementation

- `src/core/platform.ts` selects the Windows or macOS adapter. The Windows
  PowerShell/MSIX/Squirrel implementation is retained.
- macOS discovery checks `/Applications`, `~/Applications`, and Spotlight by
  bundle identifier. Manual selection accepts a Claude `.app` or its executable;
  the bundle identifier, executable name, executable access and version are checked.
- Claude launches directly, with sanitized environment variables and distinct
  Desktop/Code folders. Existing profiles receive a PID-addressed reopen event
  and are activated instead of spawned again.
- `native/macos.swift` is a small helper, compiled by Xcode Command Line Tools.
  It reads exact argv boundaries using `KERN_PROCARGS2` and process identities
  using `proc_pidinfo`/`proc_pidpath`. `ps` output flattens arguments and cannot
  distinguish paths with spaces safely. No process environment is emitted.
- Close and Force close revalidate the PID, microsecond start time, executable
  and exact data-folder argument inside the helper before SIGTERM/SIGKILL.
  They target the profile's main process, never all processes named Claude.
  Unreadable live Claude arguments cause an error rather than a stopped status.
- Data lives at `~/Library/Application Support/HatstandData`, outside the app
  bundle. Existing symlink protections and metadata-only exports remain intact.
- The menu bar uses a template icon; the Dock menu offers Launch/Focus per client.
  The application menu supplies standard editing and Quit commands, and clicking
  the Dock icon reopens a hidden manager.
- Start at login uses Electron's macOS login item API; startup detection uses
  `wasOpenedAtLogin`. The legacy `startWithWindows` settings key is retained for
  backward compatibility and labeled “Start at login” on Mac.
- Cmd shortcuts are distinct from Control shortcuts, with collision detection
  for Command, Super and CommandOrControl. Desktop `.lnk` creation remains
  Windows-only; Mac users have Dock, menu bar and keyboard actions.

### Menu-bar pets

- `src/main/pets.ts` keeps one `Tray` per active profile, drawn from
  `src/core/sprites.ts` (text grids, no Node imports, so the manager window draws
  the same pets as avatars). The hat icon comes back only when there are no profiles.
- At start Hatstand writes `HatstandData/pet-hook.sh` and merges seven hooks into
  each launched profile's `code/settings.json` (UserPromptSubmit, PostToolUse,
  PreToolUse for AskUserQuestion/ExitPlanMode, PermissionRequest, Notification,
  Stop, SessionEnd). Other hooks are left alone; an unreadable settings file is
  never overwritten; a profile that was never launched gets no folders.
- The hook writes `profiles/<id>/pet/<session>.json`: state, time, transcript
  path and the desktop session id, each validated before use. Hatstand watches
  that folder, and settles a Stop against the transcript: unfinished task-list
  steps or running background tasks keep it working, a wrap-up question makes it
  ask. Sessions that stop reporting age out (working after 20 minutes).
- Sounds are square-wave WAVs generated at start and played with `afplay`.
- The panel is a sandboxed, script-free page except for one hash-allowed script
  that reports its height. Its links are commands handled in `will-navigate`.
- Opening a session: `hatstand-macos open-url` revalidates the process like
  `focus`, accepts only `claude://code/continue?session=local_…`, and sends it as
  a `kAEGetURL` Apple Event to that PID. Every Claude shares one bundle ID, so an
  ordinary URL open would reach whichever account macOS picks. macOS asks once for
  Automation permission (`NSAppleEventsUsageDescription`).

## Build and test

Requires Node.js **24+**, macOS **13+**, and Xcode Command Line Tools (`xcode-select --install`).

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:macos
npm run test:ui
npm run make
node scripts/verify-artifacts.mjs
```

`test:macos` compiles disposable synthetic processes and checks exact arguments,
identity rejection, graceful/force close, and sibling isolation. `test:ui` uses
temporary synthetic profiles; neither test starts Claude. `npm start` uses your
real Hatstand data folder.

Outputs on Apple silicon:

- `out/Hatstand-darwin-arm64/Hatstand.app`
- `out/make/Hatstand-0.1.0-arm64.dmg`
- `out/make/zip/darwin/arm64/` (ZIP)
- `out/make/SHA256SUMS.txt` after artifact verification

Intel builds use `x64`. Build on the target architecture, or set
`HATSTAND_ARCH=x64` for compilation/packaging and pass `--arch=x64` to Forge make.
The helper and Electron must have matching architectures. CI uses separate
Apple silicon and Intel runners; the Windows workflow remains in place.

The DMG maker uses Apple's `hdiutil`, with an Applications link for drag-to-install.
The standard Forge DMG maker was avoided because its dependency chain brought in
an unpatched image-size vulnerability. ZIPs use the standard Forge ZIP maker.
No additional packaging dependencies were introduced.

## Signing and distribution

Local and ordinary CI artifacts are **unsigned development previews** (any
ad-hoc signature is not a Developer ID signature). They are not notarized releases.
Do not advertise them as ready for Gatekeeper distribution.

Install a Developer ID Application certificate in your build machine's Keychain,
then store notarization credentials using `xcrun notarytool store-credentials`.
No credentials belong in this repository. To produce a signed, notarized app:

```sh
HATSTAND_SIGN=1 \
APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
APPLE_NOTARY_PROFILE='hatstand-notary' \
npm run make
```

The build fails when signing is requested without both settings. Forge signs the
app and native helper with hardened runtime and JIT entitlements, submits to
Apple, and staples the app ticket before DMG/ZIP creation. This path is configured
but must be verified with the maintainer's Apple credentials. If running it in CI,
import the certificate and notarization credentials from GitHub secrets into a
temporary Keychain on a trusted release job; never expose those secrets to pull
requests. Ordinary CI deliberately makes unsigned artifacts and does not publish.

See [Electron Forge signing documentation](https://www.electronforge.io/guides/code-signing/code-signing-macos).
The update check still links to GitHub releases; automatic updates are not added.

## Local verification result

On the Apple silicon development Mac:

- Lint, TypeScript checks and all **50 unit tests** passed, including the existing
  Windows lifecycle, Squirrel launcher and command-line tests.
- Native synthetic process checks and the Electron UI suite passed. A Cocoa
  regression fixture also verifies reopening closed/hidden windows in front,
  preserving the PID and leaving the other profile untouched.
- The packaged `.app` launched, found Claude, used the correct data folder, and
  successfully ran its bundled native helper.
- DMG and ZIP generation and package allowlist/checksum verification passed.
- `npm audit --audit-level=high` reported no vulnerabilities.

Windows and Intel CI jobs are configured but were not run from this Mac. Signing,
notarization and actual login/reboot behavior still require the release checks.

## Before a public release

- Verify the signed artifact with Gatekeeper on a different Mac, including install
  from DMG, update and removal. Confirm removing the app preserves profile data.
- Test menu bar appearance in light/dark modes, Dock focus, start-at-login and
  startup profiles through an actual logout/login.
- Repeat account retention after reboot and test authentication link routing.
- Test Cowork/Code separately and repeat the compatibility checklist on Intel.
- Check VoiceOver and keyboard-only operation.
