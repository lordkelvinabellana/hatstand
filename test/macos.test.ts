import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ownsProcess, processUsesDirectory, sameMacPath } from '../src/core/launch.ts';
import { acceleratorKey, normalizeAccelerator } from '../src/core/accelerator.ts';
import { bundleFromOverride } from '../src/core/macos.ts';
import { checksFor, isTestedVersion } from '../src/core/compat.ts';
import { dataRoot } from '../src/core/paths.ts';

const executable = '/Applications/Claude.app/Contents/MacOS/Claude';
const desktop = '/Users/test/Library/Application Support/Client A/desktop';
const observation = {
  pid: 123,
  executable,
  platform: 'darwin' as const,
  createdAt: '123:456',
  commandLine: '',
  arguments: [executable, `--user-data-dir=${desktop}`, '--hatstand-activation=abc'],
};
test('Mac ownership uses exact argv, preserves spaces, and rejects ambiguous or helper processes', () => {
  assert.ok(ownsProcess(observation, executable, desktop));
  for (const args of [
    [executable, `--user-data-dir=${desktop}-other`],
    [...observation.arguments, '--type=renderer'],
    [...observation.arguments, `--user-data-dir=${desktop}`],
    [executable, `--title=--user-data-dir=${desktop}`],
  ])
    assert.equal(ownsProcess({ ...observation, arguments: args }, executable, desktop), false);
  assert.equal(ownsProcess({ ...observation, arguments: undefined }, executable, desktop), false);
  assert.equal(ownsProcess({ ...observation, createdAt: '' }, executable, desktop), false);
  assert.equal(ownsProcess(observation, '/Other/Claude.app/Contents/MacOS/Claude', desktop), false);
  assert.ok(processUsesDirectory(observation, desktop));
  assert.equal(processUsesDirectory(observation, desktop + '-other'), false);
});
test('Mac paths resolve filesystem aliases without indiscriminate case folding', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-mac-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'actual'));
  await fs.symlink(path.join(root, 'actual'), path.join(root, 'alias'), 'junction');
  assert.ok(sameMacPath(path.join(root, 'actual'), path.join(root, 'alias')));
  assert.equal(sameMacPath('/missing/CaseSensitive', '/missing/casesensitive'), false);
});
test('Mac bundle overrides accept app bundles and their executable, rejecting relative paths', () => {
  assert.equal(bundleFromOverride(executable), '/Applications/Claude.app');
  assert.equal(bundleFromOverride('/Applications/Claude.app'), '/Applications/Claude.app');
  for (const bad of ['Claude.app', '/tmp/Claude', '/tmp/Claude.app/other'])
    assert.throws(() => bundleFromOverride(bad));
});
test('Cmd aliases collide on Mac while Control stays distinct; Windows aliases remain intact', () => {
  assert.equal(normalizeAccelerator('cmd+shift+k'), 'Command+Shift+K');
  const key = acceleratorKey('CommandOrControl+Shift+K', 'darwin');
  assert.equal(key, acceleratorKey('Super+Shift+K', 'darwin'));
  assert.equal(key, acceleratorKey('Command+Shift+K', 'darwin'));
  assert.notEqual(key, acceleratorKey('Control+Shift+K', 'darwin'));
  assert.equal(acceleratorKey('CommandOrControl+K', 'win32'), acceleratorKey('Control+K', 'win32'));
});
test('compatibility evidence is platform-specific and data lives outside the Mac app bundle', () => {
  assert.ok(isTestedVersion('2.2553.1', 'darwin'));
  assert.equal(isTestedVersion('2.2553.1', 'win32'), false);
  assert.equal(isTestedVersion('2.110.0.0', 'darwin'), false);
  assert.equal(checksFor('darwin').find((c) => c.key === 'logoutIsolation')?.result, 'user-confirmed');
  assert.equal(checksFor('win32').find((c) => c.key === 'logoutIsolation')?.result, 'unverified');
  assert.equal(
    dataRoot(path.join('/Users/test', 'Library', 'Application Support')),
    path.join('/Users/test', 'Library', 'Application Support', 'HatstandData'),
  );
});
