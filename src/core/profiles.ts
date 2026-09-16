import { randomUUID } from 'node:crypto';

export const colors = ['teal', 'amber', 'violet', 'blue', 'rose', 'slate'] as const;
export type Color = (typeof colors)[number];
export interface Profile {
  id: string;
  name: string;
  accountLabel: string;
  color: Color;
  icon: string;
  archived: boolean;
  createdAt: string;
}
export interface ProfileInput {
  name: string;
  accountLabel?: string;
  color?: Color;
  icon?: string;
}
export interface ProfileState {
  schemaVersion: 1;
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
export function validateInput(input: unknown): Required<ProfileInput> {
  if (!isRecord(input)) throw new Error('Invalid profile.');
  const color = input.color ?? 'teal';
  if (!colors.includes(color as Color)) throw new Error('Invalid profile color.');
  return {
    name: text(input.name, 'Client name', 80, true),
    accountLabel: text(input.accountLabel ?? '', 'account label', 160),
    color: color as Color,
    icon: text(input.icon ?? 'C', 'icon', 8, true),
  };
}
export function newProfile(input: unknown): Profile {
  return { ...validateInput(input), id: randomUUID(), archived: false, createdAt: new Date().toISOString() };
}
export function validateState(input: unknown): ProfileState {
  if (!isRecord(input) || input.schemaVersion !== 1 || !Array.isArray(input.profiles))
    throw new Error('Unsupported or damaged profile file.');
  if (input.profiles.length > 1000) throw new Error('Profile file is too large.');
  const seen = new Set<string>();
  const profiles = input.profiles.map((value: unknown): Profile => {
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
    return { ...validateInput(value), id: value.id, archived: value.archived, createdAt: value.createdAt };
  });
  return { schemaVersion: 1, profiles };
}

// Explicit field selection: no paths, arbitrary commands, credentials, or sessions.
export function exportMetadata(state: ProfileState): string {
  return JSON.stringify(
    {
      format: 'clientdeck-profile-metadata',
      version: 1,
      profiles: state.profiles.map((p) => ({
        name: p.name,
        accountLabel: p.accountLabel,
        color: p.color,
        icon: p.icon,
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
    data.format !== 'clientdeck-profile-metadata' ||
    data.version !== 1 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > 1000
  )
    throw new Error('Unsupported import format.');
  return data.profiles.map((profile) => {
    if (
      !isRecord(profile) ||
      Object.keys(profile).some((key) => !['name', 'accountLabel', 'color', 'icon'].includes(key))
    )
      throw new Error('Import contains unsupported fields.');
    return validateInput(profile);
  });
}
