import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProfileStore } from '../src/core/store.ts';
import { exportMetadata, newProfile, parseImport, validateState } from '../src/core/profiles.ts';
import {
  ensurePlainDirectory,
  launchEnvironment,
  ownsProcess,
  profilePaths,
  splitWindowsCommandLine,
} from '../src/core/launch.ts';

async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clientdeck-test-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
test('renaming a client preserves its storage identity after reload', async (t) => {
  const root = await temporary(t);
  const store = new ProfileStore(root);
  const created = await store.create({ name: 'Client A' });
  const before = profilePaths(root, created.id);
  await store.update(created.id, { name: 'Renamed client', color: 'blue' });
  const reloaded = (await new ProfileStore(root).load()).profiles[0];
  assert.equal(reloaded.name, 'Renamed client');
  assert.deepEqual(profilePaths(root, reloaded.id), before);
});
test('concurrent updates do not lose profiles', async (t) => {
  const store = new ProfileStore(await temporary(t));
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.create({ name: `Client ${i}` })));
  assert.equal((await store.load()).profiles.length, 12);
});
test('corrupt metadata is preserved rather than overwritten', async (t) => {
  const root = await temporary(t);
  const filename = path.join(root, 'profiles.json');
  await fs.writeFile(filename, '{invalid');
  const store = new ProfileStore(root);
  await assert.rejects(store.create({ name: 'Client' }));
  assert.equal(await fs.readFile(filename, 'utf8'), '{invalid');
});
test('removing a profile preserves its local data', async (t) => {
  const root = await temporary(t);
  const store = new ProfileStore(root);
  const profile = await store.create({ name: 'Client' });
  const directories = profilePaths(root, profile.id);
  await ensurePlainDirectory(directories.desktop, root);
  const marker = path.join(directories.desktop, 'test-marker');
  await fs.writeFile(marker, 'retained');
  await store.remove(profile.id);
  assert.equal((await store.load()).profiles.length, 0);
  assert.equal(await fs.readFile(marker, 'utf8'), 'retained');
});
test('invalid reordering cannot drop or duplicate a profile', async (t) => {
  const store = new ProfileStore(await temporary(t));
  const a = await store.create({ name: 'A' }),
    b = await store.create({ name: 'B' });
  await assert.rejects(store.reorder([a.id, a.id]));
  await assert.rejects(store.reorder([a.id]));
  await store.reorder([b.id, a.id]);
  assert.deepEqual(
    (await store.load()).profiles.map((p) => p.id),
    [b.id, a.id],
  );
});
test('metadata export/import creates fresh identities and excludes storage paths', async (t) => {
  const store = new ProfileStore(await temporary(t));
  const a = await store.create({ name: 'A', accountLabel: 'user-supplied label' });
  const serialized = exportMetadata(await store.load());
  assert.equal(serialized.includes(a.id), false);
  assert.equal(serialized.includes('desktop'), false);
  const [b] = await store.importProfiles(parseImport(serialized));
  assert.notEqual(b.id, a.id);
  assert.equal(b.name, a.name);
});
test('imports reject executable commands, paths, unknown versions and oversize input', () => {
  for (const extra of [{ command: 'run something' }, { dataDir: 'C:\\other' }, { cookies: 'secret' }]) {
    assert.throws(() =>
      parseImport(
        JSON.stringify({
          format: 'clientdeck-profile-metadata',
          version: 1,
          profiles: [{ name: 'A', ...extra }],
        }),
      ),
    );
  }
  assert.throws(() => parseImport('{"format":"clientdeck-profile-metadata","version":2,"profiles":[]}'));
  assert.throws(() => parseImport(' '.repeat(1_000_001)));
});
test('profile identifiers reject path traversal', () => {
  for (const value of ['../other', '..\\other', 'C:\\other', '', '__proto__'])
    assert.throws(() => profilePaths('C:\\managed', value));
});
test('duplicate saved identifiers are rejected', () => {
  const a = newProfile({ name: 'A' });
  assert.throws(() => validateState({ schemaVersion: 1, profiles: [a, a] }));
});
test('storage rejects junctions pointing outside its tree', async (t) => {
  const root = await temporary(t);
  const outside = await temporary(t);
  await fs.symlink(outside, path.join(root, 'redirect'), 'junction');
  await assert.rejects(ensurePlainDirectory(path.join(root, 'redirect', 'client'), root));
  await assert.rejects(fs.access(path.join(outside, 'client')));
});
test('launch environment does not inherit Claude credentials or developer overrides', () => {
  const env = launchEnvironment(
    {
      PATH: 'kept',
      SystemRoot: 'kept',
      ANTHROPIC_API_KEY: 'sensitive',
      claude_ai_url: 'wrong',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--inspect',
    },
    'desktop-A',
    'code-A',
  );
  assert.deepEqual(env, {
    PATH: 'kept',
    SystemRoot: 'kept',
    CLAUDE_USER_DATA_DIR: 'desktop-A',
    CLAUDE_CONFIG_DIR: 'code-A',
  });
});
test('process ownership is exact and rejects lookalikes and subprocesses', () => {
  const exe = 'C:\\Program Files\\Claude\\Claude.exe',
    data = 'C:\\Profiles\\Client A';
  const p = {
    pid: 123,
    executable: exe,
    createdAt: '2026-09-16',
    commandLine: `"${exe}" "--user-data-dir=${data}"`,
  };
  assert.equal(ownsProcess(p, exe, data), true);
  assert.equal(ownsProcess({ ...p, commandLine: p.commandLine + '-other' }, exe, data), false);
  assert.equal(ownsProcess({ ...p, commandLine: p.commandLine + ' --type=renderer' }, exe, data), false);
  assert.equal(ownsProcess({ ...p, executable: 'C:\\Other\\Claude.exe' }, exe, data), false);
  assert.equal(
    ownsProcess({ ...p, commandLine: p.commandLine + ` "--user-data-dir=${data}"` }, exe, data),
    false,
  );
  assert.equal(ownsProcess({ ...p, pid: 0 }, exe, data), false);
});
test('Windows argument parsing handles quoted spaces and escaped quotes', () => {
  assert.deepEqual(
    splitWindowsCommandLine('"C:\\Program Files\\Claude.exe" "--user-data-dir=C:\\Client A"'),
    ['C:\\Program Files\\Claude.exe', '--user-data-dir=C:\\Client A'],
  );
  assert.deepEqual(splitWindowsCommandLine('app "" abc'), ['app', '', 'abc']);
  assert.deepEqual(splitWindowsCommandLine('app "a\\"b"'), ['app', 'a"b']);
  assert.throws(() => splitWindowsCommandLine('app "unfinished'));
});
