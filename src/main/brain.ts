import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Controller } from '../core/controller.ts';
import { assertId, isRecord, type Profile } from '../core/profiles.ts';
import {
  brainBlock,
  captureCommand,
  hasExternalCapture,
  recallEntry,
  seedVault,
  vaultsOverlap,
  withBrainBlock,
  withBrainHooks,
  withRecallServer,
} from '../core/vault.ts';
import { RECALL_SERVER } from '../core/recall.ts';

/** Per-profile second-brain choice. Machine-local (vault paths differ per computer), so never synced. */
export interface BrainChoice {
  enabled: boolean;
  /** '' uses the default `<profile folder>/vault`. */
  vault: string;
}
export interface BrainStatus extends BrainChoice {
  /** The folder notes are written to. */
  folder: string;
  /** The profile already runs its own capture.py hooks; Hatstand leaves it alone. */
  external: boolean;
}

const stateFile = (root: string) => path.join(root, 'second-brain.json');

export async function readBrains(root: string): Promise<Record<string, BrainChoice>> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(stateFile(root), 'utf8'));
    const brains: Record<string, BrainChoice> = {};
    for (const [id, choice] of Object.entries(isRecord(value) ? value : {})) {
      try {
        assertId(id);
      } catch {
        continue;
      }
      if (!isRecord(choice) || typeof choice.enabled !== 'boolean' || typeof choice.vault !== 'string')
        continue;
      if (choice.vault && !path.isAbsolute(choice.vault)) continue;
      brains[id] = { enabled: choice.enabled, vault: choice.vault };
    }
    return brains;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

export async function saveBrain(root: string, id: string, choice: BrainChoice) {
  const brains = await readBrains(root);
  brains[id] = choice;
  const file = stateFile(root);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(brains, null, 2));
  await fs.rename(`${file}.tmp`, file);
}

/** Reads a Claude Code settings.json; null when it exists but cannot be read or parsed. */
async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return isRecord(value) ? value : null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? {} : null;
  }
}
async function replace(file: string, next: string) {
  const current = await fs.readFile(file, 'utf8').catch(() => null);
  if (current === next || (current === null && next === '')) return;
  await fs.writeFile(`${file}.hatstand-tmp`, next);
  await fs.rename(`${file}.hatstand-tmp`, file);
}

export async function brainStatus(root: string, controller: Controller, id: string): Promise<BrainStatus> {
  const choice = (await readBrains(root).catch((): Record<string, BrainChoice> => ({})))[id] ?? {
    enabled: false,
    vault: '',
  };
  const settings = await readJson(path.join(controller.directories(id).code, 'settings.json'));
  return {
    ...choice,
    folder: choice.vault || path.join(controller.directories(id).base, 'vault'),
    external: !!settings && hasExternalCapture(settings),
  };
}

/**
 * Returns the folder a profile's vault would be at for `vault` ('' = default), or throws when it overlaps
 * another profile's vault or Hatstand folder: vaults stay per profile.
 */
export async function checkVault(
  root: string,
  controller: Controller,
  profiles: Profile[],
  id: string,
  vault: string,
  /** Joining a vault other profiles already use on purpose (Share): their vault is allowed, their data never. */
  share = false,
) {
  if (vault && !path.isAbsolute(vault)) throw new Error('Choose a full folder path.');
  const own = controller.directories(id);
  const folder = vault || path.join(own.base, 'vault');
  if ([os.homedir(), path.parse(folder).root].some((f) => path.resolve(f) === path.resolve(folder)))
    throw new Error('Choose a folder for notes, not your whole home folder or drive.');
  if ([own.desktop, own.code].some((f) => vaultsOverlap(folder, f)))
    throw new Error('Choose a folder outside this profile’s Claude data.');
  for (const other of profiles) {
    if (other.id === id) continue;
    const vault = (await brainStatus(root, controller, other.id)).folder;
    const theirs = [controller.directories(other.id).base];
    if (!(share && path.resolve(vault) === path.resolve(folder))) theirs.push(vault);
    if (theirs.some((f) => vaultsOverlap(folder, f)))
      throw new Error(
        `That folder overlaps ${other.name}’s notes or data. Each profile keeps its own vault.`,
      );
  }
  return folder;
}

