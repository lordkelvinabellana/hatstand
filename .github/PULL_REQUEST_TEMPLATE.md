## What and why

<!-- What does this change, and what problem does it solve? Link the issue. -->

## How it was verified

- [ ] `npm run lint`, `npm run typecheck`, `npm test`
- [ ] `npm run build` and `npm run test:ui`
- [ ] Manually tested with Claude Desktop (version: …), or not applicable

## Checklist

- [ ] No profile folders, credentials, logs, real client names, or screenshots of real accounts
- [ ] New IPC payloads are validated in `src/main/handlers.ts`
- [ ] Data is preserved by default; any removal goes to the Recycle Bin after path checks
- [ ] Compatibility claims updated in both `src/core/compat.ts` and `docs/COMPATIBILITY.md`, if any
- [ ] `CHANGELOG.md` updated for user-visible changes
