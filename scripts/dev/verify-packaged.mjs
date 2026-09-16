// Local smoke test of the packaged app against your real ClientDeck data.
// It only reads status and focuses profiles that are already running. It never signs
// in, creates or removes profiles, sends prompts, or closes Claude.
// Usage: npm run package && node scripts/dev/verify-packaged.mjs
import { _electron as electron } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
import { listClaudeProcesses } from '../../src/core/windows.ts';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const before = await listClaudeProcesses();
const instance = await electron.launch({
  executablePath: path.resolve('out/ClientDeck-win32-x64/ClientDeck.exe'),
  env,
  timeout: 30_000,
});
try {
  const page = await instance.firstWindow();
  await page.waitForFunction(() => document.querySelector('h1'));
  let snapshot = await page.evaluate(() => window.clientdeck.request('refresh'));
  assert.equal(snapshot.packaged, true);
  assert.equal(snapshot.processError, '', 'process status should be readable');
  const running = snapshot.profiles.filter((p) => p.status === 'running');
  console.log(
    `Packaged app started: ${snapshot.profiles.length} profiles, ${running.length} running, Claude ${snapshot.installation?.version ?? 'not found'}.`,
  );
  for (const profile of running)
    await page.evaluate((id) => window.clientdeck.request('launch', { id }), profile.id);
  snapshot = await page.evaluate(() => window.clientdeck.request('refresh'));
  assert.equal(snapshot.profiles.filter((p) => p.status === 'running').length, running.length);
  const after = await listClaudeProcesses();
  for (const process of before)
    assert.ok(
      after.some((p) => p.pid === process.pid && p.createdAt === process.createdAt),
      'Focus should reuse the same process',
    );
  if (running.length) console.log('Focus reused the existing Claude processes.');
} finally {
  await instance.close();
}
const remaining = await listClaudeProcesses();
for (const process of before)
  assert.ok(
    remaining.some((p) => p.pid === process.pid && p.createdAt === process.createdAt),
    'Exiting ClientDeck should preserve Claude processes',
  );
console.log('Exiting ClientDeck left every Claude process running.');
