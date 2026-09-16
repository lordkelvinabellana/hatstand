import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clientdeck-ui-'));
const screenshotFolder = path.resolve('.impeccable/review');
await fs.mkdir(screenshotFolder, { recursive: true });
const env = { ...process.env, CLIENTDECK_TEST_MODE: '1', CLIENTDECK_TEST_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
const instance = await electron.launch({ args: ['.'], env, timeout: 30_000 });
const errors = [];
try {
  const page = await instance.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'Your clients, in place.' }).waitFor();
  await page.getByRole('button', { name: 'Add profile', exact: true }).click();
  await page.getByLabel('Client name', { exact: true }).fill('North Studio');
  await page.getByLabel('Account label').fill('Sample client profile');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.getByText('Profile created. Launch it to sign in.').waitFor();
  await page.getByRole('button', { name: 'Add profile', exact: true }).click();
  await page.getByLabel('Client name', { exact: true }).fill('Acorn & Co.');
  await page.getByLabel('Account label').fill('Sample client profile');
  await page.getByRole('button', { name: 'amber', exact: true }).click();
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.locator('.profile-row').nth(1).waitFor();
  await page.getByLabel('Search profiles').fill('north');
  assert.equal(await page.locator('.profile-row').count(), 1);
  await page.getByLabel('Search profiles').fill('');
  await page.getByRole('button', { name: 'Actions for Acorn & Co.', exact: true }).click();
  await page.getByRole('button', { name: 'Archive profile', exact: true }).click();
  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('heading', { name: 'Nothing archived' }).waitFor();
  await page.getByRole('button', { name: /Client profiles/ }).click();
  await page.locator('.profile-row').nth(1).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Control+k');
  assert.equal(
    await page.getByLabel('Search profiles').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByRole('button', { name: 'Compatibility', exact: true }).click();
  await page.keyboard.press('Control+k');
  assert.equal(
    await page.getByLabel('Search profiles').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByLabel('Global shortcut').fill('');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  const exportPath = path.join(root, 'export.json');
  await instance.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.getByRole('button', { name: 'Export metadata', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button:disabled'));
  const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
  assert.equal(exported.profiles.length, 2);
  assert.ok(!JSON.stringify(exported).includes(root));
  const originalIds = JSON.parse(await fs.readFile(path.join(root, 'profiles.json'), 'utf8')).profiles.map(
    (p) => p.id,
  );
  await instance.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, exportPath);
  await page.getByRole('button', { name: 'Import metadata', exact: true }).click();
  await page.getByRole('heading', { name: 'Import 2 profiles?' }).waitFor();
  await page.getByRole('button', { name: 'Create profiles', exact: true }).click();
  await page.getByText('Profiles imported.', { exact: true }).waitFor();
  const imported = JSON.parse(await fs.readFile(path.join(root, 'profiles.json'), 'utf8')).profiles;
  assert.equal(imported.length, 4);
  assert.equal(new Set(imported.map((p) => p.id)).size, 4);
  assert.deepEqual(
    imported.slice(0, 2).map((p) => p.id),
    originalIds,
  );
  // Remove only the two synthetic imported copies through the app's tested path.
  await instance.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.evaluate(
    async (ids) => {
      for (const id of ids) await window.clientdeck.request('remove', { id });
    },
    imported.slice(2).map((p) => p.id),
  );
  await page.getByRole('button', { name: /Client profiles/ }).click();
  if (await page.getByRole('button', { name: 'Dismiss notification' }).count())
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
  await page.screenshot({ path: path.join(screenshotFolder, 'desktop.png') });
  await page.locator('.profile-identity').first().click();
  await page.getByLabel('Client name', { exact: true }).fill('North Studio');
  await page.screenshot({ path: path.join(screenshotFolder, 'editor.png') });
  await page.getByRole('button', { name: 'Close profile editor' }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 640));
  await page.screenshot({ path: path.join(screenshotFolder, 'compact.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Client profiles/ }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
  await page.screenshot({ path: path.join(screenshotFolder, 'dark.png') });
  const prefs = await instance.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
  });
  assert.deepEqual(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.deepEqual(errors, []);
  console.log(
    'UI checks passed: create, search, archive/restore, settings, metadata export/import, fresh IDs, removal, compact layout, dark theme, sandbox.',
  );
  console.log(`Screenshots: ${screenshotFolder}`);
} finally {
  await instance.close();
  // Test root was created by mkdtemp and contains synthetic data only.
  if (root.startsWith(path.join(os.tmpdir(), 'clientdeck-ui-')))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
