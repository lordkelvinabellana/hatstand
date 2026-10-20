import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { withFileLock, writeFileAtomic } from '../src/core/files.ts';

test('concurrent read-modify-writes under withFileLock keep every change and leave no temp files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-files-'));
  const file = path.join(dir, 'settings.json');
  await fs.writeFile(file, '{}');
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      withFileLock(file, async () => {
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
        await writeFileAtomic(file, JSON.stringify({ ...value, [`k${i}`]: i }));
      }),
    ),
  );
  assert.equal(Object.keys(JSON.parse(await fs.readFile(file, 'utf8'))).length, 20);
  assert.deepEqual(await fs.readdir(dir), ['settings.json']);
  // a failed task doesn't block the queue
  await assert.rejects(
    withFileLock(file, async () => {
      throw new Error('boom');
    }),
  );
  assert.equal(await withFileLock(file, async () => 'next'), 'next');
  await fs.rm(dir, { recursive: true, force: true });
});
