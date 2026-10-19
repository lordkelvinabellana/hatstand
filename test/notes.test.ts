import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  backlinks,
  buildIndex,
  createSearch,
  parseAliases,
  parseLinks,
  renameLinks,
  resolveLink,
} from '../src/core/links.ts';
import {
  createFolder,
  createNote,
  listVault,
  moveEntry,
  readAll,
  readNote,
  relinkVault,
  safePath,
  saveNote,
  trashEntry,
} from '../src/core/notes.ts';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-notes-'));

const notes = [
  {
    path: 'Clients/Aether.md',
    text: '---\ntype: client\naliases:\n  - "Aether Labs"\n  - AL\n---\n# Aether\n\nWorks with [[Kam]].\n',
  },
  {
    path: 'People/Kam.md',
    text: '---\naliases: [K, "Kam B"]\n---\nRuns [[Aether Labs|the lab]] and [[Hatstand#Roadmap]].\n',
  },
  { path: 'Projects/Hatstand.md', text: 'Built for [[aether]].\nPlain line.\n`code` and [[Missing note]]\n' },
  { path: 'Archive/Hatstand.md', text: 'Old copy, links nothing.\n' },
];

test('parses wikilinks with labels and headings', () => {
  assert.deepEqual(parseLinks('a [[One]] b [[Two|label]] c [[Three#Head|x]] ![[Four]] [[ ]]'), [
    'One',
    'Two',
    'Three',
    'Four',
  ]);
});

test('parses aliases in list, inline and single forms', () => {
  assert.deepEqual(parseAliases(notes[0].text), ['Aether Labs', 'AL']);
  assert.deepEqual(parseAliases(notes[1].text), ['K', 'Kam B']);
  assert.deepEqual(parseAliases('---\nalias: Solo\n---\n'), ['Solo']);
  assert.deepEqual(parseAliases('no front matter\naliases: [X]'), []);
});

test('resolves names, aliases and paths case-insensitively; the shallowest duplicate wins', () => {
  const index = buildIndex(notes);
  assert.equal(resolveLink(index, 'aether'), 'Clients/Aether.md');
  assert.equal(resolveLink(index, 'AETHER LABS'), 'Clients/Aether.md');
  assert.equal(resolveLink(index, 'kam b'), 'People/Kam.md');
  assert.equal(resolveLink(index, 'Archive/Hatstand'), 'Archive/Hatstand.md');
  assert.equal(resolveLink(index, 'Hatstand'), 'Archive/Hatstand.md');
  assert.equal(resolveLink(index, 'Missing note'), undefined);
});

test('an alias never shadows a real note name', () => {
  const index = buildIndex([
    { path: 'A.md', text: '---\naliases: [B]\n---\n' },
    { path: 'B.md', text: '' },
  ]);
  assert.equal(resolveLink(index, 'B'), 'B.md');
});

test('backlinks list linking notes and their lines, by name or alias', () => {
  const index = buildIndex(notes);
  assert.deepEqual(backlinks(index, 'Clients/Aether.md'), [
    { path: 'People/Kam.md', lines: ['Runs [[Aether Labs|the lab]] and [[Hatstand#Roadmap]].'] },
    { path: 'Projects/Hatstand.md', lines: ['Built for [[aether]].'] },
  ]);
  assert.deepEqual(backlinks(index, 'Projects/Hatstand.md'), []);
});

test('renaming rewrites every link form and keeps labels and headings', () => {
  assert.equal(
    renameLinks('[[Kam]] [[kam|K]] [[Kam#Log]] [[Kamal]] [[Other]]', 'Kam', 'Kam Reyes'),
    '[[Kam Reyes]] [[Kam Reyes|K]] [[Kam Reyes#Log]] [[Kamal]] [[Other]]',
  );
});

test('search finds titles, aliases and body text with a snippet', () => {
  const search = createSearch(buildIndex(notes));
  assert.equal(search('Aether')[0].path, 'Clients/Aether.md');
  assert.equal(search('Labs')[0].path, 'Clients/Aether.md');
  const plain = search('plain');
  assert.equal(plain[0].path, 'Projects/Hatstand.md');
  assert.equal(plain[0].snippet, 'Plain line.');
  assert.deepEqual(search('zzzz'), []);
});

