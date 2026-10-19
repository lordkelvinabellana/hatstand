import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Profile } from '../src/core/profiles.ts';
import {
  mergeProfiles,
  parseRow,
  readTombstones,
  setupSql,
  SupabaseClient,
  toRow,
  writeTombstones,
} from '../src/core/sync.ts';

const id = (n: number) => `0f8fad5b-d9cb-469f-a165-7086772895${String(n).padStart(2, '0')}`;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute)).toISOString();
function profile(n: number, minute: number, extra: Partial<Profile> = {}): Profile {
  return {
    id: id(n),
    name: `Client ${n}`,
    accountLabel: '',
    color: 'teal',
    icon: 'C',
    pet: 'cat',
    hotkey: '',
    workFolder: '',
    openAtStartup: false,
    archived: false,
    createdAt: at(0),
    updatedAt: at(minute),
    ...extra,
  };
}

test('the newer copy of each profile wins, in either direction', () => {
  const local = [profile(1, 5, { name: 'Local newer' }), profile(2, 1, { name: 'Local older' })];
  const remote = [
    toRow(profile(1, 2, { name: 'Remote older' }), 0),
    toRow(profile(2, 9, { name: 'Remote newer', color: 'rose' }), 1),
  ];
  const result = mergeProfiles(local, {}, remote);
  assert.deepEqual(
    result.profiles.map((p) => p.name),
    ['Local newer', 'Remote newer'],
  );
  assert.equal(result.profiles[1].color, 'rose');
  assert.deepEqual(
    result.push.map((r) => r.data.name),
    ['Local newer'],
  );
});

test('work folders stay local, and a profile from another computer is added in its order', () => {
  const local = [profile(1, 1, { workFolder: '/Users/me/Clients/One' })];
  const remote = [toRow(profile(1, 3, { workFolder: '/Users/other/One' }), 1), toRow(profile(2, 3), 0)];
  const result = mergeProfiles(local, {}, remote);
  assert.deepEqual(
    result.profiles.map((p) => p.id),
    [id(2), id(1)],
  );
  assert.equal(result.profiles[1].workFolder, '/Users/me/Clients/One');
  assert.equal(result.profiles[0].workFolder, '');
  assert.equal('workFolder' in toRow(local[0], 0).data, false);
});

test('deletions travel both ways, and a newer edit elsewhere brings a profile back', () => {
  // Deleted here after the remote's last change: push a deletion marker.
  let result = mergeProfiles([], { [id(1)]: at(8) }, [toRow(profile(1, 2), 0)]);
  assert.deepEqual(result.profiles, []);
  assert.deepEqual(result.push, [{ id: id(1), data: {}, deleted: true, updated_at: at(8) }]);
  // Deleted elsewhere after our last change: remove it here.
  result = mergeProfiles([profile(1, 2)], {}, [{ id: id(1), data: {}, deleted: true, updated_at: at(8) }]);
  assert.deepEqual(result.removed, [id(1)]);
  assert.deepEqual(result.profiles, []);
  // Edited elsewhere after our deletion: it comes back.
  result = mergeProfiles([], { [id(1)]: at(2) }, [toRow(profile(1, 8), 0)]);
  assert.deepEqual(
    result.profiles.map((p) => p.id),
    [id(1)],
  );
});

test('two profiles never end up sharing a shortcut; the older one gives it up', () => {
  const local = [profile(1, 1, { hotkey: 'CommandOrControl+Shift+1' })];
  const remote = [toRow(profile(2, 5, { hotkey: 'CommandOrControl+Shift+1' }), 1)];
  const result = mergeProfiles(local, {}, remote);
  assert.equal(result.profiles.find((p) => p.id === id(2))?.hotkey, 'CommandOrControl+Shift+1');
  assert.equal(result.profiles.find((p) => p.id === id(1))?.hotkey, '');
});

test('the setup guide shows the same SQL the code expects', async () => {
  const guide = await fs.readFile(path.join(import.meta.dirname, '..', 'docs', 'SYNC.md'), 'utf8');
  assert.ok(guide.includes(setupSql));
});

test('remote rows are validated before they can be applied', () => {
  const good = toRow(profile(1, 1), 0);
  assert.ok(parseRow(good));
  assert.equal(parseRow({ ...good, id: '../etc' }), null);
  assert.equal(parseRow({ ...good, updated_at: 'yesterday' }), null);
  assert.equal(parseRow({ ...good, data: { ...good.data, color: 'neon' } }), null);
  assert.ok(parseRow({ id: id(2), data: {}, deleted: true, updated_at: at(1) }));
});

test('deletion markers are kept in a file next to the profiles', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.deepEqual(await readTombstones(root), {});
  await writeTombstones(root, { [id(1)]: at(3) });
  assert.deepEqual(await readTombstones(root), { [id(1)]: at(3) });
});

test('the Supabase client sends the key, the user token and an upsert', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = url.includes('/auth/v1/verify')
      ? { access_token: 'a', refresh_token: 'r', expires_in: 60 }
      : url.includes('select=')
        ? [toRow(profile(1, 1), 0), { id: 'bad' }]
        : null;
    return new Response(body === null ? '' : JSON.stringify(body), { status: 200 });
  };
  const client = new SupabaseClient('https://demo.supabase.co/', 'pk', fake);
  const session = await client.verifyCode('me@example.com', '123456');
  assert.equal(session.refresh_token, 'r');
  assert.equal('Authorization' in (calls[0].init.headers as Record<string, string>), false);
  assert.equal((await client.pull('a')).length, 1);
  await client.push('a', [toRow(profile(1, 1), 0)]);
  const push = calls.at(-1)!;
  assert.equal(push.url, 'https://demo.supabase.co/rest/v1/hatstand_profiles?on_conflict=user_id,id');
  const headers = push.init.headers as Record<string, string>;
  assert.equal(headers.apikey, 'pk');
  assert.equal(headers.Authorization, 'Bearer a');
  assert.match(headers.Prefer, /merge-duplicates/);
  const failing = new SupabaseClient(
    'https://demo.supabase.co',
    'pk',
    async () => new Response(JSON.stringify({ msg: 'Token has expired or is invalid' }), { status: 403 }),
  );
  await assert.rejects(failing.verifyCode('me@example.com', '000000'), /expired or is invalid/);
});
