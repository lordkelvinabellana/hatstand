# Research: telling client windows apart

**Problem.** Every profile opens a Claude window with the same title, icon, and taskbar group. With two or three clients open, it's easy to type into the wrong account. Hatstand already knows which top-level window belongs to which profile: it can map the owned process ID to its windows.

**Constraints.** Don't modify Claude's installed files, inject code into Claude, or rely on anything that could affect the signed-in session. Any approach must fail harmlessly when Claude changes.

None of the options below has been tried yet. Each needs a throwaway proof of concept on a test profile before it goes into Hatstand.

| # | Approach | How | Expected benefit | Risks and unknowns |
|---|---|---|---|---|
| 1 | Separate taskbar groups | Set `PKEY_AppUserModel_ID` (plus relaunch name and icon) on the Claude window's property store with `SHGetPropertyStoreForWindow` | Each client gets its own taskbar button, with the client's name and icon on hover and in the jump list | Unknown whether another process may write these properties; Claude or Chromium might reset them; pinning behavior |
| 2 | Colored window border | `DwmSetWindowAttribute(DWMWA_BORDER_COLOR)` in the client's color (Windows 11) | Instantly visible, and no extra window | Probably refused for windows owned by another process; only works on Windows 11 |
| 3 | Floating client label | A small Hatstand-owned, click-through window pinned to the active Claude window's title bar, tracked with `SetWinEventHook` | Works on any Claude version; fully under Hatstand's control | Requires a native helper; must follow moves, snaps, full screen, and multiple monitors; could feel intrusive |
| 4 | Window title prefix | `SetWindowText` on the Claude window | Visible in Alt+Tab and the taskbar | Claude rewrites its title when the page changes, so the prefix won't last |
| 5 | Taskbar overlay badge | `ITaskbarList3::SetOverlayIcon` with the client's initials | Small, standard Windows affordance | The taskbar may accept overlays only from the window's own process |

**Suggested order:** 1, then 3 as a fallback, then 2 as an optional extra on Windows 11. 4 and 5 are unlikely to be reliable.

**Implementation notes.** Windows APIs need a native helper, either a small signed executable or a Node addon, behind the existing launch adapter. Match windows to profiles only through process ownership that has already been verified. Re-apply after Claude restarts, and leave windows untouched if matching is uncertain.
