# Releasing

Releases are built by GitHub Actions and published by a maintainer.

## Steps

1. Make sure `main` is green and the manual checks in [COMPATIBILITY.md](COMPATIBILITY.md) that apply to the change have been done.
2. Update `version` in `package.json` (and `package-lock.json` with `npm install --package-lock-only`).
3. Move the **Unreleased** entries in `CHANGELOG.md` under the new version with today's date.
4. If you tested a new Claude Desktop version, add it to `testedClaudeVersions` in `src/core/compat.ts` and to `docs/COMPATIBILITY.md`.
5. Commit, then tag and push:

   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

6. The **Release** workflow builds the Windows installer and ZIP and the Mac DMGs (arm64 and x64), verifies the package allowlist on each, writes one `SHA256SUMS.txt` for every file, and creates a **draft** GitHub release with them.
7. Download the draft's installer on a clean Windows VM. Install it, upgrade from the previous release, launch, and uninstall. Confirm `%LOCALAPPDATA%\HatstandData` survives the uninstall.
8. Edit the release notes (copy the changelog section), then publish.

The in-app **Check for updates** reads the latest published, non-draft release. Tags must look like `v1.2.3` or `v1.2.3-beta.1`.

## Code signing

Preview releases are unsigned. Before 1.0, set up one of:

- **[SignPath Foundation](https://signpath.org/)**: free code signing for qualifying open-source projects, integrated with GitHub Actions.
- **[Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/)**: low-cost managed certificates; requires identity validation.

Sign `Hatstand.exe` before packaging, and `Setup.exe` after `electron-forge make`. Keep signing credentials in GitHub environment secrets with required reviewers, never in the repository. Signing doesn't grant SmartScreen reputation immediately.

## Artifact contents

`scripts/verify-artifacts.mjs` fails the build if `app.asar` contains anything outside `dist/`, `resources/`, `package.json`, and `LICENSE`. No profile data, `.local/` contents, or source maps are packaged.

## macOS

See [macOS signing and distribution](MACOS.md#signing-and-distribution). Releases include unsigned Mac DMGs for arm64 and x64. macOS blocks their first open until the user clicks **Open Anyway** in System Settings → Privacy & Security; the website and release notes say so. Developer ID signing and notarization would remove that step.
