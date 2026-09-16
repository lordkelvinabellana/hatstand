# Contributing

Use Windows x64 and Node.js 24. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run test:ui`, and `npm run make`.

Describe the problem, resulting behavior, and validation. Use synthetic clients in tests/screenshots. Never commit session folders, credentials, tokens, logs, or client content. `.local` is private and excluded from Git and packages.

Core modules live in `src/core`, Electron main/preload in `src/main`, and React in `src/ui`. Preserve validated IPC, exact process ownership before close operations, argument-array launching, and credential-free metadata exports.

Claude-specific behavior is version-dependent. Record observed evidence in `docs/COMPATIBILITY.md`; interface visibility alone does not verify task execution. Original contributions use MIT; dependencies retain their own licenses.