/** The vault folders of every profile with its second brain on (shared vaults once). */
export async function vaultFolders(root: string, controller: Controller, profiles: Profile[]) {
  const folders = new Set<string>();
  for (const p of profiles) {
    if (p.archived) continue;
    const status = await brainStatus(root, controller, p.id);
    if (status.enabled && !status.external) folders.add(status.folder);
  }
  return [...folders];
}

/** Ids of the other profiles whose second brain writes to `folder`. */
export async function sharersOf(
  root: string,
  controller: Controller,
  profiles: Profile[],
  id: string,
  folder: string,
) {
  const ids: string[] = [];
  for (const p of profiles)
    if (p.id !== id && !p.archived) {
      const status = await brainStatus(root, controller, p.id);
      if (status.enabled && !status.external && path.resolve(status.folder) === path.resolve(folder))
        ids.push(p.id);
    }
  return ids;
}

/** A vault's display name: the profiles that use it, e.g. “Stakra + HnyX”. */
export async function vaultLabel(root: string, controller: Controller, profiles: Profile[], folder: string) {
  const names: string[] = [];
  for (const p of profiles) {
    if (p.archived) continue;
    const status = await brainStatus(root, controller, p.id);
    if (status.enabled && path.resolve(status.folder) === path.resolve(folder)) names.push(p.name);
  }
  return names.join(' + ') || 'Notes';
}

/** Copies a bundled script (the capture hook, the recall server) out of the app bundle to a stable path. */
async function installScript(root: string, name = 'capture.cjs') {
  const script = path.join(root, 'second-brain', name);
  const text = await fs.readFile(path.join(__dirname, name), 'utf8');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await replace(script, text);
  return script;
}

/**
 * Adds or removes each profile's capture hooks and CLAUDE.md block to match its toggle.
 * Profiles with their own capture.py hooks, never-launched profiles and unreadable settings are skipped.
 */
export async function wireBrains(root: string, controller: Controller, profiles: Profile[]) {
  const brains = await readBrains(root);
  // Nothing to install or clean up until a profile has used the toggle.
  if (!Object.keys(brains).length) return;
  const script = await installScript(root);
  const recall = await installScript(root, 'recall.cjs');
  for (const profile of profiles) {
    const choice = brains[profile.id];
    if (!choice) continue;
    const { code } = controller.directories(profile.id);
    if (!(await fs.stat(code).catch(() => undefined))?.isDirectory()) continue;
    const settingsFile = path.join(code, 'settings.json');
    const settings = await readJson(settingsFile);
    if (!settings || hasExternalCapture(settings)) continue;
    const { folder } = await brainStatus(root, controller, profile.id);
    const backupRoot = controller.settings.backupFolder;
    const backup = backupRoot
      ? path.join(
          backupRoot,
          (await vaultLabel(root, controller, profiles, folder)).replace(/[\\/:*?"<>|]/g, '-'),
        )
      : '';
    const command = choice.enabled
      ? captureCommand(process.execPath, script, folder, profile.name, backup)
      : null;
    if (command) await seedVault(folder, new Date().toISOString().slice(0, 10));
    const next = withBrainHooks(settings, command);
    // Unchanged content is not rewritten, so a missing settings.json is not created just to stay empty.
    if (JSON.stringify(next) !== JSON.stringify(settings))
      await replace(settingsFile, `${JSON.stringify(next, null, 2)}\n`);
    const claudeFile = path.join(code, 'CLAUDE.md');
    const claude = await fs.readFile(claudeFile, 'utf8').catch(() => '');
    await replace(claudeFile, withBrainBlock(claude, command && brainBlock(folder, command)));
    // The recall MCP server, for Claude Code (code/.claude.json) and Claude Desktop chats. Only files Claude
    // already created and that parse are touched, and only Hatstand's own entry in them.
    const entry = choice.enabled ? recallEntry(process.execPath, recall, folder) : null;
    for (const file of [
      path.join(code, '.claude.json'),
      path.join(controller.directories(profile.id).desktop, 'claude_desktop_config.json'),
    ]) {
      const config = await readJson(file);
      if (!config || !(await fs.stat(file).catch(() => undefined))) continue;
      const next = withRecallServer(config, RECALL_SERVER, entry);
      if (JSON.stringify(next) !== JSON.stringify(config))
        await replace(file, `${JSON.stringify(next, null, 2)}\n`);
    }
  }
}
