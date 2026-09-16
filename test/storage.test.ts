import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { listProfileFolders, measureFolder, resolveRemovableFolder } from '../src/core/storage.ts';
import { isNewerVersion, parseLatestRelease, releasesUrl } from '../src/core/project.ts';
import { compareVersions, newestSquirrelApp } from '../src/core/windows.ts';

const idA = '0f8fad5b-d9cb-469f-a165-70867728950e';
const idB = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-storage-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('leftover folders of removed profiles are listed separately from registered ones', async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, 'profiles', idA, 'desktop'), { recursive: true });
  await fs.writeFile(path.join(root, 'profiles', idA, 'desktop', 'data'), '12345');
  await fs.mkdir(path.join(root, 'profiles', idB), { recursive: true });
  await fs.mkdir(path.join(root, 'profiles', 'not-a-profile'), { recursive: true });
  const folders = await listProfileFolders(root, new Set([idB]));
  assert.deepEqual(folders.map((f) => [f.id, f.registered]).sort(), [
    [idA, false],
    [idB, true],
  ]);
  assert.equal(folders.find((f) => f.id === idA)?.bytes, 5);
});

test('measuring does not follow junctions out of the profile', async (t) => {
  const root = await temporary(t);
  const outside = await temporary(t);
  await fs.writeFile(path.join(outside, 'big'), 'x'.repeat(1000));
  await fs.mkdir(path.join(root, 'inside'));
  await fs.symlink(outside, path.join(root, 'inside', 'link'), 'junction');
  assert.deepEqual(await measureFolder(root), { bytes: 0, partial: false });
});

test('only a plain managed profile folder can be resolved for removal', async (t) => {
  const root = await temporary(t);
  const outside = await temporary(t);
  await fs.mkdir(path.join(root, 'profiles', idA), { recursive: true });
  assert.equal(await resolveRemovableFolder(root, idA), path.join(root, 'profiles', idA));
  await fs.symlink(outside, path.join(root, 'profiles', idB), 'junction');
  await assert.rejects(resolveRemovableFolder(root, idB), /link or junction/);
  await assert.rejects(resolveRemovableFolder(root, '..\\..'), /Invalid profile identifier/);

  const second = await temporary(t);
  await fs.symlink(outside, path.join(second, 'profiles'), 'junction');
  await fs.mkdir(path.join(outside, idA));
  await assert.rejects(resolveRemovableFolder(second, idA), /link or junction/);
});

test('release versions compare semantically', () => {
  assert.equal(isNewerVersion('v0.2.0', '0.1.0'), true);
  assert.equal(isNewerVersion('0.1.0', '0.1.0'), false);
  assert.equal(isNewerVersion('0.10.0', '0.9.9'), true);
  assert.equal(isNewerVersion('1.0.0-beta.2', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', '1.0.0-beta.2'), true);
  assert.equal(isNewerVersion('nonsense', '0.1.0'), false);
});

test('release metadata must link to this repository', () => {
  const release = parseLatestRelease({
    tag_name: 'v0.2.0',
    html_url: `${releasesUrl}/tag/v0.2.0`,
    body: 'Notes',
  });
  assert.equal(release.version, '0.2.0');
  assert.throws(() => parseLatestRelease({ tag_name: 'v0.2.0', html_url: 'https://example.com/release' }));
  assert.throws(() => parseLatestRelease({ tag_name: 'latest', html_url: `${releasesUrl}/tag/latest` }));
});

test('newest Squirrel app folder is chosen numerically', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.deepEqual(newestSquirrelApp(['packages', 'app-0.9.0', 'app-0.10.1', 'app-0.10.0', 'Update.exe']), {
    folder: 'app-0.10.1',
    version: '0.10.1',
  });
  assert.equal(newestSquirrelApp(['packages']), null);
});