test('paths cannot leave the vault or touch hidden folders', async () => {
  const root = await temp();
  const vault = path.join(root, 'vault');
  await fs.mkdir(vault);
  for (const bad of ['../x.md', 'a/../../x.md', '/etc/x.md', 'C:/x.md', '.obsidian/a.md', '', 'a//b.md', 7])
    await assert.rejects(safePath(vault, bad), /Invalid note path/, String(bad));
  await fs.mkdir(path.join(root, 'outside'));
  await fs.symlink(path.join(root, 'outside'), path.join(vault, 'link'), 'junction');
  await assert.rejects(createNote(vault, 'link/x.md', 'hi'), /outside the vault/);
  await assert.rejects(readNote(vault, 'link'), /\.md files/);
  assert.deepEqual(await fs.readdir(path.join(root, 'outside')), []);
  assert.equal(await safePath(vault, 'Clients/New.md'), path.join(vault, 'Clients', 'New.md'));
});

test('creating, listing and moving never overwrite', async () => {
  const vault = await temp();
  assert.equal(await createNote(vault, 'Clients/Aether.md', 'one'), 'Clients/Aether.md');
  assert.equal(await createNote(vault, 'Clients/Aether.md', 'two'), 'Clients/Aether 1.md');
  assert.equal(await readNote(vault, 'Clients/Aether.md'), 'one');
  await createFolder(vault, 'People');
  await assert.rejects(createFolder(vault, 'People'), /already exists/);
  await fs.mkdir(path.join(vault, '.obsidian'));
  await fs.writeFile(path.join(vault, 'image.png'), '');
  assert.deepEqual(await listVault(vault), {
    folders: ['Clients', 'People'],
    notes: ['Clients/Aether 1.md', 'Clients/Aether.md'],
  });
  await assert.rejects(moveEntry(vault, 'Clients/Aether 1.md', 'Clients/Aether.md'), /already exists/);
  await assert.rejects(moveEntry(vault, 'Clients/Aether 1.md', 'Clients/Aether.txt'), /\.md files/);
  await assert.rejects(moveEntry(vault, 'Clients', 'Clients/Inner'), /inside itself/);
  await moveEntry(vault, 'Clients/Aether 1.md', 'People/Kam.md');
  await moveEntry(vault, 'Clients', 'Archive/Clients');
  await moveEntry(vault, 'People/Kam.md', 'People/kam.md');
  assert.deepEqual((await listVault(vault)).notes, ['Archive/Clients/Aether.md', 'People/kam.md']);
});

test('saving refuses to overwrite a note changed on disk since it was loaded', async () => {
  const vault = await temp();
  await createNote(vault, 'A.md', 'loaded');
  assert.deepEqual(await saveNote(vault, 'A.md', 'mine', 'loaded'), { conflict: null });
  await fs.writeFile(path.join(vault, 'A.md'), 'claude wrote this');
  assert.deepEqual(await saveNote(vault, 'A.md', 'mine again', 'mine'), { conflict: 'claude wrote this' });
  assert.equal(await readNote(vault, 'A.md'), 'claude wrote this');
  // Keeping mine means saving against what is on disk now.
  assert.deepEqual(await saveNote(vault, 'A.md', 'mine again', 'claude wrote this'), { conflict: null });
  assert.equal(await readNote(vault, 'A.md'), 'mine again');
  await assert.rejects(saveNote(vault, 'A.txt', 'x', null), /\.md files/);
});

test('trash goes through the injected trash function and never unlinks', async () => {
  const vault = await temp();
  await createNote(vault, 'Old.md', 'bye');
  const trashed: string[] = [];
  await trashEntry(vault, 'Old.md', async (file) => {
    trashed.push(file);
  });
  assert.deepEqual(trashed, [path.join(vault, 'Old.md')]);
  assert.equal(await readNote(vault, 'Old.md'), 'bye');
  await assert.rejects(
    trashEntry(vault, 'Gone.md', async () => {}),
    /no longer exists/,
  );
  await assert.rejects(
    trashEntry(vault, '../x', async () => {}),
    /Invalid/,
  );
});

test('relinking a renamed note updates links across the vault only where they point at it', async () => {
  const vault = await temp();
  await createNote(vault, 'People/Kam Reyes.md', 'me');
  await createNote(vault, 'Clients/Aether.md', 'With [[Kam]] and [[Kam|K]].');
  await createNote(vault, 'Daily/2026-10-20.md', 'Nothing about [[Kamal]].');
  assert.deepEqual(await relinkVault(vault, 'Kam', 'Kam Reyes'), ['Clients/Aether.md']);
  assert.equal(await readNote(vault, 'Clients/Aether.md'), 'With [[Kam Reyes]] and [[Kam Reyes|K]].');
  assert.equal((await readAll(vault)).length, 3);
});
