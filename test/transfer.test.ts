import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { defaultTemplates, todo } from '../src/core/vault.ts';
import {
  applyPlan,
  type BundleFile,
  buildBundle,
  exportVault,
  finishImport,
  isDerived,
  isSeeded,
  isTransferable,
  type LocalFile,
  md5,
  outsideAutoBlock,
  parseBundle,
  planImport,
  previewImport,
  windowsProblem,
} from '../src/core/transfer.ts';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-transfer-'));
const ID = '11111111-2222-3333-4444-555555555555';
const meta = { vaultId: ID, vaultName: 'Mac', device: 'Kelvin’s Mac', hatstand: '0.3.0' };

async function put(vault: string, rel: string, data: string | Buffer) {
  const file = path.join(vault, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}
const get = (vault: string, rel: string) => fs.readFile(path.join(vault, rel), 'utf8');
const has = (vault: string, rel: string) =>
  fs.access(path.join(vault, rel)).then(
    () => true,
    () => false,
  );

/** A bundle as raw JSON, so tests can hand-build hostile ones. */
function raw(files: unknown[], extra: Record<string, unknown> = {}) {
  return gzipSync(
    JSON.stringify({ format: 'hatstand-notes', version: 1, vaultId: ID, vaultName: 'x', files, ...extra }),
  );
}
const entry = (rel: string, data: string | Buffer = 'hi') => {
  const bytes = Buffer.from(data);
  return { path: rel, size: bytes.length, md5: md5(bytes), data: bytes.toString('base64') };
};

test('isTransferable keeps notes and the inferred links, drops hidden and temporary files', () => {
  for (const rel of ['Home.md', 'Clients/Aether.md', '_templates/Client.md', '.hatstand/inferred-links.json'])
    assert.equal(isTransferable(rel), true, rel);
  for (const rel of [
    '.capture-errors.log',
    '.obsidian/app.json',
    '.hatstand/other.json',
    'Daily/.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    'Home.md.tmp',
    'Home.md.123.hatstand-tmp',
  ])
    assert.equal(isTransferable(rel), false, rel);
});

test('windowsProblem flags names Windows cannot store', () => {
  assert.equal(windowsProblem('Sessions/2026-10/2026-10-22 My Claude – Title (abc).md'), null);
  for (const rel of ['a:b.md', 'a?.md', 'dir./x.md', 'x /y.md', 'CON.md', 'aux/x.md', 'a\u0001.md'])
    assert.ok(windowsProblem(rel), rel);
});

test('a bundle round-trips byte for byte and leaves out what must not travel', async () => {
  const vault = await temp();
  const odd = Buffer.from([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x80]);
  await put(vault, 'Clients/Aether.md', '# Aether\r\nline\r\n');
  await put(vault, 'Projects/Odd.md', odd);
  await put(vault, '.hatstand/inferred-links.json', '{"links":[]}');
  await put(vault, '.capture-errors.log', 'oops');
  await put(vault, 'Home.md.tmp', 'half');
  await put(vault, '.obsidian/app.json', '{}');
  const built = await buildBundle(vault, meta);
  assert.equal(built.count, 3);
  const bundle = parseBundle(built.buffer);
  assert.equal(bundle.vaultId, ID);
  assert.deepEqual(bundle.rejected, []);
  const byPath = new Map(bundle.files.map((f) => [f.path, f.data]));
  assert.deepEqual([...byPath.keys()].sort(), [
    '.hatstand/inferred-links.json',
    'Clients/Aether.md',
    'Projects/Odd.md',
  ]);
  assert.ok(byPath.get('Projects/Odd.md')?.equals(odd));
  assert.equal(byPath.get('Clients/Aether.md')?.toString(), '# Aether\r\nline\r\n');
});

test('parseBundle refuses files that are not notes bundles', () => {
  assert.throws(() => parseBundle(Buffer.from('not gzip')), /isn’t a Hatstand notes file/);
  assert.throws(() => parseBundle(gzipSync('{"format":"other"}')), /isn’t a Hatstand notes file/);
  assert.throws(() => parseBundle(raw([], { version: 2 })), /newer Hatstand/);
  assert.throws(() => parseBundle(raw([], { encryption: 'aes' })), /doesn’t support/);
  assert.throws(() => parseBundle(raw([], { vaultId: '../etc' })), /vault id/);
});

test('parseBundle rejects hostile or damaged entries and keeps the good ones', () => {
  const damaged = { ...entry('Damaged.md', 'real'), md5: md5('other') };
  const bundle = parseBundle(
    raw([
      entry('Fine.md'),
      entry('../escape.md'),
      entry('/abs.md'),
      entry('C:/win.md'),
      entry('a\\b.md'),
      entry('.hidden/x.md'),
      entry('Clients/../../x.md'),
      entry('Case.md'),
      entry('case.md'),
      entry('.DS_Store'),
      damaged,
      { path: 'NoData.md', size: 1, md5: md5('x') },
    ]),
    false,
  );
  assert.deepEqual(
    bundle.files.map((f) => f.path),
    ['Fine.md', 'Case.md'],
  );
  assert.equal(bundle.rejected.length, 10);
  assert.ok(bundle.rejected.some((r) => r.path === 'case.md' && /capitals/.test(r.reason)));
  assert.ok(bundle.rejected.some((r) => r.path === 'Damaged.md' && r.reason === 'damaged'));
});

test('on Windows, parseBundle skips names Windows cannot store', () => {
  const bundle = parseBundle(raw([entry('Fine.md'), entry('Note: colon.md')]), true);
  assert.deepEqual(
    bundle.files.map((f) => f.path),
    ['Fine.md'],
  );
  assert.match(bundle.rejected[0].reason, /Windows/);
  assert.equal(parseBundle(raw([entry('Note: colon.md')]), false).files.length, 1);
});

test('outsideAutoBlock, isDerived and isSeeded', () => {
  const note = 'top\n<!-- auto:start -->\nX\n<!-- auto:end -->\nbottom\n';
  assert.equal(outsideAutoBlock(note), 'top\n\nbottom\n');
  assert.equal(outsideAutoBlock('plain'), 'plain');
  assert.ok(isDerived('Home.md') && isDerived('Daily/2026-10-22.md'));
  assert.ok(!isDerived('To-Do.md') && !isDerived('Daily/sub/x.md'));
  assert.ok(isSeeded('_templates/Client.md', defaultTemplates.Client));
  assert.ok(!isSeeded('_templates/Client.md', `${defaultTemplates.Client}edit`));
  assert.ok(isSeeded('To-Do.md', todo('2026-10-22')));
  assert.ok(!isSeeded('To-Do.md', `${todo('2026-10-22')}- [ ] mine\n`));
});

const file = (rel: string, text: string): BundleFile => ({
  path: rel,
  md5: md5(text),
  data: Buffer.from(text),
});
const here = (entries: Record<string, string>) =>
  new Map<string, LocalFile>(
    Object.entries(entries).map(([rel, text]) => [rel, { md5: md5(text), size: text.length }]),
  );
const rec = (entries: Record<string, string>) =>
  Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, md5(v)]));
