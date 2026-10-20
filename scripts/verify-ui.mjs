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
const until = async (check, message) => {
  for (let i = 0; i < 50; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(message);
};

/** Profile rows open the profile page; its Edit button opens the editor dialog. */
async function editProfile(page, n) {
  await page.getByRole('button', { name: 'Client profiles', exact: true }).click();
  await page.locator('.profile-identity').nth(n).click();
  await page.locator('.profile-hero').waitFor();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
}

/** Notes on the Second brain page: tree, live preview, autosave, wikilinks, backlinks, search, live disk changes, conflicts. */
async function checkNotes(vault) {
  const main = await instance.firstWindow();
  const write = (rel, text) =>
    fs
      .mkdir(path.dirname(path.join(vault, rel)), { recursive: true })
      .then(() => fs.writeFile(path.join(vault, rel), text));
  const read = (rel) => fs.readFile(path.join(vault, rel), 'utf8');
  await write(
    'Clients/Aether.md',
    '---\ntype: client\naliases: [Aether Labs]\n---\n# Aether\n\nA **design** studio. Works with [[Kam]].\n\n- [ ] Send the proposal\n',
  );
  await write('People/Kam.md', '# Kam\n\nRuns ops.\n');
  await write(
    'Sessions/2026-10-20 Fix invoices.md',
    '# Fix invoices\n\n## Summary\n- Fixed it\n\n<!-- auto:start -->\n## Prompts\n- fix the invoices\n<!-- auto:end -->\n',
  );
  // The notes open inside Hatstand's own window, on the Second brain page.
  await main.getByRole('dialog').getByRole('button', { name: 'Open notes' }).click();
  const notes = main;
  await notes.locator('.n-app').waitFor();
  await notes.locator('section.n-graph').waitFor(); // a vault opens on its graph
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 720));
  const profile = (await readProfiles()).find((p) => p.name === 'North Studio').id;
  const tree = notes.getByRole('navigation', { name: 'Notes and folders' });
  await tree.getByRole('button', { name: 'Clients' }).click();
  await tree.getByRole('button', { name: 'Aether' }).click();
  const editor = notes.locator('.cm-content');
  // Live preview: heading styled and its # hidden, wikilink shown by name, checkbox rendered.
  await notes.locator('.cm-h1', { hasText: 'Aether' }).waitFor();
  await notes.locator('.cm-wikilink', { hasText: 'Kam' }).waitFor();
  assert.equal(await notes.locator('input.cm-task').count(), 1);
  assert.ok(!(await editor.innerText()).includes('[[Kam]]'));

  // Typing autosaves to the plain .md file; [[ completes note names.
  await notes.locator('.cm-line', { hasText: 'Send the proposal' }).getByText('Send the proposal').click();
  await notes.keyboard.press('End');
  await notes.keyboard.type(' to [[Ka');
  await notes.locator('.cm-tooltip-autocomplete').getByText('Kam', { exact: true }).click();
  await until(
    async () => (await read('Clients/Aether.md')).includes('Send the proposal to [[Kam]]'),
    'autosave',
  );
  // Ticking the checkbox edits the markdown.
  // At the line's start: its middle may be the [[Kam]] link, which would open that note instead.
  await notes.locator('.cm-line', { hasText: 'A design studio' }).click({ position: { x: 4, y: 8 } });
  await notes.locator('input.cm-task').click();
  await until(async () => (await read('Clients/Aether.md')).includes('- [x] Send'), 'checkbox saved');

  // Clicking a rendered wikilink (not on the line being edited) opens the note; its backlinks list Aether.
  await notes.locator('.cm-wikilink', { hasText: 'Kam' }).last().click();
  await notes.getByRole('tab', { name: 'Kam' }).waitFor();
  await notes
    .getByRole('complementary', { name: 'Backlinks' })
    .getByText('Aether', { exact: true })
    .waitFor();
  // A link to a missing note creates it in the vault root.
  await notes.locator('.cm-content').click();
  await notes.keyboard.press(`${primaryKey}+End`);
  await notes.keyboard.type('\nSee [[Ops handbook]]\n');
  await notes.locator('.cm-wikilink', { hasText: 'Ops handbook' }).click();
  await notes.getByRole('tab', { name: 'Ops handbook' }).waitFor();
  await fs.access(path.join(vault, 'Ops handbook.md'));

  // Notes Claude writes appear live.
  await write('Projects/Hatstand.md', '# Hatstand\n\nFor [[Aether Labs]].\n');
  await tree.getByRole('button', { name: 'Projects' }).click();
  await tree.getByRole('button', { name: 'Hatstand' }).waitFor();

  // Unsaved edits are never overwritten: keep both saves mine as a copy.
  await notes.getByRole('tab', { name: 'Kam' }).click();
  await notes.locator('.cm-line', { hasText: 'Runs ops' }).click({ position: { x: 4, y: 8 } });
  await notes.keyboard.press('End');
  await notes.keyboard.type(' Mine.');
  await write('People/Kam.md', '# Kam\n\nRuns ops. Claude added this.\n');
  await notes.getByText('This note changed on disk while you were editing it.').waitFor();
  await notes.screenshot({ path: path.join(screenshotFolder, 'notes-conflict.png') });
  await notes.getByRole('button', { name: 'Keep both' }).click();
  await until(
    () =>
      fs.access(path.join(vault, 'People', 'Kam (my edits).md')).then(
        () => true,
        () => false,
      ),
    'copy',
  );
  assert.match(await read('People/Kam (my edits).md'), /Runs ops\. Mine\./);
  assert.equal(await read('People/Kam.md'), '# Kam\n\nRuns ops. Claude added this.\n');

  // The auto block markers can't be edited by hand.
  const session = 'Sessions/2026-10-20 Fix invoices.md';
  await tree.getByRole('button', { name: 'Sessions' }).click();
  await tree.getByRole('button', { name: '2026-10-20 Fix invoices' }).click();
  await notes.locator('.cm-auto').first().waitFor();
  await notes.locator('.cm-content').click();
  await notes.keyboard.press(`${primaryKey}+A`);
  await notes.keyboard.press('Backspace');
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.match(await read(session), /<!-- auto:start -->[\s\S]*<!-- auto:end -->/);

  // Full-text search.
  await notes.keyboard.press(`${primaryKey}+Shift+F`);
  await notes.getByLabel('Search notes').fill('proposal');
  await notes.locator('.n-search li').first().getByText('Aether').waitFor();

  // Renaming offers to update links; Trash goes through the system trash.
  await instance.evaluate(({ dialog, shell }) => {
    globalThis.trashed = [];
    dialog.showMessageBox = async () => ({ response: 1 });
    shell.trashItem = async (file) => {
      globalThis.trashed.push(file);
    };
  });
  await notes.getByRole('button', { name: 'Files', exact: true }).click();
  await tree.getByRole('button', { name: 'Kam', exact: true }).dblclick();
  await notes.getByLabel('New name').fill('Kam Reyes');
  await notes.keyboard.press('Enter');
  await until(async () => (await read('Clients/Aether.md')).includes('[[Kam Reyes]]'), 'links updated');
  await tree.getByRole('button', { name: 'Ops handbook' }).click({ button: 'right' });
  await notes.getByRole('menuitem', { name: /Move to/ }).click();
  await until(() => instance.evaluate(() => globalThis.trashed.length === 1), 'trash called');
  await fs.access(path.join(vault, 'Ops handbook.md')); // stubbed: only the system trash removes files

  // Isolation: paths can't leave the vault, and the main window can't use the notes channel.
  await assert.rejects(
    notes.evaluate((id) => window.notes.request(id, 'read', { path: '../../notes.md' }), profile),
    /Invalid note path/,
  );
  await assert.rejects(
    main.evaluate(() => window.notes.request('00000000-0000-4000-8000-000000000000', 'load')),
    /no longer exists/,
  );

  await checkGraph(notes, write);
  await checkClaude(notes, write, vault);

  await tree.getByRole('button', { name: 'Aether' }).click();
  await notes.locator('.cm-h1', { hasText: 'Aether' }).waitFor();
  await notes.screenshot({ path: path.join(screenshotFolder, 'notes.png') });
  await notes.emulateMedia({ colorScheme: 'dark' });
  await notes.screenshot({ path: path.join(screenshotFolder, 'notes-dark.png') });
  await notes.emulateMedia({ colorScheme: 'light' });
  // All vaults: one graph, a card per vault, and the way back into the profile's editor.
  await notes.getByRole('button', { name: 'All vaults' }).click();
  await notes.locator('.vault-card').first().waitFor();
  // Without WebGL (some CI runners) the overview shows its fallback note instead of a canvas.
  await notes.locator('.vault-overview canvas, .vault-overview .n-graph-off').first().waitFor();
  await notes.screenshot({ path: path.join(screenshotFolder, 'vaults.png') });
  await notes.locator('.vault-person').first().click();
  await notes.locator('.profile-hero').waitFor();
  await notes.getByRole('heading', { name: 'Running tasks' }).waitFor();
  await notes.screenshot({ path: path.join(screenshotFolder, 'profile-page.png') });
  await editProfile(notes, 0);
  await instance.evaluate(({ dialog }) => {
    dialog.showMessageBox = globalThis.realMessageBox;
  });
}
/** Session notes open in the profile's own Claude; the Ask box starts a Code session in the vault there. */
async function checkClaude(notes, write, vault) {
  const opened = () => instance.evaluate(() => globalThis.openedInClaude ?? []);
  const cli = 'cfe779c8-051c-41b9-9f4f-4204303cb625';
  const sessions = path.join(path.dirname(vault), 'desktop', 'claude-code-sessions', 'org', 'account');
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, 'local_338c5e40-ec45.json'), JSON.stringify({ cliSessionId: cli }));
  await write(
    'Sessions/2026-10/2026-10-20 North Studio – Pricing call (cfe779c8).md',
    `---\ntype: session\nsession: ${cli}\n---\n# Pricing call\n\n## Summary\n- Agreed pricing with [[Northwind]].\n`,
  );
  await notes.keyboard.press(`${primaryKey}+O`);
  await notes.getByLabel('Note name').fill('Pricing call');
  // The watcher picks the new note up within a moment.
  await notes.locator('.n-switch button', { hasText: 'Pricing call (cfe779c8)' }).click();
  await notes.getByRole('button', { name: 'Open in North Studio’s Claude' }).click();
  await until(async () => (await opened()).length === 1, 'session link sent');
  assert.equal((await opened())[0].url, 'claude://code/continue?session=local_338c5e40-ec45');
  // Ordinary notes have no session bar.
  await notes.keyboard.press(`${primaryKey}+O`);
  await notes.getByLabel('Note name').fill('Northwind');
  await notes.keyboard.press('Enter');
  await notes.getByRole('tab', { name: 'Northwind', selected: true }).waitFor();
  assert.equal(await notes.getByRole('button', { name: /^Open in / }).count(), 0);

  await notes.getByRole('button', { name: 'Ask', exact: true }).click();
  await notes
    .getByLabel('Ask North Studio’s Claude about your notes')
    .fill('What did we agree with Northwind?');
  await notes.getByRole('button', { name: 'Ask', exact: true }).last().click();
  await notes.getByRole('status').filter({ hasText: 'Asked in North Studio’s Claude' }).waitFor();
  const asked = new URL((await opened())[1].url);
  assert.equal(asked.protocol + asked.host + asked.pathname, 'claude:code/new');
  assert.equal(asked.searchParams.get('folder'), vault);
  assert.match(asked.searchParams.get('q'), /^What did we agree with Northwind\?\n\nAnswer from my notes/);
  await notes.screenshot({ path: path.join(screenshotFolder, 'notes-ask.png') });

  // Deep graph: Claude's links file shows up live as AI-suggested links, and the button asks this
  // profile's own Claude for a new one in this vault.
  await fs.mkdir(path.join(vault, '.hatstand'), { recursive: true });
  await fs.writeFile(
    path.join(vault, '.hatstand', 'inferred-links.json'),
    JSON.stringify({
      links: [
        { from: 'Clients/Northwind.md', to: 'Tools/Figma.md', reason: 'Their brand work runs in Figma.' },
        { from: 'Clients/Northwind.md', to: 'Nowhere.md', reason: 'Dropped: no such note.' },
      ],
    }),
  );
  await notes.getByRole('heading', { name: 'AI-suggested links' }).waitFor();
  await notes.locator('.n-suggested').getByText('Their brand work runs in Figma.').waitFor();
  assert.equal(await notes.locator('.n-suggested li').count(), 1);
  await notes.keyboard.press(`${primaryKey}+G`);
  await notes.getByText('AI links (1)').waitFor();
  await notes.getByRole('button', { name: 'Refresh deep graph' }).click();
  await until(async () => (await opened()).length === 3, 'deep graph link sent');
  const deep = new URL((await opened())[2].url);
  assert.equal(deep.searchParams.get('folder'), vault);
  assert.match(deep.searchParams.get('q'), /^Build a deep graph of this notes vault/);
  await notes.screenshot({ path: path.join(screenshotFolder, 'deep-graph.png') });
  await notes.getByRole('button', { name: 'Files', exact: true }).click();
}

