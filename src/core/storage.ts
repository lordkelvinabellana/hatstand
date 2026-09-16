import * as fs from 'node:fs/promises';
import path from 'node:path';
import { assertId } from './profiles.ts';
import { profilePaths } from './launch.ts';

export interface StorageFolder {
  id: string;
  path: string;
  /** Still belongs to a profile in profiles.json. */
  registered: boolean;
  bytes: number;
  /** True when measuring stopped early; `bytes` is then a lower bound. */
  partial: boolean;
  modifiedAt: string;
}

/** Sums file sizes without following links or junctions. */
export async function measureFolder(folder: string, maxEntries = 200_000) {
  let bytes = 0;
  let entries = 0;
  const pending = [folder];
  while (pending.length) {
    const current = pending.pop()!;
    let children: import('node:fs').Dirent[];
    try {
      children = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (++entries > maxEntries) return { bytes, partial: true };
      const file = path.join(current, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) pending.push(file);
      else if (child.isFile()) {
        try {
          bytes += (await fs.lstat(file)).size;
        } catch {}
      }
    }
  }
  return { bytes, partial: false };
}

/** Lists Hatstand-managed profile folders, including ones left behind by removed profiles. */
export async function listProfileFolders(root: string, registered: Set<string>): Promise<StorageFolder[]> {
  const parent = path.join(root, 'profiles');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const folders: StorageFolder[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      assertId(entry.name);
    } catch {
      continue;
    }
    const folder = path.join(parent, entry.name);
    const [size, info] = await Promise.all([measureFolder(folder), fs.lstat(folder)]);
    folders.push({
      id: entry.name,
      path: folder,
      registered: registered.has(entry.name),
      ...size,
      modifiedAt: info.mtime.toISOString(),
    });
  }
  return folders.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * Returns the exact managed folder for `id` after checking that neither it nor its
 * parents inside `root` are links or junctions. Only folders Hatstand created under
 * `root\profiles` can be removed; attached (bound) folders never are.
 */
export async function resolveRemovableFolder(root: string, id: string): Promise<string> {
  assertId(id);
  const target = profilePaths(root, id).base;
  const relative = path.relative(path.resolve(root), target).split(path.sep);
  if (relative.length !== 2 || relative[0] !== 'profiles') throw new Error('Refusing to remove this folder.');
  let current = path.resolve(root);
  for (const segment of relative) {
    current = path.join(current, segment);
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('Refusing to remove a folder reached through a link or junction.');
  }
  return target;
}