const plan = (
  files: BundleFile[],
  local: Record<string, string>,
  record: Record<string, string>,
  extra: Partial<Parameters<typeof planImport>[0]> = {},
) =>
  Object.fromEntries(
    planImport({
      files,
      local: here(local),
      record: rec(record),
      device: 'PC',
      day: '2026-10-26',
      isSeed: () => false,
      sameOutside: () => false,
      ...extra,
    }).map((i) => [i.path, i.action]),
  );

test('planImport covers every case of the three-way rule', () => {
  const actions = plan(
    [
      file('same.md', 'a'),
      file('new.md', 'n'),
      file('theirs.md', 'B'),
      file('mine.md', 'a'),
      file('both.md', 'B'),
      file('gone.md', 'a'),
      file('restored.md', 'B'),
      file('first-diff.md', 'B'),
    ],
    { 'same.md': 'a', 'theirs.md': 'a', 'mine.md': 'A', 'both.md': 'A', 'first-diff.md': 'A' },
    { 'same.md': 'a', 'theirs.md': 'a', 'mine.md': 'a', 'both.md': 'a', 'gone.md': 'a', 'restored.md': 'a' },
  );
  assert.deepEqual(actions, {
    'same.md': 'same',
    'new.md': 'add',
    'theirs.md': 'update',
    'mine.md': 'keep',
    'both.md': 'conflict',
    'gone.md': 'deleted',
    'restored.md': 'add',
    'first-diff.md': 'conflict',
  });
});

