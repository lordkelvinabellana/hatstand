import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { AUTO_END, AUTO_START, updateDaily, updateHome } from './brain.ts';
import { withFileLock, writeFileAtomic } from './files.ts';
import { safePath } from './notes.ts';
import { defaultTemplates, TEMPLATE_NAMES, todo } from './vault.ts';

/**
 * Moving a vault's notes to another computer by hand: one exported file, imported on the other side. Nothing
 * here touches the network. The bundle is untrusted input, and an import never deletes or silently overwrites.
 */

export const BUNDLE_FORMAT = 'hatstand-notes';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = 'hatstandnotes';
const INFERRED = '.hatstand/inferred-links.json';
const LIMITS = { files: 20000, file: 20 * 1024 * 1024, total: 500 * 1024 * 1024 };

export const md5 = (data: Uint8Array | string) => createHash('md5').update(data).digest('hex');

/** Whether a vault-relative path travels in a bundle: notes, not hidden folders, caches or temporary files. */
export function isTransferable(rel: string) {
  if (rel === INFERRED) return true;
  const parts = rel.split('/');
  if (parts.some((part) => part.startsWith('.'))) return false;
  const name = parts[parts.length - 1];
  return !/(\.tmp|-tmp)$/.test(name) && name !== 'Thumbs.db' && name !== 'desktop.ini';
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Why Windows couldn't store this path, or null. */
export function windowsProblem(rel: string): string | null {
  for (const part of rel.split('/')) {
    if (/[<>:"|?*\\\x00-\x1f]/.test(part)) return 'has a character Windows can’t store';
    if (/[. ]$/.test(part)) return 'ends in a dot or a space';
    if (RESERVED.test(part)) return 'is a reserved name on Windows';
  }
  return null;
}

function pathProblem(rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || rel.includes('\0') || rel.includes('\\'))
    return 'invalid path';
  if (rel.startsWith('/') || /^[a-z]:/i.test(rel)) return 'absolute path';
  if (rel.split('/').some((part) => !part || part === '.' || part === '..')) return 'invalid path';
  return isTransferable(rel) ? null : 'not a note file';
}

export interface LocalFile {
  md5: string;
  size: number;
}

/** Every transferable file in a vault with its hash; larger files are listed in `skipped`. Symlinks are ignored. */
export async function scanVault(vault: string) {
  const files = new Map<string, LocalFile>();
  const skipped: string[] = [];
  async function walk(dir: string, prefix: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') || rel === '.hatstand')
          await walk(path.join(dir, entry.name), `${rel}/`);
      } else if (entry.isFile() && isTransferable(rel)) {
        const file = path.join(vault, rel);
        if ((await fs.stat(file)).size > LIMITS.file) skipped.push(rel);
        else {
          const data = await fs.readFile(file);
          files.set(rel, { md5: md5(data), size: data.length });
        }
      }
    }
  }
  await walk(vault, '');
  return { files, skipped };
}

export interface BundleMeta {
  vaultId: string;
  vaultName: string;
  device: string;
  exportedAt: string;
  hatstand: string;
}
export interface BundleFile {
  path: string;
  md5: string;
  data: Buffer;
}
export interface Bundle extends BundleMeta {
  files: BundleFile[];
  /** Files in the bundle that can't be imported here, with the reason. */
  rejected: { path: string; reason: string }[];
}

/** Packs a vault into one gzip'd JSON file. Bytes are kept exactly as they are. */
export async function buildBundle(vault: string, meta: Omit<BundleMeta, 'exportedAt'>) {
  const { files, skipped } = await scanVault(vault);
  const entries: { path: string; size: number; md5: string; data: string }[] = [];
  let total = 0;
  for (const [rel, info] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    total += info.size;
    if (total > LIMITS.total) throw new Error('This vault is too large to export in one file.');
    entries.push({
      path: rel,
      size: info.size,
      md5: info.md5,
      data: (await fs.readFile(path.join(vault, rel))).toString('base64'),
    });
  }
  const json = JSON.stringify({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    encryption: 'none',
    ...meta,
    exportedAt: new Date().toISOString(),
    files: entries,
  });
  return {
    buffer: gzipSync(json),
    count: entries.length,
    skipped,
    hashes: Object.fromEntries(entries.map((e) => [e.path, e.md5])) as Record<string, string>,
  };
}

