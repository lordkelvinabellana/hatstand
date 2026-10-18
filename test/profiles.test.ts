import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acceleratorKey, normalizeAccelerator } from '../src/core/accelerator.ts';
import { findProfileByArgument, newProfile, validateInput, validateState } from '../src/core/profiles.ts';
import { defaults, readSettings, validateSettings } from '../src/core/settings.ts';
import { ProfileStore } from '../src/core/store.ts';

test('preview (schema 1) profile files load with defaults and are saved as schema 2', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-schema-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = {
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    name: 'Client A',
    accountLabel: '',
    color: 'teal',
    icon: 'CA',
    archived: false,
    createdAt: '2026-09-16T00:00:00.000Z',
  };
  await fs.writeFile(
    path.join(root, 'profiles.json'),
    JSON.stringify({ schemaVersion: 1, profiles: [legacy] }),
  );
  const store = new ProfileStore(root);
  const loaded = (await store.load()).profiles[0];
  assert.deepEqual(
    { hotkey: loaded.hotkey, workFolder: loaded.workFolder, openAtStartup: loaded.openAtStartup },
    { hotkey: '', workFolder: '', openAtStartup: false },
  );
  await store.archive(legacy.id, true);
  const saved = JSON.parse(await fs.readFile(path.join(root, 'profiles.json'), 'utf8'));
  assert.equal(saved.schemaVersion, 2);
  const backup = JSON.parse(await fs.readFile(path.join(root, 'profiles.json.backup'), 'utf8'));
  assert.equal(backup.schemaVersion, 1, 'the pre-upgrade file is kept as the backup');
});

test('files from a newer, unknown schema are refused rather than rewritten', () => {
  assert.throws(() => validateState({ schemaVersion: 3, profiles: [] }), /newer Hatstand/);
});

test('accelerators are normalized and unsafe ones rejected', () => {
  assert.equal(normalizeAccelerator(''), '');
  assert.equal(normalizeAccelerator('ctrl+alt+1'), 'Control+Alt+1');
  assert.equal(normalizeAccelerator('CommandOrControl+Shift+space'), 'CommandOrControl+Shift+Space');
  assert.equal(normalizeAccelerator('F9'), 'F9');
  for (const bad of ['A', 'Shift+A', 'Ctrl+Ctrl+A', 'Ctrl+Nope', 'Hyper+A', 'Ctrl+', 'x'.repeat(81)])
    assert.throws(() => normalizeAccelerator(bad), bad);
  assert.equal(
    acceleratorKey('CommandOrControl+Shift+K', 'win32'),
    acceleratorKey('Shift+Control+K', 'win32'),
  );
});

test('two profiles cannot share a shortcut', () => {
  const a = newProfile({ name: 'A', hotkey: 'Ctrl+Alt+1' });
  const b = newProfile({ name: 'B', hotkey: 'Alt+Control+1' });
  assert.throws(() => validateState({ schemaVersion: 2, profiles: [a, b] }), /already used/);
});

test('work folders must be absolute paths and startup must be boolean', () => {
  assert.equal(validateInput({ name: 'A', workFolder: 'C:\\Clients\\A' }).workFolder, 'C:\\Clients\\A');
  assert.throws(() => validateInput({ name: 'A', workFolder: 'relative\\folder' }));
  assert.throws(() => validateInput({ name: 'A', openAtStartup: 'yes' }));
});

test('--profile accepts an identifier or a unique active profile name', () => {
  const a = newProfile({ name: 'North Studio' });
  const b = newProfile({ name: 'Acorn' });
  const archived = { ...newProfile({ name: 'Old' }), archived: true };
  const twins = [newProfile({ name: 'Twin' }), newProfile({ name: 'twin' })];
  const profiles = [a, b, archived, ...twins];
  assert.equal(findProfileByArgument(profiles, a.id).id, a.id);
  assert.equal(findProfileByArgument(profiles, 'north studio').id, a.id);
  assert.throws(() => findProfileByArgument(profiles, 'Old'), /No profile/);
  assert.throws(() => findProfileByArgument(profiles, 'Twin'), /More than one/);
  assert.throws(() => findProfileByArgument(profiles, ''), /Invalid/);
});

test('settings from older versions gain new defaults; invalid values are rejected', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-settings-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, 'settings.json'),
    JSON.stringify({
      theme: 'dark',
      minimizeToTray: false,
      startWithWindows: false,
      hotkey: '',
      executable: '',
    }),
  );
  const settings = await readSettings(root);
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.setupComplete, false);
  assert.equal(settings.pets, true);
  assert.equal(settings.petSounds, true);
  assert.throws(() => validateSettings({ ...defaults, pets: 'yes' }));
  assert.throws(() => validateSettings({ ...defaults, executable: 'relative\\Claude.exe' }));
  assert.throws(() => validateSettings({ ...defaults, hotkey: 'A' }));
});

test('metadata exported by the 0.0.1 preview (ClientDeck) still imports', async () => {
  const { parseImport } = await import('../src/core/profiles.ts');
  const legacy = JSON.stringify({
    format: 'clientdeck-profile-metadata',
    version: 1,
    profiles: [{ name: 'Client A', accountLabel: '', color: 'amber', icon: 'CA' }],
  });
  assert.equal(parseImport(legacy)[0].name, 'Client A');
});
