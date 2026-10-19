// End-to-end UI checks against an isolated temporary data folder with synthetic clients.
// Never launches Claude. Pass --docs to also refresh the README screenshots in docs/images.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const mac = process.platform === 'darwin';
const primaryKey = mac ? 'Meta' : 'Control';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-ui-'));
const screenshotFolder = path.resolve(
  process.argv.includes('--docs') ? 'docs/images' : '.local/ui-screenshots',
);
await fs.mkdir(screenshotFolder, { recursive: true });
const env = { ...process.env, HATSTAND_TEST_MODE: '1', HATSTAND_TEST_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
const instance = await electron.launch({ args: ['.'], env, timeout: 30_000 });
const errors = [];
// Screenshots must not reveal the machine's user name through temporary paths.
async function scrubPaths(page) {
  await page.evaluate((temporary) => {
    const neutral = (value) =>
      value.replaceAll(temporary, String.raw`C:\Users\you\AppData\Local\HatstandData`);
    for (const input of document.querySelectorAll('input')) input.value = neutral(input.value);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) walker.currentNode.nodeValue = neutral(walker.currentNode.nodeValue);
  }, root);
}
const readProfiles = async () =>
  JSON.parse(await fs.readFile(path.join(root, 'profiles.json'), 'utf8')).profiles;
