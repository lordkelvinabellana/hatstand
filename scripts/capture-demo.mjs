// Captures clean product screens from the real app for videos, the website and posts.
// Stages a made-up workspace (four client profiles, full vaults with links and AI links, running tasks)
// in a temporary data folder, starts Hatstand in test mode against it, and screenshots each screen.
//   node scripts/capture-demo.mjs <output folder>
// Never launches Claude. Paths on screen are shortened so no real folder names show.
import { _electron as electron } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const out = path.resolve(process.argv[2] || '.local/demo-screens');
await fs.mkdir(out, { recursive: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-demo-'));
const now = new Date().toISOString();
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const PROFILES = [
  {
    name: 'North Studio',
    accountLabel: 'Brand and web design',
    color: 'teal',
    icon: 'NS',
    pet: 'cat',
    hotkey: 'CommandOrControl+Alt+1',
  },
  {
    name: 'Acorn & Co.',
    accountLabel: 'Bookkeeping automations',
    color: 'amber',
    icon: 'AC',
    pet: 'frog',
    hotkey: 'CommandOrControl+Alt+2',
  },
  {
    name: 'Riverline',
    accountLabel: 'Marketing operations',
    color: 'violet',
    icon: 'RL',
    pet: 'ghost',
    hotkey: '',
  },
  { name: 'Personal', accountLabel: 'My own projects', color: 'blue', icon: 'ME', pet: 'bunny', hotkey: '' },
].map((p) => ({
  ...p,
  id: randomUUID(),
  workFolder: '',
  openAtStartup: false,
  archived: false,
  createdAt: now,
  updatedAt: now,
}));
await fs.writeFile(
  path.join(root, 'profiles.json'),
  JSON.stringify({ schemaVersion: 2, profiles: PROFILES }, null, 2),
);

// The installed Claude version, so the untested-version banner doesn't show (the user has confirmed it).
let claude = '';
try {
  claude = execFileSync(
    'defaults',
    ['read', '/Applications/Claude.app/Contents/Info', 'CFBundleShortVersionString'],
    { encoding: 'utf8' },
  ).trim();
} catch {}
const docs = path.join(root, 'Documents');
await fs.writeFile(
  path.join(root, 'settings.json'),
  JSON.stringify(
    {
      theme: 'light',
      minimizeToTray: true,
      startWithWindows: false,
      hotkey: 'CommandOrControl+Shift+Space',
      executable: '',
      setupComplete: true,
      pets: true,
      petSounds: false,
      syncEnabled: false,
      syncUrl: '',
      syncKey: '',
      syncEmail: '',
      confirmedVersions: claude ? [claude] : [],
      backupFolder: path.join(root, 'Obsidian', 'Hatstand Backup'),
    },
    null,
    2,
  ),
);

// ---------- vaults ----------
const VAULTS = {
  'North Studio': {
    Clients: {
      Northwind: ['Brand kit', 'Website refresh', 'Ana', 'Figma'],
      'Harbor & Pine': ['Pricing page', 'Jun', 'Webflow'],
      'Lumen Co': ['Onboarding guide', 'Priya', 'Notion'],
      Fieldhouse: ['Brand kit', 'Ana'],
    },
    Projects: {
      'Brand kit': ['Figma', 'Ana', 'Northwind'],
      'Website refresh': ['Webflow', 'Northwind', 'Figma', 'Jun'],
      'Pricing page': ['Webflow', 'Harbor & Pine'],
      'Onboarding guide': ['Notion', 'Lumen Co', 'Priya'],
      'Launch video': ['Northwind', 'Figma'],
      'Design system': ['Figma', 'Website refresh'],
      'Client portal': ['Supabase', 'Next.js', 'Harbor & Pine'],
    },
    People: {
      Ana: ['Northwind', 'Brand kit'],
      Jun: ['Harbor & Pine', 'Website refresh'],
      Priya: ['Lumen Co'],
      Marco: ['Fieldhouse'],
      Tess: ['Launch video'],
    },
    Tools: { Figma: [], Webflow: [], Notion: [], Supabase: [], 'Next.js': ['Supabase'], Slack: [], Loom: [] },
    ai: [
      ['Launch video', 'Loom'],
      ['Client portal', 'Onboarding guide'],
      ['Fieldhouse', 'Design system'],
      ['Marco', 'Brand kit'],
      ['Pricing page', 'Client portal'],
      ['Tess', 'Northwind'],
      ['Slack', 'Lumen Co'],
      ['Design system', 'Pricing page'],
      ['Jun', 'Client portal'],
      ['Priya', 'Notion'],
      ['Webflow', 'Design system'],
    ],
  },
  'Acorn & Co.': {
    Clients: {
      'Maple Dental': ['Invoice flow', 'Rosa'],
      'Brightway Tours': ['Receipts sync', 'Ken'],
      'Oakline Cafe': ['Payroll checks'],
    },
    Projects: {
      'Invoice flow': ['n8n', 'QuickBooks', 'Maple Dental'],
      'Receipts sync': ['Zapier', 'Brightway Tours'],
      'Payroll checks': ['Airtable', 'Oakline Cafe'],
      'Month-end report': ['QuickBooks', 'Airtable'],
    },
    People: { Rosa: ['Maple Dental'], Ken: ['Brightway Tours'], Liza: ['Month-end report'] },
    Tools: { n8n: [], QuickBooks: [], Zapier: [], Airtable: [], Slack: [] },
    ai: [
      ['Receipts sync', 'n8n'],
      ['Liza', 'Payroll checks'],
      ['Oakline Cafe', 'Month-end report'],
      ['Slack', 'Invoice flow'],
      ['Ken', 'Month-end report'],
    ],
  },
  Riverline: {
    Clients: {
      'Peak Outdoors': ['Spring campaign', 'Dana'],
      'Solace Skin': ['Ads dashboard', 'Imran'],
      'Kite Labs': ['Lead scoring'],
    },
    Projects: {
      'Spring campaign': ['Meta Ads', 'Peak Outdoors'],
      'Ads dashboard': ['Looker Studio', 'Solace Skin'],
      'Lead scoring': ['HubSpot', 'Kite Labs'],
      'Weekly digest': ['Slack', 'Looker Studio'],
    },
    People: { Dana: ['Peak Outdoors'], Imran: ['Solace Skin'], Bea: ['Weekly digest'] },
    Tools: { 'Meta Ads': [], 'Looker Studio': [], HubSpot: [], Slack: [] },
    ai: [
      ['Lead scoring', 'Weekly digest'],
      ['Bea', 'Ads dashboard'],
      ['Spring campaign', 'Looker Studio'],
      ['Imran', 'Weekly digest'],
    ],
  },
  Personal: {
    Clients: {},
    Projects: {
      Portfolio: ['Next.js', 'Vercel'],
      'Job search': ['Portfolio'],
      'Video course': ['DaVinci Resolve'],
    },
    People: { Mentor: ['Job search'] },
    Tools: { 'Next.js': [], Vercel: [], 'DaVinci Resolve': [] },
    ai: [
      ['Video course', 'Portfolio'],
      ['Mentor', 'Video course'],
    ],
  },
};
const blurb = {
  Clients: (n) =>
    `${n} is a client of the studio. Weekly check-ins on Tuesdays; decisions go in the log below.`,
  Projects: (n) => `${n}: what it is, who it's for and what done looks like.`,
  People: (n) => `${n} is the main contact for the work below. Prefers short updates.`,
  Tools: (n) => `${n}: how we use it, and the gotchas we've hit.`,
};
const folder = { Clients: 'Client', Projects: 'Project', People: 'Person', Tools: 'Tool' };
const vaultOf = {};
for (const p of PROFILES) {
  const v = VAULTS[p.name],
    dir = path.join(docs, 'Hatstand Notes', p.name);
  vaultOf[p.id] = dir;
  const write = async (rel, text) => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  };
  const names = [];
  for (const group of ['Clients', 'Projects', 'People', 'Tools'])
    for (const [name, links] of Object.entries(v[group])) {
      names.push(name);
      await write(
        `${group}/${name}.md`,
        `---\ntype: ${folder[group].toLowerCase()}\nupdated: ${day(1)}\n---\n# ${name}\n\n${blurb[group](name)}\n\n## Linked\n${links.map((l) => `- [[${l}]]`).join('\n')}\n\n## Log\n- ${day(2)} Kicked off; notes kept by Claude.\n- ${day(6)} First call.\n`,
      );
    }
  for (let i = 0; i < 6; i++) {
    const about = names[(i * 3) % names.length],
      with2 = names[(i * 5 + 2) % names.length];
    await write(
      `Sessions/${day(i).slice(0, 7)}/${day(i)} ${p.name} – ${about} (${randomUUID().slice(0, 8)}).md`,
      `---\ntype: session\nprofile: "[[${p.name}]]"\n---\n# ${about}\n\n## Summary\n- Worked on [[${about}]] with [[${with2}]].\n`,
    );
  }
  await write('To-Do.md', `# To-Do\n\n## Open\n- [ ] Send the update · [[${names[0] ?? 'Portfolio'}]]\n`);
  await write(
    'Home.md',
    `# ${p.name}\n\nClaude keeps this vault: clients, projects, people, tools and a log of every session.\n`,
  );
  const ai = v.ai.map(([from, to], i) => ({
    from,
    to,
    reason: `Both deal with the same work; worth linking (${i + 1}).`,
    confidence: 0.7 + (i % 3) * 0.1,
  }));
  await write('.hatstand/inferred-links.json', JSON.stringify({ generated: day(0), links: ai }, null, 2));
}
await fs.writeFile(
  path.join(root, 'second-brain.json'),
  JSON.stringify(
    Object.fromEntries(PROFILES.map((p) => [p.id, { enabled: true, vault: vaultOf[p.id] }])),
    null,
    2,
  ),
);

// ---------- running tasks (what the menu-bar pets read): session files plus Claude Code transcripts ----------
const TASKS = {
  'North Studio': [
    [
      'working',
      'Weekly report for Northwind',
      'Draft this week’s update for Northwind from the vault',
      [2, 5],
    ],
    ['ask', 'Pricing page copy', 'Tighten the Harbor & Pine pricing page copy', [4, 4]],
    ['done', 'Onboarding guide', 'Turn the Lumen Co notes into an onboarding guide', [6, 6]],
  ],
  'Acorn & Co.': [['working', 'Invoice flow fix', 'Why did the Maple Dental invoice fail?', [3, 6]]],
  Riverline: [['done', 'Ads dashboard', 'Add Solace Skin spend to the dashboard', [5, 5]]],
};
for (const p of PROFILES) {
  const base = path.join(root, 'profiles', p.id);
  for (const sub of ['desktop', 'code', 'pet']) await fs.mkdir(path.join(base, sub), { recursive: true });
  for (const [k, [state, title, prompt, [done, total]]] of (TASKS[p.name] ?? []).entries()) {
    const id = randomUUID(),
      transcript = path.join(base, 'code', 'projects', 'demo', `${id}.jsonl`);
    await fs.mkdir(path.dirname(transcript), { recursive: true });
    const todos = Array.from({ length: total }, (_, i) => ({
      content: `Step ${i + 1}`,
      status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending',
    }));
    const lines = [
      { type: 'custom-title', customTitle: title },
      { type: 'user', message: { content: prompt } },
      {
        type: 'assistant',
        cwd: base,
        message: {
          id: `m${k}`,
          model: 'claude-opus-5-5',
          usage: { input_tokens: 9000 + k * 7000, cache_read_input_tokens: 30000, output_tokens: 2400 },
          content: [
            { type: 'tool_use', id: `t${k}`, name: 'TodoWrite', input: { todos } },
            ...(state === 'ask'
              ? [
                  {
                    type: 'tool_use',
                    id: `w${k}`,
                    name: 'mcp__ccd_turn__wrap_up',
                    input: { ask: 'Use the shorter version?' },
                  },
                ]
              : []),
          ],
        },
      },
    ];
    await fs.writeFile(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    await fs.writeFile(
      path.join(base, 'pet', `${id}.json`),
      JSON.stringify({ state, at: Date.now() - k * 60000, transcript }),
    );
  }
}

// ---------- capture ----------
const env = { ...process.env, HATSTAND_TEST_MODE: '1', HATSTAND_TEST_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, timeout: 30_000 });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  w.setSize(1440, 900);
  w.center();
});
await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
const tidy = () =>
  page.evaluate((r) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) walker.currentNode.nodeValue = walker.currentNode.nodeValue.replaceAll(r, '~');
    for (const b of document.querySelectorAll('.banner')) b.remove();
    for (const v of document.querySelectorAll('.version'))
      v.textContent = v.textContent.replace(/ · [0-9a-f]{4,40}(-dirty)?$/, '');
  }, root);