/** Graph tab: draws the vault, filters, live updates, clicking a node opens it; local graph beside a note. */
async function checkGraph(notes, write) {
  const clients = ['Northwind', 'Lumen Co', 'Harbor & Pine'];
  const people = ['Ana', 'Jun', 'Priya'];
  const tools = ['Slack', 'Figma', 'GitHub', 'Airtable'];
  const projects = ['Website refresh', 'Invoice flow', 'Onboarding guide', 'Brand kit', 'KPI dashboard'];
  const pick = (list, i) => list[i % list.length];
  for (const [i, name] of clients.entries())
    await write(`Clients/${name}.md`, `# ${name}\n\nContact: [[${pick(people, i)}]]\n`);
  for (const [i, name] of people.entries())
    await write(`People/${name}.md`, `Works at [[${pick(clients, i)}]].\n`);
  for (const name of tools) await write(`Tools/${name}.md`, `# ${name}\n`);
  for (const [i, name] of projects.entries())
    await write(
      `Projects/${name}.md`,
      `---\nclient: "[[${pick(clients, i)}]]"\n---\nUses [[${pick(tools, i)}]] and [[${pick(tools, i + 1)}]]. Owner [[${pick(people, i + 1)}]]. Draft in [[${name} spec]].\n`,
    );
  for (let i = 0; i < 14; i++)
    await write(
      `Sessions/2026-10-${String(6 + i).padStart(2, '0')} session.md`,
      `Worked on [[${pick(projects, i)}]] with [[${pick(tools, i * 3)}]].\n`,
    );
  for (let i = 0; i < 7; i++)
    await write(
      `Daily/2026-10-${String(6 + i * 2).padStart(2, '0')}.md`,
      `- [[2026-10-${String(6 + i * 2).padStart(2, '0')} session]]\n- [[2026-10-${String(7 + i * 2).padStart(2, '0')} session]]\n`,
    );
  await write('Lonely idea.md', 'Nothing links here yet.\n');

  await notes.getByRole('button', { name: 'Graph', exact: true }).click();
  const graph = notes.getByRole('region', { name: 'Graph' });
  if (!(await graph.evaluate(() => !!document.createElement('canvas').getContext('webgl')))) {
    // GPU-less runners (macOS Intel CI): the graph says so and the rest of the window keeps working.
    await graph.getByText('The graph needs WebGL').waitFor();
    console.log('No WebGL here: graph drawing checks skipped.');
    await notes.getByRole('button', { name: 'Close Graph' }).click();
    return;
  }
  const count = async () => Number((await graph.getByText(/^\d+ notes/).textContent()).match(/\d+/)[0]);
  await graph.locator('canvas').first().waitFor();
  await until(async () => (await count()) > 40, 'graph shows the vault');
  const all = await count();

  // Filters.
  await graph.getByLabel('Hide Sessions and Daily').check();
  await until(async () => (await count()) <= all - 21, 'sessions and daily hidden');
  await graph.getByLabel('Hide Sessions and Daily').uncheck();
  await graph.getByLabel('Hide orphans').check();
  await until(async () => (await count()) < all, 'orphans hidden');
  await graph.getByLabel('Hide orphans').uncheck();
  await graph.getByRole('button', { name: /^Tools/ }).click();
  await until(async () => (await count()) < all, 'tools hidden');
  await graph.getByRole('button', { name: /^Tools/ }).click();
  await graph.getByLabel('Show missing notes').check();
  await until(async () => (await count()) >= all + projects.length, 'ghost nodes shown');
  await graph.getByLabel('Show missing notes').uncheck();
  await graph.getByLabel('Highlight notes').fill('flow');
  await graph.getByText(/, 1 match/).waitFor();
  await graph.getByLabel('Highlight notes').fill('');
  await graph.getByLabel('Highlight notes').blur();

  // Live: a note Claude writes appears without reopening the graph.
  await write('Projects/Pricing page.md', 'For [[Northwind]].\n');
  await until(async () => (await count()) === all + 1, 'graph updates live');

  // Let the layout settle, then click a node.
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await notes.screenshot({ path: path.join(screenshotFolder, 'graph.png') });
  await notes.emulateMedia({ colorScheme: 'dark' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await notes.screenshot({ path: path.join(screenshotFolder, 'graph-dark.png') });
  await notes.emulateMedia({ colorScheme: 'light' });
  const point = await graph.locator('.n-graph-canvas').evaluate((el) => {
    const data = el.sigma.getNodeDisplayData('Clients/Northwind.md');
    return el.sigma.framedGraphToViewport(data);
  });
  const box = await graph.locator('.n-graph-canvas').boundingBox();
  await notes.mouse.click(box.x + point.x, box.y + point.y);
  await notes.getByRole('tab', { name: 'Northwind', selected: true }).waitFor();
  await notes.locator('.cm-h1', { hasText: 'Northwind' }).waitFor();

  // Local graph beside the note, depth 1 then 2.
  const local = notes.getByRole('img', { name: 'Notes linked with Northwind' });
  await local.locator('canvas').first().waitFor();
  const localCount = () => local.evaluate((el) => el.sigma.getGraph().order);
  const near = await localCount();
  assert.ok(near >= 3, `local graph has neighbours (${near})`);
  await notes.getByRole('group', { name: 'Depth' }).getByRole('button', { name: '2' }).click();
  await until(async () => (await localCount()) > near, 'depth 2 shows more');
  await notes.getByRole('button', { name: 'Close Graph' }).click();
}

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
  await editProfile(page, 0);
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
  await page.getByRole('button', { name: 'Client profiles', exact: true }).click();
  await page.getByRole('button', { name: 'Open startup group (1)' }).waitFor();

  // A duplicate shortcut on another profile is refused.
  await editProfile(page, 1);
  await page.getByLabel('Profile shortcut').focus();
  await page.keyboard.press('Control+Alt+Shift+F11');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'already used' }).waitFor();
  await page.getByRole('button', { name: 'Close profile editor' }).click();

  // Second brain: opt-in per profile; wires hooks and CLAUDE.md, and turning it off removes only those.
  const [northProfile, acorn] = await readProfiles();
  const code = path.join(root, 'profiles', northProfile.id, 'code');
  await fs.mkdir(code, { recursive: true });
  const userHook = { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] };
  await fs.writeFile(path.join(code, 'settings.json'), JSON.stringify({ hooks: userHook }));
  await fs.writeFile(path.join(code, 'CLAUDE.md'), '# My rules\n');
  // Claude's own config files, where the recall MCP server goes beside the user's servers.
  const desktopDir = path.join(root, 'profiles', northProfile.id, 'desktop');
  await fs.mkdir(desktopDir, { recursive: true });
  const mcpFiles = [path.join(code, '.claude.json'), path.join(desktopDir, 'claude_desktop_config.json')];
  for (const file of mcpFiles)
    await fs.writeFile(file, JSON.stringify({ keep: 1, mcpServers: { mine: { command: 'echo' } } }));
  // A profile that already runs its own capture.py is left alone.
  const acornCode = path.join(root, 'profiles', acorn.id, 'code');
  await fs.mkdir(acornCode, { recursive: true });
  const external = JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'python3 capture.py' }] }] } });
  await fs.writeFile(path.join(acornCode, 'settings.json'), external);
  await editProfile(page, 0);
  await page.locator('summary', { hasText: 'Second brain' }).click();
  await page.getByLabel(/Keep notes from Claude Code sessions/).click();
  await page.getByText(/Second brain on\./).waitFor();
  const wired = JSON.parse(await fs.readFile(path.join(code, 'settings.json'), 'utf8'));
  const stops = JSON.stringify(wired.hooks.Stop);
  assert.ok(
    stops.includes('echo mine') && stops.split('capture.cjs').length === 2,
    'one capture hook beside the user’s',
  );
  const startHook = wired.hooks.SessionStart[0].hooks[0].command;
  assert.match(
    await fs.readFile(path.join(code, 'CLAUDE.md'), 'utf8'),
    /^# My rules\n\n<!-- hatstand:second-brain:start -->/,
  );
  const vault = path.join(root, 'profiles', northProfile.id, 'vault');
  await fs.access(path.join(vault, '_templates', 'Client.md'));
  const recallServer = async (file) =>
    JSON.parse(await fs.readFile(file, 'utf8')).mcpServers?.['hatstand-notes'];
  for (const file of mcpFiles) {
    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.ok(config.keep === 1 && config.mcpServers.mine, 'other settings and servers kept');
    assert.deepEqual((await recallServer(file)).args.slice(1), ['--vault', vault]);
  }
  {
    // The recall server really runs: Hatstand's own executable acting as Node, speaking MCP over stdio.
    const { execFileSync } = await import('node:child_process');
    const server = await recallServer(mcpFiles[0]);
    await fs.writeFile(path.join(vault, 'Clients', 'Recall check.md'), 'Pricing is 40 per seat.\n');
    const reply = execFileSync(server.command, server.args, {
      env: { ...process.env, ...server.env },
      input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_notes', arguments: { query: 'pricing' } } })}\n`,
      encoding: 'utf8',
    });
    assert.match(JSON.parse(reply).result.content[0].text, /\[\[Recall check\]\]/);
    await fs.rm(path.join(vault, 'Clients', 'Recall check.md'));
  }
  if (process.platform !== 'win32') {
    // The hook really runs: Hatstand's own executable acting as Node, through sh.
    const { execFileSync } = await import('node:child_process');
    const output = JSON.parse(execFileSync('/bin/sh', ['-c', startHook], { encoding: 'utf8' }));
    assert.match(output.hookSpecificOutput.additionalContext, /Second brain vault:/);
  }
  // Templates: edit one in place, then restore Hatstand's default.
  const toolTemplate = path.join(vault, '_templates', 'Tool.md');
  const defaultTool = await fs.readFile(toolTemplate, 'utf8');
  await instance.evaluate(({ dialog }) => {
    globalThis.realMessageBox = dialog.showMessageBox;
    globalThis.boxes = [];
    // Confirm adopt / restore, "Copy notes" when switching vaults the first time, "Just switch" after.
    dialog.showMessageBox = async (_window, options) => {
      globalThis.boxes.push(options.message);
      const copies = globalThis.boxes.filter((m) => m.startsWith('Copy')).length;
      return { response: options.message.startsWith('Copy') ? (copies === 1 ? 2 : 1) : 1 };
    };
  });
  await page.getByRole('combobox', { name: /^Template/ }).selectOption('Tool');
  await page.getByLabel('Tool template').fill('# {{title}}\n\nMy tool notes.\n');
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.getByText('Tool template saved.').waitFor();
  assert.equal(await fs.readFile(toolTemplate, 'utf8'), '# {{title}}\n\nMy tool notes.\n');
  await page.getByText('(edited)').waitFor();
  await page.getByRole('button', { name: 'Restore default' }).click();
  await page.getByText('(edited)').waitFor({ state: 'detached' });
  assert.equal(await fs.readFile(toolTemplate, 'utf8'), defaultTool);
  assert.equal(await page.getByLabel('Tool template').inputValue(), defaultTool);
  await page.locator('.template-editor').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(screenshotFolder, 'second-brain.png') });

  // Vault picker: adopt an existing Obsidian-style vault without changing its notes.
  const adopted = path.join(root, 'Existing vault');
  await fs.mkdir(path.join(adopted, '.obsidian'), { recursive: true });
  await fs.mkdir(path.join(adopted, 'Clients'));
  const acme = path.join(adopted, 'Clients', 'Acme.md');
  await fs.writeFile(acme, '# Acme\n\nMy own note.\n');
  await fs.writeFile(path.join(adopted, 'To-Do.md'), '# My list\n');
  const pickFolder = (folder) =>
    instance.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, folder);
  await pickFolder(adopted);
  await page.getByRole('button', { name: 'New vault…' }).click();
  await page.getByRole('alert').filter({ hasText: 'isn’t empty' }).waitFor();
  await page.getByRole('button', { name: 'Use existing folder…' }).click();
  await page.getByRole('dialog').locator('.path-text').filter({ hasText: 'Existing vault' }).waitFor();
  assert.deepEqual(await instance.evaluate(() => globalThis.boxes.slice(1)), [
    'Use this Obsidian vault for this profile’s notes?',
    'Copy this profile’s notes to the new folder?',
  ]);
  assert.equal(await fs.readFile(acme, 'utf8'), '# Acme\n\nMy own note.\n');
  assert.equal(await fs.readFile(path.join(adopted, 'To-Do.md'), 'utf8'), '# My list\n');
  await fs.access(path.join(adopted, 'People')); // seeded because the second brain is on
  await fs.access(path.join(adopted, '_templates', 'To-Do format.md')); // copied from the old vault
  await fs.access(path.join(vault, 'To-Do.md')); // the old vault is left in place
  assert.ok((await fs.readFile(path.join(code, 'CLAUDE.md'), 'utf8')).includes(adopted));
  // Another profile's folder is refused: vaults stay per profile.
  await pickFolder(path.join(root, 'profiles', acorn.id));
  await page.getByRole('button', { name: 'Use existing folder…' }).click();
  await page.getByRole('alert').filter({ hasText: 'Each profile keeps its own vault' }).waitFor();
  // The home folder is refused before anything under it is read.
  await pickFolder(os.homedir());
  await page.getByRole('button', { name: 'Use existing folder…' }).click();
  await page.getByRole('alert').filter({ hasText: 'not your whole home folder' }).waitFor();
  await page.getByRole('button', { name: 'Use default' }).click();
  await page.getByText('Using the default vault folder.').waitFor();
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'second-brain.json'), 'utf8'))[northProfile.id].vault,
    '',
  );
  assert.ok((await fs.readFile(path.join(code, 'CLAUDE.md'), 'utf8')).includes(vault));
  await fs.access(acme);
  await instance.evaluate(({ dialog }) => {
    dialog.showMessageBox = globalThis.realMessageBox;
  });

  await checkNotes(vault);
  await page.getByLabel(/Keep notes from Claude Code sessions/).click();
  await page.getByText(/Second brain off\./).waitFor();
  const unwired = await fs.readFile(path.join(code, 'settings.json'), 'utf8');
  assert.ok(unwired.includes('echo mine') && !unwired.includes('capture.cjs'));
  assert.equal(await fs.readFile(path.join(code, 'CLAUDE.md'), 'utf8'), '# My rules\n');
  for (const file of mcpFiles)
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
      keep: 1,
      mcpServers: { mine: { command: 'echo' } },
    });
  await fs.access(path.join(vault, 'To-Do.md'));
  await page.getByRole('button', { name: 'Close profile editor' }).click();
  await editProfile(page, 1);
  await page.locator('summary', { hasText: 'Second brain' }).click();
  await page.getByText(/already runs its own capture\.py hooks/).waitFor();
  // Its vault and templates can't be changed through IPC either.
  await assert.rejects(
    page.evaluate((id) => window.hatstand.request('saveTemplate', { id, name: 'Tool', text: 'x' }), acorn.id),
    /own capture\.py hooks/,
  );
  // (Menu-bar pets may add their own hooks there; the second brain adds nothing.)
  assert.ok(!(await fs.readFile(path.join(acornCode, 'settings.json'), 'utf8')).includes('capture.cjs'));
  await assert.rejects(fs.access(path.join(acornCode, 'CLAUDE.md')));
  await page.getByRole('button', { name: 'Close profile editor' }).click();
  await page.getByRole('button', { name: 'Client profiles', exact: true }).click();

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
    await editProfile(page, 0);
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
    'UI checks passed: setup, create, search, selection, shortcuts, work folder, second brain, notes graph, Claude links, menu keyboard, reorder past archived, archive/restore, settings, export/import, leftover data, compact layout, dark theme, sandbox.',
  );
  console.log(`Screenshots: ${screenshotFolder}`);
} finally {
  await instance.close();
  // Test root was created by mkdtemp and contains synthetic data only.
  if (root.startsWith(path.join(os.tmpdir(), 'hatstand-ui-')))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
