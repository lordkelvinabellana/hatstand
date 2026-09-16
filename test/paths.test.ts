import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensurePlainDirectory, splitWindowsCommandLine } from '../src/core/launch.ts';
import {
  dataRoot,
  joinWindowsCommandLine,
  legacyDataRoot,
  migrateLegacyData,
  quoteWindowsArgument,
  stableLauncher,
} from '../src/core/paths.ts';

async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clientdeck-paths-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test('data folder is not the Squirrel install folder', () => {
  const local = 'C:\\Users\\A\\AppData\\Local';
  assert.notEqual(dataRoot(local), legacyDataRoot(local));
  assert.equal(path.relative(legacyDataRoot(local), dataRoot(local)).startsWith('..'), true);
});

test('preview data moves out of the install folder by rename, keeping session files', async (t) => {
  const local = await temporary(t);
  const legacy = legacyDataRoot(local);
  const next = dataRoot(local);
  const session = path.join(legacy, 'profiles', '0f8fad5b-d9cb-469f-a165-70867728950e', 'desktop');
  await fs.mkdir(session, { recursive: true });
  await fs.writeFile(path.join(session, 'marker'), 'signed-in');
  await fs.writeFile(path.join(legacy, 'profiles.json'), '{"schemaVersion":1,"profiles":[]}');
  await fs.writeFile(path.join(legacy, 'settings.json'), '{}');
  await fs.mkdir(path.join(legacy, 'app-0.0.1'));
  await fs.writeFile(path.join(legacy, 'Update.exe'), '');

  assert.equal(await migrateLegacyData(legacy, next), true);
  assert.equal(
    await fs.readFile(
      path.join(next, 'profiles', '0f8fad5b-d9cb-469f-a165-70867728950e', 'desktop', 'marker'),
      'utf8',
    ),
    'signed-in',
  );
  await fs.access(path.join(next, 'settings.json'));
  await fs.access(path.join(legacy, 'Update.exe'));
  await fs.access(path.join(legacy, 'app-0.0.1'));
  await assert.rejects(fs.access(path.join(legacy, 'profiles.json')));
  assert.equal(await migrateLegacyData(legacy, next), false, 'second run is a no-op');
});

test('migration never overwrites existing data in the new folder', async (t) => {
  const local = await temporary(t);
  const legacy = legacyDataRoot(local);
  const next = dataRoot(local);
  await fs.mkdir(legacy, { recursive: true });
  await fs.mkdir(next, { recursive: true });
  await fs.writeFile(path.join(legacy, 'profiles.json'), 'old');
  await fs.writeFile(path.join(next, 'profiles.json'), 'new');
  assert.equal(await migrateLegacyData(legacy, next), false);
  assert.equal(await fs.readFile(path.join(next, 'profiles.json'), 'utf8'), 'new');
});

test('Windows argument quoting round-trips through the command-line parser', () => {
  for (const value of ['plain', 'with space', 'quote"inside', 'C:\\Path With\\Trailing\\', '', 'a\\\\"b'])
    assert.deepEqual(splitWindowsCommandLine(`app ${quoteWindowsArgument(value)}`), ['app', value]);
  assert.deepEqual(
    splitWindowsCommandLine(`app ${joinWindowsCommandLine(['--profile=North Studio', 'x'])}`),
    ['app', '--profile=North Studio', 'x'],
  );
});

test('installed launches go through Squirrel Update.exe so they survive updates', () => {
  const exe = 'C:\\Users\\A\\AppData\\Local\\ClientDeck\\app-0.1.0\\ClientDeck.exe';
  const present = new Set([
    'C:\\Users\\A\\AppData\\Local\\ClientDeck\\Update.exe',
    'C:\\Users\\A\\AppData\\Local\\ClientDeck\\app.ico',
  ]);
  const launcher = stableLauncher(exe, (file) => present.has(file));
  assert.equal(launcher.target, 'C:\\Users\\A\\AppData\\Local\\ClientDeck\\Update.exe');
  assert.equal(launcher.icon, 'C:\\Users\\A\\AppData\\Local\\ClientDeck\\app.ico');
  assert.doesNotMatch(launcher.target, /app-0\.1\.0/);
  const args = launcher.args(['--profile=0f8fad5b-d9cb-469f-a165-70867728950e']);
  assert.deepEqual(args, [
    '--processStart',
    'ClientDeck.exe',
    '--process-start-args',
    '--profile=0f8fad5b-d9cb-469f-a165-70867728950e',
  ]);
  const portable = stableLauncher('D:\\Tools\\ClientDeck\\ClientDeck.exe', () => false);
  assert.deepEqual(portable.args(['--background']), ['--background']);
});

test('links above the trusted data folder are allowed; links below it are not', async (t) => {
  const outer = await temporary(t);
  const real = path.join(outer, 'real');
  await fs.mkdir(real);
  const redirected = path.join(outer, 'redirected');
  await fs.symlink(real, redirected, 'junction');
  await ensurePlainDirectory(path.join(redirected, 'profiles', 'x', 'desktop'), redirected);
  await fs.access(path.join(real, 'profiles', 'x', 'desktop'));
  await assert.rejects(ensurePlainDirectory(path.join(outer, 'elsewhere'), redirected), /outside/);
});
