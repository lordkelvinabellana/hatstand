import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { acceleratorKey, normalizeAccelerator } from './accelerator.ts';
import { speciesNames } from './sprites.ts';

export const colors = ['teal', 'amber', 'violet', 'blue', 'rose', 'slate'] as const;
export type Color = (typeof colors)[number];
export interface Profile {
  id: string;
  name: string;
  accountLabel: string;
  color: Color;
  icon: string;
  /** Pixel pet used as the avatar and menu-bar pet; '' shows the initials. */
  pet: string;
  /** Global shortcut that launches or focuses this profile; '' when unset. */
  hotkey: string;
  /** Optional client work folder. Convenience only: it does not restrict Claude's file access. */
  workFolder: string;
  /** Open this profile when Hatstand starts at login. */
  openAtStartup: boolean;
  archived: boolean;
  createdAt: string;
}
export interface ProfileInput {
  name: string;
  accountLabel?: string;
  color?: Color;
  icon?: string;
  pet?: string;
  hotkey?: string;
  workFolder?: string;
  openAtStartup?: boolean;
}
export const schemaVersion = 2;
export interface ProfileState {
  schemaVersion: typeof schemaVersion;
  profiles: Profile[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function assertId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) {
    throw new Error('Invalid profile identifier.');
  }
}
function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value))
    throw new Error(`Invalid ${label}.`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label} is required.`);
  return result;
}
function folder(value: unknown): string {
  const result = text(value, 'work folder', 1000);
  if (result && !path.win32.isAbsolute(result)) throw new Error('Choose a full work folder path.');
  return result;
}
export function validateInput(input: unknown): Required<ProfileInput> {
  if (!isRecord(input)) throw new Error('Invalid profile.');
  const color = input.color ?? 'teal';
  if (!colors.includes(color as Color)) throw new Error('Invalid profile color.');
  const pet = input.pet ?? '';
  if (pet !== '' && !speciesNames.includes(pet as string)) throw new Error('Invalid pet.');
  const openAtStartup = input.openAtStartup ?? false;
  if (typeof openAtStartup !== 'boolean') throw new Error('Invalid startup preference.');
  return {
    name: text(input.name, 'Client name', 80, true),
    accountLabel: text(input.accountLabel ?? '', 'account label', 160),
    color: color as Color,
    icon: text(input.icon ?? 'C', 'icon', 8, true),
    pet: pet as string,
    hotkey: normalizeAccelerator(input.hotkey ?? ''),
    workFolder: folder(input.workFolder ?? ''),
    openAtStartup,
  };
}
export function newProfile(input: unknown): Profile {
  return { ...validateInput(input), id: randomUUID(), archived: false, createdAt: new Date().toISOString() };
}
/** Accepts schema 1 (0.0.1 preview) and 2; always returns schema 2. */
export function validateState(input: unknown): ProfileState {
  if (
    !isRecord(input) ||
    (input.schemaVersion !== 1 && input.schemaVersion !== 2) ||
    !Array.isArray(input.profiles)
  )
    throw new Error('Unsupported or damaged profile file. It may come from a newer Hatstand version.');
  if (input.profiles.length > 1000) throw new Error('Profile file is too large.');
  const seen = new Set<string>();
  const hotkeys = new Set<string>();
  const profiles = input.profiles.map((value: unknown, index): Profile => {
    if (!isRecord(value)) throw new Error('Invalid saved profile.');
    assertId(value.id);
    if (seen.has(value.id)) throw new Error('Duplicate profile identifiers.');
    seen.add(value.id);
    if (
      typeof value.archived !== 'boolean' ||
      typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt))
    )
      throw new Error('Invalid profile metadata.');
    const profile = {
      // Profiles saved before pets existed get one each, in order.
      ...validateInput({ pet: speciesNames[index % speciesNames.length], ...value }),
      id: value.id,
      archived: value.archived,
      createdAt: value.createdAt,
    };
    if (profile.hotkey) {
      const key = acceleratorKey(profile.hotkey);
      if (hotkeys.has(key))
        throw new Error(`The shortcut ${profile.hotkey} is already used by another profile.`);
      hotkeys.add(key);
    }
    return profile;
  });
  return { schemaVersion, profiles };
}

// Explicit field selection: no paths, shortcuts, arbitrary commands, credentials, or sessions.
export function exportMetadata(state: ProfileState): string {
  return JSON.stringify(
    {
      format: 'hatstand-profile-metadata',
      version: 1,
      profiles: state.profiles.map((p) => ({
        name: p.name,
        accountLabel: p.accountLabel,
        color: p.color,
        icon: p.icon,
        pet: p.pet,
      })),
    },
    null,
    2,
  );
}
export function parseImport(source: string): Required<ProfileInput>[] {
  if (Buffer.byteLength(source) > 1_000_000) throw new Error('Import is too large.');
  const data: unknown = JSON.parse(source);
  if (
    !isRecord(data) ||
    // 0.0.1 exports were made under the app's earlier name, ClientDeck.
    !['hatstand-profile-metadata', 'clientdeck-profile-metadata'].includes(String(data.format)) ||
    data.version !== 1 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > 1000
  )
    throw new Error('Unsupported import format.');
  return data.profiles.map((profile) => {
    if (
      !isRecord(profile) ||
      Object.keys(profile).some((key) => !['name', 'accountLabel', 'color', 'icon', 'pet'].includes(key))
    )
      throw new Error('Import contains unsupported fields.');
    return validateInput(profile);
  });
}

/** Resolves a `--profile=` argument by identifier, or by an unambiguous active profile name. */
export function findProfileByArgument(profiles: Profile[], value: string): Profile {
  const argument = value.trim();
  if (!argument || argument.length > 80) throw new Error('Invalid --profile argument.');
  const byId = profiles.find((p) => p.id === argument.toLowerCase());
  if (byId) return byId;
  const matches = profiles.filter((p) => !p.archived && p.name.toLowerCase() === argument.toLowerCase());
  if (matches.length === 1) return matches[0];
  throw new Error(
    matches.length ? `More than one profile is named ${argument}.` : `No profile is named ${argument}.`,
  );
}