test('planImport: derived notes merge when only the auto block differs; seeded files give way', () => {
  const files = [file('Home.md', 'B'), file('To-Do.md', 'B'), file('Daily/2026-10-22.md', 'B')];
  const local = { 'Home.md': 'A', 'To-Do.md': 'A', 'Daily/2026-10-22.md': 'A' };
  assert.deepEqual(plan(files, local, {}, { sameOutside: () => true, isSeed: (r) => r === 'To-Do.md' }), {
    'Home.md': 'merge',
    'To-Do.md': 'update',
    'Daily/2026-10-22.md': 'merge',
  });
  assert.deepEqual(plan(files, local, {}), {
    'Home.md': 'conflict',
    'To-Do.md': 'conflict',
    'Daily/2026-10-22.md': 'conflict',
  });
});

test('planImport names conflict copies after the other computer and never reuses a name', () => {
  const items = planImport({
    files: [file('Projects/A.md', 'B'), file('Projects/A (imported from PC 2026-10-26).md', 'x')],
    local: here({ 'Projects/A.md': 'A' }),
    record: {},
    device: 'PC',
    day: '2026-10-26',
    isSeed: () => false,
    sameOutside: () => false,
  });
  assert.equal(items[0].conflictPath, 'Projects/A (imported from PC 2026-10-26 2).md');
});

test('applyPlan writes, keeps both on conflict, never deletes, and skips files that changed meanwhile', async () => {
  const vault = await temp();
  await put(vault, 'theirs.md', 'a');
  await put(vault, 'both.md', 'A');
  await put(vault, 'race.md', 'a');
  await put(vault, 'unrelated.md', 'keep me');
  const files = [
    file('theirs.md', 'B'),
    file('both.md', 'B'),
    file('race.md', 'B'),
    file('deep/new.md', 'n'),
  ];
  const items = planImport({
    files,
    local: here({ 'theirs.md': 'a', 'both.md': 'A', 'race.md': 'a' }),
    record: rec({ 'theirs.md': 'a', 'both.md': 'a', 'race.md': 'a' }),
    device: 'PC',
    day: '2026-10-26',
    isSeed: () => false,
    sameOutside: () => false,
  });
  await put(vault, 'race.md', 'typed just now');
  const result = await applyPlan(vault, files, items);
  assert.deepEqual(result, { added: 1, updated: 1, merged: 0, conflicts: 1, skipped: ['race.md'] });
  assert.equal(await get(vault, 'theirs.md'), 'B');
  assert.equal(await get(vault, 'both.md'), 'A');
  assert.equal(await get(vault, 'both (imported from PC 2026-10-26).md'), 'B');
  assert.equal(await get(vault, 'race.md'), 'typed just now');
  assert.equal(await get(vault, 'deep/new.md'), 'n');
  assert.equal(await get(vault, 'unrelated.md'), 'keep me');
});

test('applyPlan refuses a path that would leave the vault', async () => {
  const vault = await temp();
  const files = [file('x.md', 'x')];
  const items = [{ path: 'x.md', action: 'add' as const, md5: md5('x') }];
  items[0].path = '../outside.md';
  files[0].path = '../outside.md';
  await assert.rejects(applyPlan(vault, files, items), /Invalid note path/);
});

test('merging a derived note keeps the local text and rebuilds the auto block from the sessions', async () => {
  const vault = await temp();
  const note = (block: string, notes: string) =>
    `# 2026-10-22 · Thursday\n\n## Notes\n${notes}\n\n<!-- auto:start -->\n${block}\n<!-- auto:end -->\n`;
  await put(vault, 'Daily/2026-10-22.md', note('old local list', 'same notes'));
  const session =
    '---\ntype: session\nprofile: PC\nstarted: 2026-10-22T09:00\nupdated: 2026-10-22T09:30\nprompts: 3\n---\n';
  await put(vault, 'Sessions/2026-10/2026-10-22 PC – Work (abcd1234).md', session);
  const bundled = file('Daily/2026-10-22.md', note('their list', 'same notes'));
  const items = planImport({
    files: [bundled],
    local: new Map([['Daily/2026-10-22.md', { md5: md5(await get(vault, 'Daily/2026-10-22.md')), size: 1 }]]),
    record: {},
    device: 'PC',
    day: '2026-10-26',
    isSeed: () => false,
    sameOutside: (_rel, b) => outsideAutoBlock(b.toString()) === outsideAutoBlock(note('x', 'same notes')),
  });
  assert.equal(items[0].action, 'merge');
  const result = await applyPlan(vault, [bundled], items);
  assert.equal(result.merged, 1);
  const merged = await get(vault, 'Daily/2026-10-22.md');
  assert.match(merged, /same notes/);
  assert.match(merged, /\[\[2026-10-22 PC – Work \(abcd1234\)\|Work\]\]/);
  assert.doesNotMatch(merged, /their list|old local list/);
});

