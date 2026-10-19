# Sync profiles (optional)

Hatstand can keep your profile list in **your own** Supabase project, so a second computer
(or a reinstall) gets the same clients, colors, pets, order and shortcuts.

**What syncs:** name, account label, color, pet, initials, order, per-profile shortcut,
open at login, and archived. **What never syncs:** Claude sign-ins and data folders,
Hatstand settings, work-folder paths, and pet session files. Sync is off until you turn it on,
and Hatstand makes no sync requests while it is off.

## 1. Create the table

Create a free project at [supabase.com](https://supabase.com), open **SQL Editor**, and run:

```sql
create table if not exists public.hatstand_profiles (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id uuid not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null,
  primary key (user_id, id)
);
alter table public.hatstand_profiles enable row level security;
create policy "Each user reads and writes only their own profiles"
  on public.hatstand_profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Row-level security means each signed-in user can read and write only their own rows.

## 2. Let Supabase email a sign-in code

Hatstand signs in with a one-time code, so it never asks for a password.

1. **Authentication → Providers → Email**: keep Email enabled.
2. **Authentication → Email Templates → Magic Link**: make sure the template contains
   `{{ .Token }}` (the code). For example: `Your Hatstand code is {{ .Token }}`.

## 3. Connect Hatstand

1. **Project Settings → API Keys**: copy the project URL and the **publishable** key
   (`sb_publishable_…`, or the legacy `anon` key). Hatstand refuses secret and
   `service_role` keys, because they bypass row-level security.
2. In Hatstand, **Settings → Sync profiles**: paste both, enter your email, and choose
   **Email me a sign-in code**.
3. Enter the code from the email and choose **Sign in and sync**.

Repeat step 3 on each computer with the same email.

## How it behaves

- **Newest change wins, per profile.** Editing a client on one computer and a different client
  on another keeps both edits. If the same profile changed on both, the later edit wins.
- **Removing a profile** removes it on your other computers too. Its local Claude data stays
  on each computer, exactly as when you remove a profile in Hatstand.
- **Shortcuts stay unique.** If two profiles end up with the same shortcut, the one changed
  longer ago loses it.
- **When it runs:** at start, a couple of seconds after any change, every 10 minutes, and on
  **Sync now**. Offline, it shows the error and tries again later; nothing local is lost.
- **Pause sync** stops syncing but keeps you signed in. **Sign out** forgets the sign-in.

## Where things are stored

| What | Where |
|---|---|
| Project URL, publishable key, email | `HatstandData/settings.json` (none of these is a secret) |
| Sign-in session | `HatstandData/sync-session.bin`, encrypted with the macOS Keychain or Windows DPAPI |
| Profiles waiting to be deleted remotely | `HatstandData/sync-deleted.json` |
