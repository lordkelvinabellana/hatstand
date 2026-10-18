import * as fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Hatstand's data lives beside, not inside, its install folder. Squirrel.Windows
 * installs to %LOCALAPPDATA%\Hatstand and deletes that entire folder on uninstall,
 * which would otherwise take every signed-in profile with it.
 */
export function dataRoot(localAppData: string) {
  return path.join(localAppData, 'HatstandData');
}
/** Where Squirrel.Windows installs the app; replaced on update and deleted on uninstall. */
export function installRoot(localAppData: string) {
  return path.join(localAppData, 'Hatstand');
}
/** The 0.0.1 preview, released as ClientDeck, kept its data inside its own install folder. */
export function legacyDataRoot(localAppData: string) {
  return path.join(localAppData, 'ClientDeck');
}

async function exists(file: string) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
// `profiles` goes first because open Claude files make it the likeliest to fail, and
// `profiles.json` goes last so an interrupted migration is retried on the next start.
const migrated = [
  'profiles',
  'logs',
  'bindings.json',
  'settings.json',
  'profiles.json.backup',
  'profiles.json',
];

/** Moves 0.0.1 preview data out of the install folder. Renames only; nothing is copied or deleted. */
export async function migrateLegacyData(legacy: string, next: string): Promise<boolean> {
  if (!(await exists(path.join(legacy, 'profiles.json'))) || (await exists(path.join(next, 'profiles.json'))))
    return false;
  await fs.mkdir(next, { recursive: true });
  for (const entry of migrated) {
    const source = path.join(legacy, entry);
    if (!(await exists(source))) continue;
    const target = path.join(next, entry);
    if (await exists(target)) throw new Error(`Cannot move ${source}: ${target} already exists.`);
    try {
      await fs.rename(source, target);
    } catch (error) {
      throw new Error(
        `Hatstand needs to move its data to ${next}, but ${source} is in use. Close the Claude windows Hatstand opened, then start Hatstand again. (${(error as NodeJS.ErrnoException).code})`,
      );
    }
  }
  return true;
}

/** Quotes one argument so CommandLineToArgvW (and splitWindowsCommandLine) read it back unchanged. */
export function quoteWindowsArgument(value: string): string {
  if (value && !/[\s"]/.test(value)) return value;
  let result = '"';
  let slashes = 0;
  for (const character of value) {
    if (character === '\\') {
      slashes++;
      continue;
    }
    if (character === '"') result += '\\'.repeat(slashes * 2 + 1) + '"';
    else result += '\\'.repeat(slashes) + character;
    slashes = 0;
  }
  return result + '\\'.repeat(slashes * 2) + '"';
}
export function joinWindowsCommandLine(values: string[]): string {
  return values.map(quoteWindowsArgument).join(' ');
}

export interface Launcher {
  /** Executable that survives app updates. */
  target: string;
  /** Arguments that start Hatstand with `extra` passed through. */
  args(extra: string[]): string[];
  icon: string;
}
/**
 * Shortcuts, jump-list entries and the Windows login item must not point at
 * `app-<version>\Hatstand.exe`: Squirrel removes that folder on update.
 * Squirrel's own Update.exe --processStart always starts the current version.
 */
export function stableLauncher(execPath: string, existsSync: (file: string) => boolean): Launcher {
  const appFolder = path.win32.dirname(execPath);
  const installRoot = path.win32.dirname(appFolder);
  const update = path.win32.join(installRoot, 'Update.exe');
  if (/^app-\d/i.test(path.win32.basename(appFolder)) && existsSync(update)) {
    const icon = path.win32.join(installRoot, 'app.ico');
    return {
      target: update,
      args: (extra) => [
        '--processStart',
        path.win32.basename(execPath),
        ...(extra.length ? ['--process-start-args', joinWindowsCommandLine(extra)] : []),
      ],
      icon: existsSync(icon) ? icon : execPath,
    };
  }
  return { target: execPath, args: (extra) => extra, icon: execPath };
}
