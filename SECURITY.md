# Security

ClientDeck is a session-profile launcher, not an operating-system sandbox. Profiles still share Windows-user permissions, clipboard, and services. See the README.

Do not post credentials, cookies, profile folders, private client names, or conversation content in issues. Diagnostics export only versions and counts. Configure a private reporting channel when publishing the repository; until then, report vulnerabilities directly to the owner without session data.

This unsigned preview has not had an independent security audit. Its renderer uses sandboxing, context isolation, disabled Node integration, and restrictive CSP. IPC validates the originating frame. Packaging is allowlisted and excludes local profiles.

Run `npm audit` before release. Patched dependency overrides avoid older archive dependencies in the Forge graph. Verify distributed artifacts against SHA256SUMS.txt.
