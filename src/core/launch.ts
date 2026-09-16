import path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { assertId } from './profiles.ts';

export function profilePaths(root: string, id: string) {
  assertId(id);
  const base = path.resolve(root, 'profiles', id);
  return { base, desktop: path.join(base, 'desktop'), code: path.join(base, 'code') };
}
// Reject redirection through any pre-existing parent, including directory junctions.
export async function ensurePlainDirectory(directory: string): Promise<void> {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await fs.lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error('Profile storage must use ordinary directories, without links or junctions.');
  }
}
export function launchEnvironment(
  source: NodeJS.ProcessEnv,
  desktop: string,
  code: string,
): NodeJS.ProcessEnv {
  // Do not inject shell API credentials or developer endpoints into client sessions.
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => !/^(CLAUDE_|ANTHROPIC_|ELECTRON_|NODE_OPTIONS$)/i.test(key)),
  );
  return { ...env, CLAUDE_USER_DATA_DIR: desktop, CLAUDE_CONFIG_DIR: code };
}
export function launchArguments(desktop: string): string[] {
  // A unique inert argument prevents Claude's second-instance argv deduplication
  // from swallowing a subsequent explicit Focus action.
  return [`--user-data-dir=${desktop}`, `--clientdeck-activation=${randomUUID()}`];
}

// Windows command-line quoting, sufficient for exact argument matching. No execution.
export function splitWindowsCommandLine(source: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < source.length) {
    while (/\s/.test(source[i] ?? '') && i < source.length) i++;
    if (i === source.length) break;
    let token = '',
      quoted = false;
    while (i < source.length) {
      if (!quoted && /\s/.test(source[i])) break;
      let slashes = 0;
      while (source[i] === '\\') {
        slashes++;
        i++;
      }
      if (source[i] === '"') {
        token += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) token += '"';
        else if (quoted && source[i + 1] === '"') {
          token += '"';
          i++;
        } else quoted = !quoted;
        i++;
      } else {
        token += '\\'.repeat(slashes);
        if (i < source.length && (quoted || !/\s/.test(source[i]))) token += source[i++];
        else break;
      }
    }
    if (quoted) throw new Error('Unterminated command-line argument.');
    result.push(token);
  }
  return result;
}
export interface ProcessObservation {
  pid: number;
  executable: string;
  commandLine: string;
  createdAt: string;
}
export function ownsProcess(process: ProcessObservation, executable: string, desktop: string): boolean {
  if (!Number.isSafeInteger(process.pid) || process.pid <= 0 || !process.createdAt) return false;
  const same = (a: string, b: string) =>
    path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
  if (!same(process.executable, executable)) return false;
  try {
    const args = splitWindowsCommandLine(process.commandLine).slice(1);
    if (args.some((arg) => arg.startsWith('--type='))) return false;
    const dirs = args.filter((arg) => arg.startsWith('--user-data-dir='));
    return dirs.length === 1 && same(dirs[0].slice('--user-data-dir='.length), desktop);
  } catch {
    return false;
  }
}
