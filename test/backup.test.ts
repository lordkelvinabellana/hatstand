import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backupVault } from '../src/core/brain.ts';
import { withPetHooks, withoutPetHooks } from '../src/core/pets.ts';
import { captureCommand } from '../src/core/vault.ts';

test('backup copies new and changed notes, skips hidden files and never deletes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-backup-'));
  const vault = path.join(root, 'vault');
  const dest = path.join(root, 'Obsidian', 'Kam');
  await fs.mkdir(path.join(vault, 'Clients'), { recursive: true });
  await fs.mkdir(path.join(vault, '.hatstand'), { recursive: true });
  await fs.writeFile(path.join(vault, 'Clients', 'Aether.md'), 'v1');
  await fs.writeFile(path.join(vault, '.hatstand', 'inferred-links.json'), '{}');
  assert.equal(backupVault(vault, dest), 1);
  assert.equal(await fs.readFile(path.join(dest, 'Clients', 'Aether.md'), 'utf8'), 'v1');
  await assert.rejects(fs.access(path.join(dest, '.hatstand')));
  assert.equal(backupVault(vault, dest), 0, 'unchanged files are not copied again');
  await fs.writeFile(path.join(vault, 'Clients', 'Aether.md'), 'v2 longer');
  assert.equal(backupVault(vault, dest), 1);
  assert.equal(await fs.readFile(path.join(dest, 'Clients', 'Aether.md'), 'utf8'), 'v2 longer');
  await fs.rm(path.join(vault, 'Clients', 'Aether.md'));
  backupVault(vault, dest);
  await fs.access(path.join(dest, 'Clients', 'Aether.md')); // a backup never deletes
});

test('the capture command carries the backup folder only when one is set', () => {
  assert.doesNotMatch(captureCommand('/H', '/c.cjs', '/v', 'Kam'), /--backup/);
  assert.match(captureCommand('/H', '/c.cjs', '/v', 'Kam', "/O/Kam's"), / --backup '\/O\/Kam'\\''s'$/);
});

test('removing pet hooks keeps the user’s own hooks and drops emptied events', () => {
  const mine = { hooks: [{ type: 'command', command: 'echo mine' }] };
  const withPets = withPetHooks({ hooks: { Stop: [mine] }, model: 'x' }, '/data/pet-hook.sh');
  const clean = withoutPetHooks(withPets);
  assert.deepEqual(clean, { hooks: { Stop: [mine] }, model: 'x' });
  assert.deepEqual(withoutPetHooks(withPetHooks({}, '/data/pet-hook.sh')), {});
});