const text = (value: unknown, limit: number) => (typeof value === 'string' ? value.slice(0, limit) : '');

/** Reads and checks a bundle. `windows` rejects names Windows can't store; each file's hash must match. */
export function parseBundle(buffer: Buffer, windows = process.platform === 'win32'): Bundle {
  let raw: unknown;
  try {
    raw = JSON.parse(gunzipSync(buffer, { maxOutputLength: LIMITS.total * 2 }).toString('utf8'));
  } catch {
    throw new Error('That isn’t a Hatstand notes file, or it is damaged.');
  }
  const bundle = raw as Record<string, unknown>;
  if (bundle?.format !== BUNDLE_FORMAT || typeof bundle.version !== 'number' || !Array.isArray(bundle.files))
    throw new Error('That isn’t a Hatstand notes file.');
  if (bundle.version > BUNDLE_VERSION)
    throw new Error('This file was made by a newer Hatstand. Update Hatstand, then try again.');
  if (bundle.encryption !== undefined && bundle.encryption !== 'none')
    throw new Error('This file is protected in a way this Hatstand doesn’t support.');
  if (typeof bundle.vaultId !== 'string' || !/^[0-9a-f-]{36}$/i.test(bundle.vaultId))
    throw new Error('That notes file has no valid vault id.');
  if (bundle.files.length > LIMITS.files) throw new Error('That notes file has too many files.');
  const files: BundleFile[] = [];
  const rejected: Bundle['rejected'] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const entry of bundle.files as Record<string, unknown>[]) {
    const rel = entry?.path;
    const problem = pathProblem(rel) ?? (windows && windowsProblem(rel as string));
    const label = typeof rel === 'string' ? rel.slice(0, 200) : '?';
    if (problem) {
      rejected.push({ path: label, reason: problem });
      continue;
    }
    if (seen.has((rel as string).toLowerCase())) {
      rejected.push({ path: label, reason: 'same name as another file apart from capitals' });
      continue;
    }
    seen.add((rel as string).toLowerCase());
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'base64') : null;
    if (!data || data.length !== entry.size || md5(data) !== entry.md5) {
      rejected.push({ path: label, reason: 'damaged' });
      continue;
    }
    total += data.length;
    if (total > LIMITS.total) throw new Error('That notes file is too large.');
    files.push({ path: rel as string, md5: entry.md5 as string, data });
  }
  return {
    vaultId: bundle.vaultId,
    vaultName: text(bundle.vaultName, 100),
    device: text(bundle.device, 60) || 'another computer',
    exportedAt: text(bundle.exportedAt, 40),
    hatstand: text(bundle.hatstand, 20),
    files,
    rejected,
  };
}

export type Action = 'add' | 'update' | 'merge' | 'conflict' | 'same' | 'keep' | 'deleted';
export interface PlanItem {
  path: string;
  action: Action;
  /** The bundle's hash for this file. */
  md5: string;
  /** The local file's hash when the plan was made; a write is skipped if it has changed since. */
  local?: string;
  /** Where the bundle's version is saved for a conflict. */
  conflictPath?: string;
}

/** Home.md and the Daily notes: their auto block is rebuilt from the Sessions folder, so it is regenerated, not merged. */
export const isDerived = (rel: string) => rel === 'Home.md' || /^Daily\/[^/]+\.md$/.test(rel);

/** The text outside the auto-block markers, which is the only part of a derived note a person writes. */
export function outsideAutoBlock(content: string) {
  const [before, ...rest] = content.split(AUTO_START);
  if (!rest.length) return content;
  return before + rest.join(AUTO_START).split(AUTO_END).slice(1).join(AUTO_END);
}

/** True when a local file is still exactly what Hatstand seeded (a template or an untouched To-Do.md). */
export function isSeeded(rel: string, content: string) {
  const template = /^_templates\/(.+)\.md$/.exec(rel)?.[1];
  if (template)
    return (
      (TEMPLATE_NAMES as readonly string[]).includes(template) &&
      content === defaultTemplates[template as (typeof TEMPLATE_NAMES)[number]]
    );
  const day = rel === 'To-Do.md' ? /^updated: (\S+)$/m.exec(content)?.[1] : undefined;
  return day !== undefined && content === todo(day);
}

