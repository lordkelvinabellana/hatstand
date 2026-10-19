import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Controller } from '../src/core/controller.ts';
import type { Profile } from '../src/core/profiles.ts';
import { checkVault, saveBrain, sharersOf, vaultFolders, vaultLabel } from '../src/main/brain.ts';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-share-'));
  const controller = {
    directories: (id: string) => {
      const base = path.join(root, 'profiles', id);
      return { base, desktop: path.join(base, 'desktop'), code: path.join(base, 'code'), trusted: base };
    },
  } as unknown as Controller;
  const profiles = [
    { id: a, name: 'Stakra', archived: false },
    { id: b, name: 'HnyX', archived: false },
  ] as Profile[];
  return { root, controller, profiles };
}

test('a shared vault: joining it needs an explicit share, and both profiles then write to it', async () => {
  const { root, controller, profiles } = await setup();
  const shared = path.join(root, 'vaults', 'Stakra');
  await saveBrain(root, a, { enabled: true, vault: shared });
  await saveBrain(root, b, { enabled: true, vault: '' });

  await assert.rejects(checkVault(root, controller, profiles, b, shared), /Each profile keeps its own vault/);
  assert.equal(await checkVault(root, controller, profiles, b, shared, true), shared);

  await saveBrain(root, b, { enabled: true, vault: shared });
  assert.deepEqual(await sharersOf(root, controller, profiles, a, shared), [b]);
  assert.equal(await vaultLabel(root, controller, profiles, shared), 'Stakra + HnyX');
  assert.deepEqual(await vaultFolders(root, controller, profiles), [shared]);
});

test('sharing never lets a profile point into another profile’s own data', async () => {
  const { root, controller, profiles } = await setup();
  await saveBrain(root, a, { enabled: true, vault: '' });
  const ownDefault = path.join(controller.directories(a).base, 'vault');
  await assert.rejects(checkVault(root, controller, profiles, b, ownDefault, true), /overlaps Stakra/);
  // A folder inside a shared vault is still refused: only the vault itself can be shared.
  const shared = path.join(root, 'vaults', 'Stakra');
  await saveBrain(root, a, { enabled: true, vault: shared });
  await assert.rejects(
    checkVault(root, controller, profiles, b, path.join(shared, 'Clients'), true),
    /overlaps/,
  );
});
