import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Controller } from '../src/core/controller.ts';
import type { ControllerDeps } from '../src/core/controller.ts';
import type { ProcessObservation } from '../src/core/launch.ts';
import { ProfileStore } from '../src/core/store.ts';
import type { Installation } from '../src/core/windows.ts';

const installation: Installation = {
  executable: 'C:\\Claude\\Claude.exe',
  version: '2.110.0.0',
  kind: 'MSIX',
};
const timings = {
  launchSettle: 10,
  startTimeout: 1000,
  closeWait: 2000,
  closePoll: 100,
  detectionReuse: 5000,
};

/** A fake Windows: processes appear when launched and exit after `exitAfter` ms when closed. */
async function harness(
  t: { after: (fn: () => Promise<void>) => void },
  options: { exitAfter?: number } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-controller-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let clock = 0;
  let pid = 100;
  let processes: ProcessObservation[] = [];
  const exits: { pid: number; at: number }[] = [];
  const calls = { launches: 0, closes: 0, detections: 0, scans: 0 };
  const store = new ProfileStore(root);
  const deps: ControllerDeps = {
    root,
    store,
    async listProcesses() {
      calls.scans++;
      processes = processes.filter((p) => !exits.some((e) => e.pid === p.pid && e.at <= clock));
      return processes;
    },
    async detectInstallation() {
      calls.detections++;
      return installation;
    },
    async launchProcess(_installation, desktop) {
      calls.launches++;
      if (!processes.some((p) => p.commandLine.includes(desktop)))
        processes.push({
          pid: ++pid,
          executable: installation.executable,
          commandLine: `"${installation.executable}" "--user-data-dir=${desktop}"`,
          createdAt: `t${pid}`,
        });
      return pid;
    },
    async closeProcess(_installation, _desktop, process) {
      calls.closes++;
      if (options.exitAfter !== undefined) exits.push({ pid: process.pid, at: clock + options.exitAfter });
    },
    async ensureDirectory() {},
    async log() {},
    async sleep(ms) {
      clock += ms;
    },
    now: () => clock,
    changed() {},
  };
  const controller = new Controller(deps, timings);
  return { controller, store, calls, running: () => processes.length };
}

test('launching an already running profile focuses it without a new process or transition', async (t) => {
  const { controller, store, calls, running } = await harness(t);
  const profile = await store.create({ name: 'A' });
  await controller.launch(profile.id);
  assert.equal(controller.status(profile.id).status, 'running');
  await controller.launch(profile.id);
  assert.equal(calls.launches, 2);
  assert.equal(running(), 1);
  assert.equal(controller.status(profile.id).status, 'running');
});

test('close waits for the process to exit instead of reporting it still running', async (t) => {
  const { controller, store } = await harness(t, { exitAfter: 700 });
  const profile = await store.create({ name: 'A' });
  await controller.launch(profile.id);
  await controller.close(profile.id);
  assert.equal(controller.status(profile.id).status, 'stopped');
});

test('close reports when Claude stays open (for example in its tray)', async (t) => {
  const { controller, store } = await harness(t);
  const profile = await store.create({ name: 'A' });
  await controller.launch(profile.id);
  await assert.rejects(controller.close(profile.id), /still running/);
  assert.equal(controller.status(profile.id).status, 'running');
});

test('restart closes then launches a new process', async (t) => {
  const { controller, store, calls } = await harness(t, { exitAfter: 200 });
  const profile = await store.create({ name: 'A' });
  await controller.launch(profile.id);
  await controller.restart(profile.id);
  assert.equal(calls.closes, 1);
  assert.equal(calls.launches, 2);
  assert.equal(controller.status(profile.id).status, 'running');
});

test('launching several profiles detects the installation once and continues past failures', async (t) => {
  const { controller, store, calls } = await harness(t);
  const a = await store.create({ name: 'A' });
  const b = await store.create({ name: 'B' });
  const archived = await store.create({ name: 'C' });
  await store.archive(archived.id, true);
  const failures = await controller.launchMany([a.id, archived.id, b.id]);
  assert.deepEqual(
    failures.map((f) => f.id),
    [archived.id],
  );
  assert.equal(calls.detections, 1);
  assert.equal(controller.status(a.id).status, 'running');
  assert.equal(controller.status(b.id).status, 'running');
});

test('a profile that never starts is marked as needing attention', async (t) => {
  const { controller, store } = await harness(t);
  const profile = await store.create({ name: 'A' });
  // Simulate Claude exiting immediately: the fake launch succeeds but no process appears.
  (controller as unknown as { deps: ControllerDeps }).deps.launchProcess = async () => 0;
  await controller.launch(profile.id);
  assert.equal(controller.status(profile.id).status, 'starting');
  await (controller as unknown as { deps: ControllerDeps }).deps.sleep(2000);
  await controller.refresh();
  assert.equal(controller.status(profile.id).status, 'error');
});

test('refresh requested during a scan triggers a later scan rather than reusing stale results', async (t) => {
  const { controller, calls } = await harness(t);
  const first = controller.refresh();
  const second = controller.refresh();
  const third = controller.refresh();
  await Promise.all([first, second, third]);
  assert.equal(calls.scans, 2);
});

test('close all reports profiles that stayed open and closes the rest', async (t) => {
  const { controller, store } = await harness(t, { exitAfter: 100 });
  const a = await store.create({ name: 'A' });
  const b = await store.create({ name: 'B' });
  await controller.launchMany([a.id, b.id]);
  assert.deepEqual(await controller.closeAll(), []);
  assert.equal(controller.runningCount((await store.load()).profiles), 0);
});

test('unknown process status prevents treating a profile folder as unused', async (t) => {
  const { controller } = await harness(t);
  controller.processError = 'Process scan failed';
  assert.throws(() => controller.usesDirectory('/profile/desktop'), /Could not verify/);
});