function conflictName(rel: string, device: string, day: string, taken: Set<string>) {
  const { dir, name, ext } = path.posix.parse(rel);
  const who =
    device
      .replace(/[\\/:*?"<>|#^[\]]/g, '')
      .trim()
      .slice(0, 30) || 'another computer';
  for (let n = 1; ; n++) {
    const candidate = `${dir ? `${dir}/` : ''}${name} (imported from ${who} ${day}${n > 1 ? ` ${n}` : ''})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

/**
 * Decides, per file, what an import would do. `record` is what the other computer is known to have from the
 * last export or import (path -> hash), which lets a second round trip tell "only they changed it" from "both
 * changed it". Deletions never travel, and nothing is overwritten unless the local file is unchanged.
 */
export function planImport(input: {
  files: BundleFile[];
  local: Map<string, LocalFile>;
  record: Record<string, string>;
  device: string;
  /** YYYY-MM-DD, used in conflict file names. */
  day: string;
  /** True when the local file is still Hatstand's seeded default. */
  isSeed(rel: string): boolean;
  /** True when the local and bundled copies of a derived note have the same text outside the auto block. */
  sameOutside(rel: string, bundled: Buffer): boolean;
}): PlanItem[] {
  const taken = new Set<string>(
    [...input.local.keys(), ...input.files.map((f) => f.path)].map((p) => p.toLowerCase()),
  );
  return input.files.map((file): PlanItem => {
    const rel = file.path;
    const bundled = file.md5;
    const mine = input.local.get(rel)?.md5;
    const known = input.record[rel];
    const item = (action: Action, extra: Partial<PlanItem> = {}): PlanItem => ({
      path: rel,
      action,
      md5: bundled,
      local: mine,
      ...extra,
    });
    const clash = () =>
      isDerived(rel) && input.sameOutside(rel, file.data)
        ? item('merge')
        : item('conflict', { conflictPath: conflictName(rel, input.device, input.day, taken) });
    if (mine === bundled) return item('same');
    if (mine === undefined) return known !== undefined && known === bundled ? item('deleted') : item('add');
    if (known === undefined) return input.isSeed(rel) ? item('update') : clash();
    if (mine === known) return item('update');
    if (bundled === known) return item('keep');
    return clash();
  });
}

export interface ApplyResult {
  added: number;
  updated: number;
  merged: number;
  conflicts: number;
  /** Files left alone because they changed while the import ran. */
  skipped: string[];
}

/** Resolves a bundle path inside the vault; `.hatstand/inferred-links.json` is the one hidden file allowed. */
async function target(vault: string, rel: string) {
  if (rel !== INFERRED) return safePath(vault, rel);
  const folder = path.join(vault, '.hatstand');
  if ((await fs.lstat(folder).catch(() => null))?.isSymbolicLink()) throw new Error('Invalid note path.');
  return path.join(folder, 'inferred-links.json');
}
const exists = (file: string) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );
const hashOf = (file: string) => fs.readFile(file).then(md5, () => undefined);

/** Writes the plan. Replaces a file only if it is still the version the plan saw; never deletes. */
export function applyPlan(vault: string, files: BundleFile[], items: PlanItem[]): Promise<ApplyResult> {
  return withFileLock(vault, async () => {
    const data = new Map(files.map((f) => [f.path, f.data]));
    const result: ApplyResult = { added: 0, updated: 0, merged: 0, conflicts: 0, skipped: [] };
    const derived = new Set<string>();
    for (const item of items) {
      const bytes = data.get(item.path);
      if (!bytes || !['add', 'update', 'merge', 'conflict'].includes(item.action)) continue;
      const file = await target(
        vault,
        item.action === 'conflict' ? (item.conflictPath as string) : item.path,
      );
      await fs.mkdir(path.dirname(file), { recursive: true });
      const replacing = item.action === 'update' || item.action === 'merge';
      if (replacing ? (await hashOf(file)) !== item.local : await exists(file)) {
        result.skipped.push(item.path);
        continue;
      }
      await writeFileAtomic(file, bytes);
      if (item.action === 'add') result.added++;
      else if (item.action === 'update') result.updated++;
      else if (item.action === 'conflict') result.conflicts++;
      else {
        result.merged++;
        derived.add(item.path);
      }
    }
    // The auto blocks of merged notes list what is now in the vault, so rebuild them from it.
    for (const rel of derived)
      if (rel === 'Home.md') updateHome(vault);
      else updateDaily(vault, path.posix.basename(rel, '.md'));
    return result;
  });
}

const exchangeDir = (root: string) => path.join(root, 'vault-exchange');
const hash = /^[0-9a-f]{32}$/;

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The id this computer gave (or adopted for) a vault folder, so Mac and PC folders can differ. */
export async function vaultIdFor(root: string, folder: string) {
  const folders = (await readJson(path.join(exchangeDir(root), 'index.json'))).folders;
  const id = (folders as Record<string, unknown> | undefined)?.[path.resolve(folder)];
  return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
}

export async function setVaultId(root: string, folder: string, id: string) {
  const file = path.join(exchangeDir(root), 'index.json');
  await withFileLock(file, async () => {
    const folders = { ...((await readJson(file)).folders as Record<string, string> | undefined) };
    folders[path.resolve(folder)] = id;
    await fs.mkdir(exchangeDir(root), { recursive: true });
    await writeFileAtomic(file, JSON.stringify({ folders }, null, 2));
  });
}

/** What the other computer is known to have (path -> hash). Only well-formed entries are kept. */
export async function readRecord(root: string, id: string) {
  const files = (await readJson(path.join(exchangeDir(root), `${id}.json`))).files;
  const record: Record<string, string> = {};
  if (files && typeof files === 'object')
    for (const [rel, value] of Object.entries(files))
      if (typeof value === 'string' && hash.test(value)) record[rel] = value;
  return record;
}

/** Adds `files` to the record: paths missing from them stay, so a note deleted here stays deleted. */
export async function updateRecord(root: string, id: string, files: Record<string, string>) {
  const file = path.join(exchangeDir(root), `${id}.json`);
  await withFileLock(file, async () => {
    const next = { ...(await readRecord(root, id)), ...files };
    await fs.mkdir(exchangeDir(root), { recursive: true });
    await writeFileAtomic(file, JSON.stringify({ files: next }, null, 2));
  });
}

/** Packs `vault` and hands it to `save`; the exchange record is updated only after `save` succeeds. */
export async function exportVault(
  root: string,
  vault: string,
  meta: { vaultName: string; device: string; hatstand: string },
  save: (buffer: Buffer) => Promise<void>,
) {
  const id = (await vaultIdFor(root, vault)) ?? randomUUID();
  const built = await buildBundle(vault, { vaultId: id, ...meta });
  await save(built.buffer);
  await setVaultId(root, vault, id);
  await updateRecord(root, id, built.hashes);
  return built;
}

/** Reads a bundle and plans what importing it into `vault` would do. Writes nothing. */
export async function previewImport(root: string, vault: string, buffer: Buffer, day: string) {
  const bundle = parseBundle(buffer);
  const { files: local } = await scanVault(vault);
  const id = await vaultIdFor(root, vault);
  const items = planImport({
    files: bundle.files,
    local,
    record: await readRecord(root, id ?? bundle.vaultId),
    device: bundle.device,
    day,
    isSeed: (rel) => isSeeded(rel, readFileSync(path.join(vault, rel), 'utf8')),
    sameOutside: (rel, bundled) =>
      outsideAutoBlock(readFileSync(path.join(vault, rel), 'utf8')) ===
      outsideAutoBlock(bundled.toString('utf8')),
  });
  return { bundle, items, differentVault: id !== undefined && id !== bundle.vaultId };
}

/** Remembers what the other computer now has, so the next round trip only brings real changes. */
export async function finishImport(root: string, vault: string, bundle: Bundle, result: ApplyResult) {
  const id = (await vaultIdFor(root, vault)) ?? bundle.vaultId;
  await setVaultId(root, vault, id);
  const left = new Set(result.skipped);
  await updateRecord(
    root,
    id,
    Object.fromEntries(bundle.files.filter((f) => !left.has(f.path)).map((f) => [f.path, f.md5])),
  );
}
