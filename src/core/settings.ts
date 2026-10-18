import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRecord, assertId } from './profiles.ts';
import { normalizeAccelerator } from './accelerator.ts';
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  minimizeToTray: boolean;
  /** Legacy key retained for compatibility; on macOS this means start at login. */
  startWithWindows: boolean;
  hotkey: string;
  executable: string;
  /** First-run setup was completed or skipped. */
  setupComplete: boolean;
  /** macOS: one pet per profile in the menu bar instead of the Hatstand icon. */
  pets: boolean;
  /** macOS: pets play a sound when an account needs you or finishes. */
  petSounds: boolean;
}
export const defaults: Settings = {
  theme: 'system',
  minimizeToTray: true,
  startWithWindows: false,
  hotkey: 'CommandOrControl+Shift+Space',
  executable: '',
  setupComplete: false,
  pets: true,
  petSounds: true,
};
/** Missing keys take their defaults so settings files from older versions keep loading. */
export function validateSettings(input: unknown): Settings {
  if (!isRecord(input)) throw new Error('Invalid settings.');
  const value = { ...defaults, ...input };
  if (
    !['system', 'light', 'dark'].includes(String(value.theme)) ||
    typeof value.minimizeToTray !== 'boolean' ||
    typeof value.startWithWindows !== 'boolean' ||
    typeof value.setupComplete !== 'boolean' ||
    typeof value.pets !== 'boolean' ||
    typeof value.petSounds !== 'boolean' ||
    typeof value.executable !== 'string' ||
    value.executable.length > 1000 ||
    (value.executable !== '' && !path.win32.isAbsolute(value.executable))
  )
    throw new Error('Invalid settings.');
  return {
    theme: value.theme as Settings['theme'],
    minimizeToTray: value.minimizeToTray,
    startWithWindows: value.startWithWindows,
    hotkey: normalizeAccelerator(value.hotkey),
    executable: value.executable,
    setupComplete: value.setupComplete,
    pets: value.pets,
    petSounds: value.petSounds,
  };
}
export async function readSettings(root: string): Promise<Settings> {
  try {
    return validateSettings(JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults };
    throw error;
  }
}
export async function saveSettings(root: string, settings: Settings) {
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'settings.json');
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(validateSettings(settings), null, 2), { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
// Bindings attach existing profile folders (for example, ones created by the
// compatibility probe) without moving or copying credentials. They never
// participate in metadata export or imports.
export async function readBindings(root: string): Promise<Record<string, string>> {
  try {
    const values: unknown = JSON.parse(await fs.readFile(path.join(root, 'bindings.json'), 'utf8'));
    if (!isRecord(values)) throw new Error('Invalid local profile bindings.');
    const bindings: Record<string, string> = {};
    for (const [id, folder] of Object.entries(values)) {
      assertId(id);
      if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Invalid profile folder.');
      bindings[id] = folder;
    }
    return bindings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}
