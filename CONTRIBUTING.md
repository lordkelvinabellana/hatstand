# Contributing to Hatstand

Thanks for helping. Hatstand is small on purpose: a trustworthy launcher that makes separate Claude Desktop profiles easy to use, without overstating what it can guarantee.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Check [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need Windows x64 and Node.js 24. Claude Desktop is only needed to try launching profiles; the automated tests never start it.

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:ui
```

`npm run format` fixes formatting. CI runs all of the above plus `npm audit --audit-level=high` and a full installer build.

## Project layout

| Path | What lives there |
|---|---|
| `src/core/` | Platform logic with no Electron imports: profile schema, storage, process ownership, the launch/close lifecycle (`controller.ts`), Windows detection. Unit-tested. |
| `src/main/` | Electron main process: IPC handlers, tray, shortcuts, jump list, Squirrel events. |
| `src/ui/` | React renderer. `App.tsx` holds shared state; screens live in `components/`. |
| `test/` | `node:test` unit tests for `src/core` and `src/ui/order.ts`. |
| `scripts/` | Build, packaging, icon generation, and UI tests. |
| `scripts/dev/` | Maintainer tools that touch a real Claude installation. Not run in CI. |

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing IPC, storage, or process handling.

## Ground rules

These protect users' signed-in sessions. Pull requests that weaken them won't be merged.

- **Never commit** profile folders, `.local/`, credentials, tokens, logs, screenshots of real accounts, or client names. Tests and screenshots use synthetic clients such as "North Studio".
- **Validate every IPC payload** in `src/main/handlers.ts`. The renderer is untrusted.
- **Match processes exactly** (executable plus a single `--user-data-dir`) before focusing or closing anything. Never target processes by image name.
- **Launch with argument arrays**, never shell strings.
- **Preserve data by default.** Anything that removes data must resolve the exact path, refuse links and junctions, check the profile isn't running, and use the Recycle Bin.
- **Exports stay credential-free**: no paths, shortcuts, or session data.
- **Only claim what was observed.** Process status isn't sign-in status. Compatibility claims go in `src/core/compat.ts` and `docs/COMPATIBILITY.md` together, with the Claude version tested.

## Pull requests

- Keep changes focused, and add or update tests for behavior changes. Lifecycle logic belongs in `Controller`, where it can be tested with fakes.
- Describe what changed, why, and how you verified it. For UI changes, include before/after screenshots with synthetic data.
- Update `CHANGELOG.md` under **Unreleased** for user-visible changes.

## Licensing

Contributions are accepted under the [MIT License](LICENSE). Dependencies keep their own licenses. Don't add code copied from Claude Desktop or other proprietary software.
