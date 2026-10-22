// Exercise the real native process adapter with disposable synthetic executables.
// Does not start Claude or inspect its account data.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeOwnedProcess, listClaudeProcesses, launchClaude } from '../src/core/macos.ts';

if (process.platform !== 'darwin') throw new Error('Run this native check on macOS.');
const execute = promisify(execFile);
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-native-')));
const executable = path.join(root, 'Fixture.app', 'Contents', 'MacOS', 'Claude');
const installation = { executable, kind: 'macOS', version: 'synthetic' };
const children = [];
// Up to 10 s: freshly launched fixture apps can take several seconds on CI's Intel runners.
async function waitFor(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for fixture process');
}
try {
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(
    path.join(root, 'fixture.c'),
    '#include <unistd.h>\nint main(void) { for (;;) pause(); }\n',
  );
  await execute('xcrun', ['clang', path.join(root, 'fixture.c'), '-o', executable]);
  const first = path.join(root, 'Client A with spaces');
  const second = path.join(root, 'Client B with spaces');
  const a = await launchClaude(installation, first, path.join(root, 'code-a'));
  children.push(a);
  const b = await launchClaude(installation, second, path.join(root, 'code-b'));
  children.push(b);
  let observations;
  await waitFor(async () => {
    observations = (await listClaudeProcesses()).filter((p) => children.includes(p.pid));
    return observations.length === 2;
  });
  const observed = observations.find((p) => p.pid === a);
  assert.ok(observed.arguments.includes(`--user-data-dir=${first}`));
  // Claude must be its own responsible process, or macOS checks Hatstand's privacy grants instead.
  const responsible = path.join(root, 'responsible');
  await fs.writeFile(
    `${responsible}.c`,
    '#include <stdio.h>\n#include <stdlib.h>\n#include <unistd.h>\nextern pid_t responsibility_get_pid_responsible_for_pid(pid_t);\nint main(int c, char **v) { printf("%d", responsibility_get_pid_responsible_for_pid(atoi(v[1]))); }\n',
  );
  await execute('xcrun', ['clang', `${responsible}.c`, '-o', responsible]);
  for (const pid of [a, b])
    assert.equal(
      Number((await execute(responsible, [String(pid)])).stdout),
      pid,
      'Claude must be self-responsible',
    );
  for (const [install, desktop, expected] of [
    [installation, first, { ...observed, createdAt: '0:0' }],
    [installation, first + '-lookalike', observed],
    [{ ...installation, executable: executable + '-other' }, first, observed],
  ]) {
    await assert.rejects(closeOwnedProcess(install, desktop, expected, true), /process changed/);
    assert.doesNotThrow(() => process.kill(a, 0));
  }
  await closeOwnedProcess(installation, first, observed, false);
  await waitFor(async () => !(await listClaudeProcesses()).some((p) => p.pid === a));
  assert.doesNotThrow(() => process.kill(b, 0), 'closing A must leave B alive');
  const remaining = (await listClaudeProcesses()).find((p) => p.pid === b);
  await closeOwnedProcess(installation, second, remaining, true);
  await waitFor(async () => !(await listClaudeProcesses()).some((p) => p.pid === b));
  console.log(
    'Native checks passed: exact argv with spaces, simultaneous profiles, stale PID identity rejection, wrong-path rejection, graceful close, force close, and sibling isolation.',
  );
  // Closed/hidden windows need a reopen event, not process activation alone.
  // Reuse the fixture path after both original synthetic processes have exited.
  await execute('xcrun', ['swiftc', 'test/fixtures/macos-focus.swift', '-o', executable]);
  await fs.writeFile(
    path.join(root, 'Fixture.app', 'Contents', 'Info.plist'),
    '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>io.hatstand.focus-fixture</string><key>CFBundleExecutable</key><string>Claude</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
  );
  await fs.mkdir(first, { recursive: true });
  await fs.mkdir(second, { recursive: true });
  const focusA = await launchClaude(installation, first, path.join(root, 'code-a'));
  children.push(focusA);
  const focusB = await launchClaude(installation, second, path.join(root, 'code-b'));
  children.push(focusB);
  const state = async (folder) => {
    try {
      return JSON.parse(await fs.readFile(path.join(folder, 'status.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  await waitFor(async () => (await state(first)) && (await state(second)));
  const otherBefore = await state(second);
  let reopens = 0;
  for (const mode of ['closed', 'hidden', 'closed']) {
    console.log('Checking focus from', mode);
    await fs.writeFile(path.join(first, 'command'), mode);
    await waitFor(async () => {
      const s = await state(first);
      return s.command === mode && (mode === 'closed' ? !s.visible : s.hidden);
    }).catch(async (error) => {
      console.log('Fixture state:', await state(first));
      throw error;
    });
    const pid = await launchClaude(installation, first, path.join(root, 'code-a'));
    assert.equal(pid, focusA, 'Focus must reuse the existing PID');
    reopens++;
    await waitFor(async () => {
      const s = await state(first);
      return s.visible && !s.minimized && !s.hidden && s.active && s.reopens === reopens;
    });
    assert.deepEqual(await state(second), otherBefore, 'Focus must not reopen another profile');
    assert.equal((await listClaudeProcesses()).filter((p) => p.executable === executable).length, 2);
  }
  console.log(
    'Focus regression passed: closed and hidden windows reopen in front, with the same PID and no effect on the other profile.',
  );
} finally {
  for (const pid of children) {
    // Revalidate executable identity before cleanup in case the fixture already exited.
    const current = (await listClaudeProcesses()).find((p) => p.pid === pid && p.executable === executable);
    if (current) process.kill(pid, 'SIGKILL');
  }
  await fs.rm(root, { recursive: true, force: true });
}