const shot = async (name) => {
  await page.waitForTimeout(700);
  await tidy();
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('captured', name);
};
const nav = (label) => page.getByRole('button', { name: label, exact: true }).click();

await page.locator('.profile-row').first().waitFor();
await shot('01 profiles');
await page.locator('.profile-row .profile-status').first().click();
await page
  .locator('.task')
  .first()
  .waitFor({ timeout: 15000 })
  .catch(() => console.log('no running tasks showed'));
await shot('02 profile page');
await nav('Second brain');
await page.locator('.vault-overview canvas').first().waitFor();
await page.waitForTimeout(6500); // let the layout settle
await shot('03 second brain');
await page.locator('.vault-card').first().getByRole('button', { name: 'Open notes' }).click();
await page.locator('section.n-graph').waitFor();
await page.waitForTimeout(6500);
await shot('04 vault graph');
const tree = page.getByRole('navigation', { name: 'Notes and folders' });
await page.getByRole('button', { name: 'Files', exact: true }).click();
await tree.getByRole('button', { name: 'Clients' }).click();
await tree.getByRole('button', { name: 'Northwind' }).click();
await page.locator('.cm-content').waitFor();
await page.waitForTimeout(2500);
await shot('05 note editor');
await nav('Settings');
await page.getByRole('heading', { name: 'Second brain backup' }).scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('.page')?.closest('main')?.scrollBy(0, -80));
await shot('06 settings backup');
await nav('Client profiles');
await page.locator('.profile-row').first().waitFor();
await app.close();
await fs.rm(root, { recursive: true, force: true });
console.log('done:', out);
