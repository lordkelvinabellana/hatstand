import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertId, isRecord, validateInput } from './profiles.ts';
import type { Profile } from './profiles.ts';

/**
 * Optional profile sync through the user's own Supabase project. Only profile metadata
 * leaves the computer: never sign-ins, Claude data folders, settings or work-folder paths.
 */
export const syncedFields = [
  'name',
  'accountLabel',
  'color',
  'icon',
  'pet',
  'hotkey',
  'openAtStartup',
  'archived',
] as const;

/** One row of `hatstand_profiles`, as Hatstand reads and writes it. */
export interface SyncRow {
  id: string;
  data: Record<string, unknown>;
  deleted: boolean;
  updated_at: string;
}
export interface SyncResult {
  profiles: Profile[];
  /** Rows the remote is missing or has older copies of. */
  push: SyncRow[];
  /** Local profiles removed because another computer deleted them. */
  removed: string[];
}

export const setupSql = `create table if not exists public.hatstand_profiles (
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
  using (user_id = auth.uid()) with check (user_id = auth.uid());`;

export function toRow(profile: Profile, order: number): SyncRow {
  const data: Record<string, unknown> = { order, createdAt: profile.createdAt };
  for (const field of syncedFields) data[field] = profile[field];
  return { id: profile.id, data, deleted: false, updated_at: profile.updatedAt };
}

/** Validates a row from the remote; rows that fail are skipped, never applied. */
export function parseRow(value: unknown): SyncRow | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.updated_at !== 'string') return null;
  try {
    assertId(value.id);
  } catch {
    return null;
  }
  if (!Number.isFinite(Date.parse(value.updated_at)) || typeof value.deleted !== 'boolean') return null;
  if (!isRecord(value.data)) return null;
  if (!value.deleted) {
    try {
      validateInput(value.data);
    } catch {
      return null;
    }
  }
  return { id: value.id, data: value.data, deleted: value.deleted, updated_at: value.updated_at };
}

const time = (iso: string) => Date.parse(iso) || 0;

/**
 * Merges local profiles and deletion markers with remote rows: per profile, the newer
 * change wins. Local-only fields (work folder) are kept. Pure, so it is tested directly.
 */
export function mergeProfiles(
  local: Profile[],
  tombstones: Record<string, string>,
  remoteRows: SyncRow[],
): SyncResult {
  const remote = new Map(remoteRows.map((row) => [row.id, row]));
  const localById = new Map(local.map((p, index) => [p.id, { profile: p, index }]));
  const ids = new Set([...localById.keys(), ...Object.keys(tombstones), ...remote.keys()]);
  const kept: { profile: Profile; order: number }[] = [];
  const push: SyncRow[] = [];
  const removed: string[] = [];
  for (const id of ids) {
    const mine = localById.get(id);
    const theirs = remote.get(id);
    const deletedAt = tombstones[id];
    const mineAt = mine ? mine.profile.updatedAt : deletedAt;
    if (!theirs || (mineAt && time(mineAt) > time(theirs.updated_at))) {
      // Ours is newer, or the remote has never seen it.
      if (mine) {
        kept.push({ profile: mine.profile, order: mine.index });
        push.push(toRow(mine.profile, mine.index));
      } else if (deletedAt) push.push({ id, data: {}, deleted: true, updated_at: deletedAt });
      continue;
    }
    if (theirs.deleted) {
      if (mine) removed.push(id);
      continue;
    }
    const data = theirs.data;
    const values = validateInput(data);
    kept.push({
      profile: {
        ...values,
        workFolder: mine?.profile.workFolder ?? '',
        id,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : theirs.updated_at,
        updatedAt: theirs.updated_at,
        archived: data.archived === true,
      },
      order: typeof data.order === 'number' ? data.order : (mine?.index ?? Number.MAX_SAFE_INTEGER),
    });
  }
  kept.sort((a, b) => a.order - b.order || a.profile.name.localeCompare(b.profile.name));
  const profiles = kept.map((k) => k.profile);
  // Shortcuts must stay unique: the older of two clashing profiles gives its shortcut up.
  const byKey = new Map<string, Profile>();
  for (const profile of [...profiles].sort((a, b) => time(b.updatedAt) - time(a.updatedAt))) {
    if (!profile.hotkey) continue;
    const key = profile.hotkey.toLowerCase();
    if (byKey.has(key)) profile.hotkey = '';
    else byKey.set(key, profile);
  }
  return { profiles, push, removed };
}

// Deletion markers, so another computer removes a profile instead of bringing it back.
const markerFile = (root: string) => path.join(root, 'sync-deleted.json');
export async function readTombstones(root: string): Promise<Record<string, string>> {
  try {
    const value = JSON.parse(await fs.readFile(markerFile(root), 'utf8'));
    return isRecord(value)
      ? (Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string')) as Record<
          string,
          string
        >)
      : {};
  } catch {
    return {};
  }
}
export async function writeTombstones(root: string, markers: Record<string, string>) {
  const temporary = `${markerFile(root)}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(markers, null, 2));
  await fs.rename(temporary, markerFile(root));
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The few Supabase Auth and REST calls sync needs, without the SDK. */
export class SupabaseClient {
  // Plain fields, not parameter properties: tests load core files with Node's type stripping.
  private url: string;
  private key: string;
  private fetch: Fetch;
  constructor(url: string, key: string, fetch: Fetch) {
    this.url = url;
    this.key = key;
    this.fetch = fetch;
  }
  private async call(pathname: string, init: RequestInit, token?: string) {
    const response = await this.fetch(`${this.url.replace(/\/+$/, '')}${pathname}`, {
      ...init,
      headers: {
        apikey: this.key,
        // Publishable keys go only in apikey; they are not JWTs, so Authorization carries the user's token.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = isRecord(body)
        ? String(body.msg ?? body.message ?? body.error_description ?? body.error ?? '')
        : '';
      throw new Error(message || `Supabase returned ${response.status}.`);
    }
    return body;
  }
  private session(body: unknown): SupabaseSession {
    if (!isRecord(body) || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string')
      throw new Error('Supabase did not return a session.');
    const expires = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: Date.now() + expires * 1000,
    };
  }
  sendCode(email: string) {
    return this.call('/auth/v1/otp', { method: 'POST', body: JSON.stringify({ email, create_user: true }) });
  }
  async verifyCode(email: string, token: string) {
    return this.session(
      await this.call('/auth/v1/verify', {
        method: 'POST',
        body: JSON.stringify({ type: 'email', email, token }),
      }),
    );
  }
  async refresh(refreshToken: string) {
    return this.session(
      await this.call('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      }),
    );
  }
  async pull(token: string): Promise<SyncRow[]> {
    const rows = await this.call(
      '/rest/v1/hatstand_profiles?select=id,data,deleted,updated_at',
      { method: 'GET' },
      token,
    );
    return (Array.isArray(rows) ? rows : []).map(parseRow).filter((row): row is SyncRow => row !== null);
  }
  async push(token: string, rows: SyncRow[]) {
    if (!rows.length) return;
    await this.call(
      '/rest/v1/hatstand_profiles?on_conflict=user_id,id',
      {
        method: 'POST',
        body: JSON.stringify(rows),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      },
      token,
    );
  }
}