try {
  const page = await instance.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  page.on('pageerror', (error) => errors.push(error.message));
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));

  // First run shows setup; skipping leads to the empty profile list.
  await page.getByRole('heading', { name: 'Let’s find Claude Desktop.' }).waitFor();
  await page.screenshot({ path: path.join(screenshotFolder, 'setup.png') });
  await page.getByRole('button', { name: 'Skip setup', exact: true }).click();
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
  assert.equal((await readProfiles())[1].icon, 'A&', 'initials follow the name');

  await page.getByLabel('Search profiles').fill('north');
  assert.equal(await page.locator('.profile-row').count(), 1);
  await page.getByLabel('Search profiles').fill('');

  // Selecting profiles offers a group launch (not clicked: that would start Claude).
  await page.getByLabel('Select North Studio').check();
  await page.getByLabel('Select Acorn & Co.').check();
  await page.getByRole('button', { name: 'Open 2 selected' }).waitFor();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  // Profile details: shortcut recording, work folder and startup preference.
  const workFolder = path.join(root, 'North Studio files');
  await fs.mkdir(workFolder);
  await instance.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, workFolder);
  await page.locator('.profile-identity').first().click();
  await page.getByLabel('Profile shortcut').focus();
  await page.keyboard.press('Control+Alt+Shift+F11');
  assert.equal(await page.getByLabel('Profile shortcut').inputValue(), 'Ctrl+Alt+Shift+F11');
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="Work folder"]')?.value);
  await page.getByLabel(mac ? 'Open at login' : 'Open when Windows starts').check();
  await scrubPaths(page);
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
  await page.screenshot({ path: path.join(screenshotFolder, 'editor.png') });
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('Profile saved.', { exact: true }).waitFor();
  const north = (await readProfiles())[0];
  assert.deepEqual(
    { hotkey: north.hotkey, workFolder: north.workFolder, openAtStartup: north.openAtStartup },
    { hotkey: `${mac ? 'Control' : 'CommandOrControl'}+Alt+Shift+F11`, workFolder, openAtStartup: true },
  );
  await page.getByRole('button', { name: 'Open startup group (1)' }).waitFor();

  // A duplicate shortcut on another profile is refused.
  await page.locator('.profile-identity').nth(1).click();
  await page.getByLabel('Profile shortcut').focus();
  await page.keyboard.press('Control+Alt+Shift+F11');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'already used' }).waitFor();
  await page.getByRole('button', { name: 'Close profile editor' }).click();

  // Actions menu is keyboard operable.
  await page.getByRole('button', { name: 'Actions for Acorn & Co.', exact: true }).click();
  assert.equal(
    await page
      .getByRole('menuitem', { name: 'Edit profile' })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(), 0);

  // Moving up past an archived profile still changes the visible order.
  await page.getByRole('button', { name: 'Add profile', exact: true }).click();
  await page.getByLabel('Client name', { exact: true }).fill('Middle archived');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();
  await page.locator('.profile-row').nth(2).waitFor();
  await page.getByRole('button', { name: 'Actions for Middle archived', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive profile' }).click();
  await page.locator('.profile-row').nth(1).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.profile-row').length === 2);
  // Stored order: North, Acorn, Middle(archived). Put the archived one between them first.
  const ids = (await readProfiles()).map((p) => p.id);
  await page.evaluate(
    (order) => window.hatstand.request('reorder', { ids: order }),
    [ids[0], ids[2], ids[1]],
  );
  await page.getByRole('button', { name: 'Actions for Acorn & Co.', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await page.waitForFunction(
    () => document.querySelector('.profile-row strong')?.textContent === 'Acorn & Co.',
  );

  await page.getByRole('button', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('heading', { name: 'Nothing archived' }).waitFor();
  await page.getByRole('button', { name: /Client profiles/ }).click();
  await page.locator('.profile-row').nth(2).waitFor();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press(`${primaryKey}+k`);
  assert.equal(
    await page.getByLabel('Search profiles').evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByRole('button', { name: 'Compatibility', exact: true }).click();
  await page.getByText('Stays signed in after quit and reopen').waitFor();
  await page.keyboard.press(`${primaryKey}+k`);
  assert.equal(
    await page.getByLabel('Search profiles').evaluate((el) => el === document.activeElement),
    true,
  );

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  // The theme applies when it is picked, without pressing Save.
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.getByLabel('Global shortcut').focus();
  await page.keyboard.press('Backspace');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  // Sync refuses a secret key before anything is sent, and stays off by default.
  await page.getByLabel('Supabase project URL').fill('https://example.supabase.co');
  await page.getByLabel('Publishable key').fill('sb_secret_not_allowed');
  await page.getByLabel('Email', { exact: true }).fill('test@example.com');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await page
    .getByText(/secret Supabase key/)
    .first()
    .waitFor();
  await page.getByRole('heading', { name: 'Sync profiles' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotFolder, 'sync.png') });
  if (mac) {
    // Pets switch off (the Hatstand icon returns) and back on without a restart.
    for (const checked of [false, true]) {
      await page.getByLabel(/Show a pet for each profile/).setChecked(checked);
      await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
      await page.getByText('Settings saved.', { exact: true }).last().waitFor();
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await scrubPaths(page);
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
  await page.screenshot({ path: path.join(screenshotFolder, 'settings.png') });
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8')).hotkey, '');

  const exportPath = path.join(root, 'export.json');
  await instance.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.getByRole('button', { name: 'Export metadata', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('button:disabled'));
  const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
  assert.equal(exported.profiles.length, 3);
  assert.ok(!JSON.stringify(exported).includes(root));
  assert.ok(!JSON.stringify(exported).includes('F11'), 'shortcuts are not exported');
  const originalIds = (await readProfiles()).map((p) => p.id);
  await instance.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, exportPath);
  await page.getByRole('button', { name: 'Import metadata', exact: true }).click();
  await page.getByRole('heading', { name: 'Import 3 profiles?' }).waitFor();
  await page.getByRole('button', { name: 'Create profiles', exact: true }).click();
  await page.getByText('Profiles imported.', { exact: true }).waitFor();
  const imported = await readProfiles();
  assert.equal(imported.length, 6);
  assert.equal(new Set(imported.map((p) => p.id)).size, 6);
  assert.deepEqual(
    imported.slice(0, 3).map((p) => p.id),
    originalIds,
  );

  // Remove the imported copies; give one a data folder and keep it, so it shows up as leftover data.
  const leftover = imported[3].id;
  await fs.mkdir(path.join(root, 'profiles', leftover, 'desktop'), { recursive: true });
  await fs.writeFile(path.join(root, 'profiles', leftover, 'desktop', 'sample'), 'synthetic');
  await instance.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  });
  await page.evaluate(
    async (ids) => {
      for (const id of ids) await window.hatstand.request('remove', { id });
    },
    imported.slice(3).map((p) => p.id),
  );
  await page.getByRole('button', { name: 'Find leftover data', exact: true }).click();
  await page.getByText('1 belongs to removed profiles').waitFor();
  await page.getByRole('button', { name: mac ? 'Move to Trash…' : 'Move to Recycle Bin…' }).waitFor();
  await fs.access(path.join(root, 'profiles', leftover, 'desktop', 'sample'));

  await page.getByRole('button', { name: /Client profiles/ }).click();
  if (await page.getByRole('button', { name: 'Dismiss notification' }).count())
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
  await page.screenshot({ path: path.join(screenshotFolder, 'profiles.png') });
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 640));
  await page.screenshot({ path: path.join(screenshotFolder, 'compact.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Client profiles/ }).click();
  await page.getByRole('button', { name: 'Dismiss notification' }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
  await page.screenshot({ path: path.join(screenshotFolder, 'dark.png') });
  const prefs = await instance.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
  });
  assert.deepEqual(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  if (mac) {
    const native = await instance.evaluate(({ app, Menu }) => ({
      dock: app.dock.getMenu()?.items.map((item) => item.label),
      menu: Menu.getApplicationMenu()?.items.map((item) => item.role),
    }));
    assert.ok(native.dock.includes('Open Hatstand'));
    assert.ok(native.dock.some((label) => label.includes('North Studio')));
    assert.ok(native.menu.includes('appmenu'));
    await page.locator('.profile-identity').first().click();
    await page.getByLabel('Profile shortcut').focus();
    await page.keyboard.press('Meta+Alt+F10');
    assert.equal(await page.getByLabel('Profile shortcut').inputValue(), 'Cmd+Alt+F10');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Profile saved.', { exact: true }).waitFor();
    assert.ok((await readProfiles()).some((p) => p.hotkey === 'Command+Alt+F10'));
    await instance.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].hide();
      app.emit('activate');
    });
    assert.equal(
      await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      true,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'UI checks passed: setup, create, search, selection, shortcuts, work folder, menu keyboard, reorder past archived, archive/restore, settings, export/import, leftover data, compact layout, dark theme, sandbox.',
  );
  console.log(`Screenshots: ${screenshotFolder}`);
} finally {
  await instance.close();
  // Test root was created by mkdtemp and contains synthetic data only.
  if (root.startsWith(path.join(os.tmpdir(), 'hatstand-ui-')))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
