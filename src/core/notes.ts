import * as fs from 'node:fs/promises';
import path from 'node:path';
import { renameLinks } from './links.ts';

/**
 * File operations for the notes window. Every path comes from the renderer as a vault-relative,
 * `/`-separated path and must stay inside the vault. Nothing is ever hard-deleted: removal goes
 * through the injected `trash` (Electron's shell.trashItem).
 */

const inside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/** Resolves a vault-relative path, refusing anything that could leave the vault or touch hidden folders. */
export async function safePath(vault: string, rel: unknown) {
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || rel.includes('\0'))
    throw new Error('Invalid note path.');
  const parts = rel.split(/[\\/]/);
  if (/^[a-z]:/i.test(rel) || parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.')))
    throw new Error('Invalid note path.');
  const file = path.join(vault, ...parts);
  // A symlink inside the vault must not lead outside it: check the nearest existing ancestor's real path.
  const realVault = await fs.realpath(vault);
  let probe = file;
  for (;;) {
    const real = await fs.realpath(probe).catch(() => null);
    if (real) {
      if (!inside(realVault, real)) throw new Error('That path leads outside the vault.');
      break;
    }
    if (probe === vault) break;
    probe = path.dirname(probe);
  }
  return file;
}

const notePath = async (vault: string, rel: unknown) => {
  if (typeof rel !== 'string' || !/\.md$/i.test(rel)) throw new Error('Notes are .md files.');
  return safePath(vault, rel);
};
const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

export interface VaultListing {
  folders: string[];
  notes: string[];
}

/** Every note and folder, skipping hidden entries and symlinks. */
export async function listVault(vault: string): Promise<VaultListing> {
  const listing: VaultListing = { folders: [], notes: [] };
  async function walk(dir: string, prefix: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const rel = prefix + entry.name;
      if (entry.isDirectory()) {
        listing.folders.push(rel);
        await walk(path.join(dir, entry.name), `${rel}/`);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) listing.notes.push(rel);
    }
  }
  await walk(vault, '');
  listing.folders.sort();
  listing.notes.sort();
  return listing;
}

export async function readNote(vault: string, rel: unknown) {
  return fs.readFile(await notePath(vault, rel), 'utf8');
}

// shortcut: loads every note's text for search and backlinks; fine for thousands of notes, stream it if vaults get huge.
export async function readAll(vault: string) {
  const { notes } = await listVault(vault);
  return Promise.all(notes.map(async (p) => ({ path: p, text: await readNote(vault, p).catch(() => '') })));
}

async function atomicWrite(file: string, text: string) {
  await fs.writeFile(`${file}.hatstand-tmp`, text);
  await fs.rename(`${file}.hatstand-tmp`, file);
}

/**
 * Saves `text` only when the file still holds `base` (what the editor loaded). Otherwise nothing is
 * written and the disk text comes back, so a note Claude wrote meanwhile is never overwritten.
 */
export async function saveNote(vault: string, rel: unknown, text: string, base: string | null) {
  const file = await notePath(vault, rel);
  const disk = await fs.readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (disk !== null && base !== null && disk !== base && disk !== text) return { conflict: disk };
  if (disk !== text) await atomicWrite(file, text);
  return { conflict: null };
}

/** `Name.md`, or `Name 1.md`, `Name 2.md`… when taken. */
export async function freeName(vault: string, rel: string) {
  const ext = path.posix.extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  for (let n = 0; ; n++) {
    const candidate = n ? `${stem} ${n}${ext}` : rel;
    if (!(await exists(await safePath(vault, candidate)))) return candidate;
  }
}

/** Creates a note; never overwrites. Returns the path used (a free name when `rel` is taken). */
export async function createNote(vault: string, rel: unknown, text = '') {
  await notePath(vault, rel);
  const free = await freeName(vault, rel as string);
  const file = await notePath(vault, free);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, { flag: 'wx' });
  return free;
}

export async function createFolder(vault: string, rel: unknown) {
  const folder = await safePath(vault, rel);
  if (await exists(folder)) throw new Error('A file or folder with that name already exists.');
  await fs.mkdir(folder, { recursive: true });
}

/** Renames or moves a note or folder. Refuses to replace anything. */
export async function moveEntry(vault: string, from: unknown, to: unknown) {
  const source = await safePath(vault, from);
  const target = await safePath(vault, to);
  const stat = await fs.lstat(source);
  if (stat.isFile() && !/\.md$/i.test(String(to))) throw new Error('Notes are .md files.');
  // Case-only renames are allowed: on macOS and Windows the "existing" target is the source itself.
  const caseOnly = source.toLowerCase() === target.toLowerCase();
  if (!caseOnly && inside(source, target)) throw new Error('A folder can’t move inside itself.');
  if (!caseOnly && (await exists(target))) throw new Error('A file or folder with that name already exists.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
}

/** Moves a note or folder to the system Trash / Recycle Bin through `trash`. */
export async function trashEntry(vault: string, rel: unknown, trash: (file: string) => Promise<void>) {
  const file = await safePath(vault, rel);
  if (!(await exists(file))) throw new Error('That note no longer exists.');
  await trash(file);
}

/** Points every `[[old]]` link in the vault at `next`. Returns the notes changed. */
export async function relinkVault(vault: string, old: string, next: string) {
  const changed: string[] = [];
  for (const note of await readAll(vault)) {
    const text = renameLinks(note.text, old, next);
    if (text === note.text) continue;
    await atomicWrite(await notePath(vault, note.path), text);
    changed.push(note.path);
  }
  return changed;
}