test('two computers converge across export and import, with no stray conflicts', async () => {
  const [macRoot, pcRoot, mac, pc] = await Promise.all([temp(), temp(), temp(), temp()]);
  await put(mac, 'Clients/Aether.md', 'v1');
  await put(mac, 'Projects/Plan.md', 'plan');
  const send = async (fromRoot: string, from: string, toRoot: string, to: string, device: string) => {
    let saved: Buffer = Buffer.alloc(0);
    await exportVault(fromRoot, from, { vaultName: 'v', device, hatstand: '0.3.0' }, async (b) => {
      saved = b;
    });
    const preview = await previewImport(toRoot, to, saved, '2026-10-26');
    const result = await applyPlan(to, preview.bundle.files, preview.items);
    await finishImport(toRoot, to, preview.bundle, result);
    return { preview, result };
  };

  const first = await send(macRoot, mac, pcRoot, pc, 'Mac');
  assert.equal(first.result.added, 2);
  assert.equal(await get(pc, 'Clients/Aether.md'), 'v1');

  await put(pc, 'Clients/Aether.md', 'v2 from PC');
  await put(pc, 'People/New.md', 'new');
  const back = await send(pcRoot, pc, macRoot, mac, 'PC');
  assert.equal(back.preview.differentVault, false);
  assert.deepEqual([back.result.added, back.result.updated, back.result.conflicts], [1, 1, 0]);
  assert.equal(await get(mac, 'Clients/Aether.md'), 'v2 from PC');

  const again = await send(macRoot, mac, pcRoot, pc, 'Mac');
  assert.deepEqual([again.result.added, again.result.updated, again.result.conflicts], [0, 0, 0]);

  await put(mac, 'Projects/Plan.md', 'plan edited on Mac');
  await put(pc, 'Projects/Plan.md', 'plan edited on PC');
  const clash = await send(macRoot, mac, pcRoot, pc, 'Mac');
  assert.equal(clash.result.conflicts, 1);
  assert.equal(await get(pc, 'Projects/Plan.md'), 'plan edited on PC');
  assert.equal(await get(pc, 'Projects/Plan (imported from Mac 2026-10-26).md'), 'plan edited on Mac');

  await fs.rm(path.join(pc, 'People/New.md'));
  const keepDeleted = await send(macRoot, mac, pcRoot, pc, 'Mac');
  assert.equal(await has(pc, 'People/New.md'), false);
  assert.equal(keepDeleted.preview.items.find((i) => i.path === 'People/New.md')?.action, 'deleted');
});

test('importing the same file twice changes nothing; a different vault is flagged', async () => {
  const [root, source, target, other] = await Promise.all([temp(), temp(), temp(), temp()]);
  await put(source, 'A.md', 'a');
  let saved: Buffer = Buffer.alloc(0);
  await exportVault(await temp(), source, { vaultName: 'v', device: 'Mac', hatstand: '0.3.0' }, async (b) => {
    saved = b;
  });
  const one = await previewImport(root, target, saved, '2026-10-26');
  await finishImport(root, target, one.bundle, await applyPlan(target, one.bundle.files, one.items));
  const two = await previewImport(root, target, saved, '2026-10-26');
  assert.deepEqual(
    two.items.map((i) => i.action),
    ['same'],
  );
  assert.equal(two.differentVault, false);

  await put(other, 'B.md', 'b');
  const otherRoot = await temp();
  await exportVault(otherRoot, other, { vaultName: 'o', device: 'X', hatstand: '0.3.0' }, async () => {});
  const wrong = await previewImport(otherRoot, target, saved, '2026-10-26');
  assert.equal(wrong.differentVault, false, 'a vault never exchanged has no id to compare against');
  const mixed = await previewImport(
    root,
    target,
    await (async () => {
      let b: Buffer = Buffer.alloc(0);
      await exportVault(
        await temp(),
        other,
        { vaultName: 'o', device: 'X', hatstand: '0.3.0' },
        async (x) => {
          b = x;
        },
      );
      return b;
    })(),
    '2026-10-26',
  );
  assert.equal(mixed.differentVault, true);
});
