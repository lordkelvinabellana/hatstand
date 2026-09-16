# Compatibility experiment

Status: local preview verified for two signed-in Desktop profiles. This is not a fully verified public V1.

Host tested: Windows x64. Initial Claude MSIX package: **1.52386.6.0**; installation changed to **2.110.0.0** during testing, and profiles were reopened on that build.

## Observed evidence

- The installed application contains a `CLAUDE_USER_DATA_DIR` override that sets Electron's userData location. This is an implementation detail, not a public compatibility guarantee.
- Launching the installed executable with a new `CLAUDE_USER_DATA_DIR`, a matching `--user-data-dir` argument, and a separate `CLAUDE_CONFIG_DIR` created a fresh Claude instance.
- Three main processes ran simultaneously with three separate profile directories and windows. The pre-existing default Claude process remained running.
- Each fresh directory contained its own browser storage and Desktop configuration files. Only directory entry names were inspected, not session contents or credentials.
- The user signed into different client accounts in test-b and test-c and deferred the third account. Both windows showed the authenticated Chat/Cowork/Code interface.
- Both profiles were reopened as new processes on 2.110.0.0 and remained signed in. No credentials or cookie contents were read.
- The packaged launcher detected and focused both adopted profiles by reusing their existing processes. Exiting ClientDeck preserved both running Claude sessions.

## Capability matrix

| Capability | Result |
|---|---|
| MSIX installation discovery | Observed |
| Three simultaneous main processes/windows | Observed |
| Separate browser-data/config directory creation | Observed |
| Two authenticated accounts | User confirmed; signed-in interfaces observed |
| Third account | Deferred by user; Add Profile available |
| Email/Google/SSO return routing | Two user sign-ins succeeded; each method not individually tested |
| Session persistence after quit/reopen | Observed across new processes for both profiles |
| Session persistence after Windows reboot | Pending; no automatic reboot |
| Logout affects only selected account | Pending |
| Cowork execution and state separation | Unverified |
| Desktop Code execution and state separation | Unverified |
| MCP, browser integration and local services | Unverified; shared components are possible |
| Claude update compatibility | 1.52386.6.0 to 2.110.0.0 rediscovery/reopen observed; future versions unverified |
| Packaged launch/focus and manager exit | Focus reused both processes; manager exit preserved them |

## Manual account test

1. Open the three test profiles with `npm run probe -- launch` if they are not already running.
2. Sign into a different authorized account in each official Claude window. Do not send credentials to ClientDeck or put them in its files.
3. Check that the intended account appears in each window. Record pass/fail without client emails or screenshots of private content.
4. Quit and reopen one test profile; verify the account remains correct and the other profiles remain signed in.
5. Repeat for the other profiles. Separately test the sign-in return behavior for any other authentication methods you use.
6. At a convenient time, reboot Windows and repeat launch/account checks.
7. Run harmless Cowork and Desktop Code tasks in separate empty client folders. Check account selection, history visibility, permissions, and connectors separately.

Do not declare full isolation from a successful sign-in test. All profiles still run under the same Windows user. The launcher is not a filesystem sandbox.

## Gate

The user's two sign-ins and observed reopen persistence satisfied the local preview's account gate. Reboot behavior, logout isolation, authentication-method coverage, Cowork/Code tasks, and integration separation require further checks before stable public V1 claims. No account logout or reboot was performed automatically.
