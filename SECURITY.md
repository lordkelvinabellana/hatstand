# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/lordkelvinabellana/clientdeck/security/advisories/new)). Include the ClientDeck version, Windows version, and steps to reproduce.

Never include profile folders, cookies, tokens, account emails, client names, or conversation content, even in private reports. Synthetic reproductions are enough.

You should get an acknowledgement within 7 days. Fixes are released as soon as practical and credited in the advisory unless you'd rather stay anonymous.

## Supported versions

Only the latest release receives security fixes during the preview.

## Security model

ClientDeck is a **profile launcher, not a sandbox**. Every profile runs as the same Windows user, with the same access to files, clipboard, network, and local services. Someone who can run code as that user can read every profile's data.

Within that boundary, ClientDeck:

- runs its renderer sandboxed, with context isolation, no Node integration, and a restrictive Content Security Policy;
- accepts IPC only from its own main frame and validates every payload in the main process;
- identifies Claude processes by exact executable path and a single `--user-data-dir` before focusing or closing them, and only closes that process tree;
- starts Claude with argument arrays and removes `CLAUDE_*`, `ANTHROPIC_*`, `ELECTRON_*`, and `NODE_OPTIONS` variables from its environment;
- refuses to create or remove profile storage through links or junctions, and moves data to the Recycle Bin instead of deleting it;
- exports only names, labels, colors, and initials;
- makes network requests only when you choose **Check for updates**, and only opens release links on this repository.

It has not had an independent security audit. Preview binaries are not yet code-signed. Verify downloads against the `SHA256SUMS.txt` published with each release.
