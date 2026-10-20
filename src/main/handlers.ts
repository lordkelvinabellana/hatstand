// IPC request handlers. Every payload arrives from the renderer and is validated here.
import { app, dialog, nativeTheme, net, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acceleratorKey } from '../core/accelerator.ts';
import { checksFor, isTestedVersion } from '../core/compat.ts';
import type { Controller } from '../core/controller.ts';
import { assertId, exportMetadata, isRecord, parseImport, validateInput } from '../core/profiles.ts';
import type { ProfileInput } from '../core/profiles.ts';
import {
  isNewerVersion,
  issuesUrl,
  parseLatestRelease,
  releasesUrl,
  repository,
  syncGuideUrl,
} from '../core/project.ts';
import { saveSettings, validateSettings } from '../core/settings.ts';
import { listProfileFolders, resolveRemovableFolder } from '../core/storage.ts';
import type { ProfileStore } from '../core/store.ts';
import { platformFor } from '../core/platform.ts';
const { detectInstallation } = platformFor(process.platform);
const mac = process.platform === 'darwin';
const trash = mac ? 'Trash' : 'Recycle Bin';
import type { Snapshot, UpdateCheck } from '../shared.ts';
import { applyLoginItem, createDesktopShortcut } from './integration.ts';
import type { ProfileSync } from './sync.ts';
import { readAll, readInferred } from '../core/notes.ts';
import type { SessionView } from '../shared.ts';
import { brainStatus, checkVault, saveBrain, sharersOf, vaultLabel } from './brain.ts';
import {
  assertTemplateName,
  copyVault,
  inspectVault,
  readTemplate,
  saveTemplate,
  vaultsOverlap,
} from '../core/vault.ts';

export interface HandlerContext {
  root: string;
  store: ProfileStore;
  controller: Controller;
  window(): BrowserWindow;
  hotkeyErrors(): { managerError: string; profileErrors: Map<string, string> };
  /** Re-registers shortcuts and refreshes tray, jump list and renderer. */
  profilesChanged(): Promise<void>;
  notify(): void;
  sync: ProfileSync;
  /** Running Claude Code sessions of a profile, as its menu-bar pet shows them. */
  sessions(id: string): Promise<SessionView[]>;
  /** Brings up the profile's Claude at a desktop session (local_…), or just the app. */
  openSession(id: string, session?: string): void;
}
type Handler = (payload: unknown) => Promise<unknown>;

function readId(payload: unknown): string {
  if (!isRecord(payload)) throw new Error('Invalid request.');
  assertId(payload.id);
  return payload.id;
}
function readIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.ids) || payload.ids.length > 1000)
    throw new Error('Invalid request.');
  for (const id of payload.ids) assertId(id);
  return [...new Set(payload.ids as string[])];
}

export function createHandlers(context: HandlerContext): Record<string, Handler> {
  const { root, store, controller } = context;
  let pendingImport: ReturnType<typeof parseImport> | null = null;

  async function vaultOf(payload: unknown) {
    const id = readId(payload);
    await controller.getProfile(id);
    const status = await brainStatus(root, controller, id);
    if (status.external)
      throw new Error('This profile runs its own capture.py hooks; Hatstand leaves its notes alone.');
    return status.folder;
  }

  /** Points a profile at `vault` ('' = default), offering to copy its notes there. Nothing is deleted. */
  async function switchVault(id: string, vault: string) {
    await vaultOf({ id });
    const folder = await checkVault(root, controller, (await store.load()).profiles, id, vault);
    const status = await brainStatus(root, controller, id);
    if (vaultsOverlap(folder, status.folder) && folder !== status.folder)
      throw new Error('Choose a folder outside this profile’s current vault.');
    if (folder !== status.folder && (await inspectVault(status.folder)).notes) {
      const answer = await dialog.showMessageBox(context.window(), {
        type: 'question',
        buttons: ['Cancel', 'Just switch', 'Copy notes'],
        defaultId: 2,
        cancelId: 0,
        message: 'Copy this profile’s notes to the new folder?',
        detail: `Copying never replaces a file that’s already there. The current folder stays as it is:\n${status.folder}`,
      });
      if (answer.response === 0) return;
      if (answer.response === 2) await copyVault(status.folder, folder);
    }
    await saveBrain(root, id, { enabled: status.enabled, vault });
    await context.profilesChanged();
  }

  async function snapshot(): Promise<Snapshot> {
    const state = await store.load();
    const hotkeys = context.hotkeyErrors();
    return {
      platform: mac ? 'darwin' : 'win32',
      profiles: await Promise.all(
        state.profiles.map(async (p) => {
          const directories = controller.directories(p.id);
          return {
            ...p,
            ...controller.status(p.id),
            directory: directories.base,
            bound: directories.bound,
            hotkeyError: hotkeys.profileErrors.get(p.id),
            brain: {
              ...(await brainStatus(root, controller, p.id)),
              sharedWith: await sharersOf(
                root,
                controller,
                state.profiles,
                p.id,
                (await brainStatus(root, controller, p.id)).folder,
              ),
            },
          };
        }),
      ),
      settings: controller.settings,
      installation: controller.installation,
      installationTested: isTestedVersion(controller.installation?.version),
      installationConfirmed: controller.settings.confirmedVersions.includes(
        controller.installation?.version ?? '',
      ),
      installationError: controller.installationError,
      processError: controller.processError,
      hotkeyError: hotkeys.managerError,
      version: app.getVersion(),
      packaged: app.isPackaged,
      dataFolder: root,
      sync: { ...context.sync.status },
    };
  }

  // A profile shortcut may not collide with the manager shortcut; duplicates between
  // profiles are rejected by the store's validation.
  function checkProfileHotkey(input: unknown) {
    const values = validateInput(input);
    if (
      values.hotkey &&
      controller.settings.hotkey &&
      acceleratorKey(values.hotkey) === acceleratorKey(controller.settings.hotkey)
    )
      throw new Error('That shortcut already opens Hatstand. Choose another.');
  }

  async function diagnostics() {
    const profiles = (await store.load()).profiles;
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      claudeVersion: controller.installation?.version ?? null,
      claudeVersionTested: isTestedVersion(controller.installation?.version),
      claudeVersionUserConfirmed: controller.settings.confirmedVersions.includes(
        controller.installation?.version ?? '',
      ),
      installType: controller.installation?.kind ?? null,
      profileCount: profiles.length,
      archivedProfileCount: profiles.filter((p) => p.archived).length,
      runningProfileCount: controller.runningCount(profiles),
      attachedFolderCount: profiles.filter((p) => controller.directories(p.id).bound).length,
      statusReadable: !controller.processError,
      compatibility: Object.fromEntries(
        checksFor(process.platform).map((check) => [check.key, check.result]),
      ),
    };
  }

  async function moveToRecycleBin(folder: string) {
    try {
      await shell.trashItem(folder);
    } catch {
      throw new Error(
        `Could not move ${folder} to the ${trash}. Nothing was deleted. Close any program using it, or remove it manually.`,
      );
    }
  }

  return {
    snapshot,
    async refresh() {
      await controller.detect();
      await controller.refresh();
      return snapshot();
    },
    async create(payload) {
      checkProfileHotkey(payload);
      const result = await store.create(payload);
      await context.profilesChanged();
      return result;
    },
    async edit(payload) {
      const id = readId(payload);
      const input = (payload as Record<string, unknown>).input;
      checkProfileHotkey(input);
      await store.update(id, input);
      await context.profilesChanged();
    },
    async archive(payload) {
      const id = readId(payload);
      const value = (payload as Record<string, unknown>).archived;
      if (typeof value !== 'boolean') throw new Error('Invalid archive request.');
      await store.archive(id, value);
      await context.profilesChanged();
    },
    async reorder(payload) {
      await store.reorder(readIds(payload));
      await context.profilesChanged();
    },
    async remove(payload) {
      const id = readId(payload);
      const profile = await controller.getProfile(id);
      const directories = controller.directories(id);
      const result = await dialog.showMessageBox(context.window(), {
        type: 'question',
        buttons: ['Cancel', 'Remove profile'],
        defaultId: 0,
        cancelId: 0,
        message: `Remove ${profile.name} from Hatstand?`,
        detail: directories.bound
          ? `Its attached folder stays in place:\n${directories.base}\n\nThis does not delete the Claude account or cloud conversations.`
          : `By default its Claude data stays on this computer. This does not delete the Claude account or cloud conversations.\n\n${directories.base}`,
        checkboxLabel: directories.bound
          ? undefined
          : `Also move this profile’s local Claude data to the ${trash}`,
      });
      if (result.response !== 1) return;
      if (result.checkboxChecked && !directories.bound) {
        await controller.refresh();
        if (controller.owned(id) || controller.usesDirectory(directories.desktop))
          throw new Error('Close this profile’s Claude window first. Nothing was removed.');
        let folder: string | null = null;
        try {
          folder = await resolveRemovableFolder(root, id);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (folder) await moveToRecycleBin(folder);
      }
      await store.remove(id);
      await context.sync.markDeleted(id);
      await context.profilesChanged();
    },
    async launch(payload) {
      await controller.launch(readId(payload));
    },
    async launchMany(payload) {
      const ids = readIds(payload);
      const failures = await controller.launchMany(ids);
      if (failures.length) {
        const names = new Map((await store.load()).profiles.map((p) => [p.id, p.name]));
        throw new Error(
          failures.map((failure) => `${names.get(failure.id) ?? 'Profile'}: ${failure.message}`).join(' '),
        );
      }
    },
    async close(payload) {
      await controller.close(readId(payload));
    },
    async forceClose(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      const answer = await dialog.showMessageBox(context.window(), {
        type: 'warning',
        buttons: ['Cancel', 'Force close'],
        defaultId: 0,
        cancelId: 0,
        message: 'Force close this client’s Claude instance?',
        detail: 'An active task may be interrupted. This targets only the selected profile’s Claude process.',
      });
      if (answer.response === 1) await controller.close(id, true);
    },
    async restart(payload) {
      await controller.restart(readId(payload));
    },
    async closeAll() {
      const answer = await dialog.showMessageBox(context.window(), {
        type: 'question',
        buttons: ['Cancel', 'Close all'],
        defaultId: 0,
        cancelId: 0,
        message: 'Close every Claude profile opened by Hatstand?',
        detail:
          'Each Claude window is asked to close normally. Your default Claude instance is not affected.',
      });
      if (answer.response !== 1) return;
      const failures = await controller.closeAll();
      if (failures.length)
        throw new Error(
          `${failures.length} profile${failures.length === 1 ? '' : 's'} stayed open, possibly in Claude’s tray. Quit those Claude instances and try again.`,
        );
    },
    async openFolder(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      const directories = controller.directories(id);
      await fs.mkdir(directories.base, { recursive: true });
      const error = await shell.openPath(directories.base);
      if (error) throw new Error(error);
    },
    async openWorkFolder(payload) {
      const profile = await controller.getProfile(readId(payload));
      if (!profile.workFolder)
        throw new Error('This profile has no work folder yet. Add one in its details.');
      const error = await shell.openPath(profile.workFolder);
      if (error) throw new Error(`Could not open ${profile.workFolder}: ${error}`);
    },
    async brain(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      if (typeof (payload as { enabled?: unknown }).enabled !== 'boolean')
        throw new Error('Invalid request.');
      const enabled = (payload as { enabled: boolean }).enabled;
      const status = await brainStatus(root, controller, id);
      if (enabled && status.external)
        throw new Error(
          'This profile already runs its own capture.py hooks. Remove them from its Claude Code settings.json first.',
        );
      await saveBrain(root, id, { enabled, vault: status.vault });
      await context.profilesChanged();
    },
    async newVault(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      const result = await dialog.showOpenDialog(context.window(), {
        title: 'Choose or create an empty folder for a new vault',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled) return;
      await vaultOf({ id });
      await checkVault(root, controller, (await store.load()).profiles, id, result.filePaths[0]);
      if ((await inspectVault(result.filePaths[0])).used)
        throw new Error('That folder isn’t empty. To use the notes in it, choose “Use existing folder…”.');
      await switchVault(id, result.filePaths[0]);
    },
    async adoptVault(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      const result = await dialog.showOpenDialog(context.window(), {
        title: 'Choose an existing notes folder',
        properties: ['openDirectory'],
      });
      if (result.canceled) return;
      const folder = result.filePaths[0];
      await vaultOf({ id });
      await checkVault(root, controller, (await store.load()).profiles, id, folder);
      const info = await inspectVault(folder);
      if (info.notes || info.obsidian) {
        const answer = await dialog.showMessageBox(context.window(), {
          type: 'question',
          buttons: ['Cancel', 'Use this vault'],
          defaultId: 1,
          cancelId: 0,
          message: `Use this ${info.obsidian ? 'Obsidian vault' : 'folder'} for this profile’s notes?`,
          detail: `Found ${info.notes} note${info.notes === 1 ? '' : 's'}. Existing notes are not changed. ${
            info.adds.length
              ? `When the second brain is on, Hatstand adds only what’s missing:\n${info.adds.join('\n')}`
              : 'Nothing needs adding.'
          }`,
        });
        if (answer.response !== 1) return;
      }
      await switchVault(id, folder);
    },
    async resetVault(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      await switchVault(id, '');
    },
    async template(payload) {
      const { name } = payload as { name?: unknown };
      assertTemplateName(name);
      return readTemplate(await vaultOf(payload), name);
    },
    async saveTemplate(payload) {
      const { name, text } = payload as { name?: unknown; text?: unknown };
      assertTemplateName(name);
      if (typeof text !== 'string') throw new Error('Invalid request.');
      await saveTemplate(await vaultOf(payload), name, text);
    },
    async resetTemplate(payload) {
      const { name } = payload as { name?: unknown };
      assertTemplateName(name);
      const vault = await vaultOf(payload);
      const answer = await dialog.showMessageBox(context.window(), {
        type: 'question',
        buttons: ['Cancel', 'Restore default'],
        defaultId: 0,
        cancelId: 0,
        message: `Restore the default ${name} template?`,
        detail: 'Your changes to this template are replaced. Notes made from it are not changed.',
      });
      if (answer.response !== 1) return false;
      await saveTemplate(vault, name, null);
      return true;
    },
    async openVault(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      const { folder } = await brainStatus(root, controller, id);
      await fs.mkdir(folder, { recursive: true });
      const error = await shell.openPath(folder);
      if (error) throw new Error(error);
    },
    /** Every vault with its notes, for the all-vaults graph. Shared vaults appear once. */
    async vaults() {
      const profiles = (await store.load()).profiles.filter((p) => !p.archived);
      const vaults = new Map<string, { folder: string; name: string; color: string; profiles: string[] }>();
      for (const p of profiles) {
        const status = await brainStatus(root, controller, p.id);
        if (!status.enabled || status.external) continue;
        const entry = vaults.get(status.folder);
        if (entry) entry.profiles.push(p.id);
        else
          vaults.set(status.folder, {
            folder: status.folder,
            name: await vaultLabel(root, controller, profiles, status.folder),
            color: p.color,
            profiles: [p.id],
          });
      }
      return Promise.all(
        [...vaults.values()].map(async (v) => ({
          ...v,
          notes: await readAll(v.folder).catch(() => []),
          inferred: await readInferred(v.folder),
        })),
      );
    },
    /** Lets other profiles write to this profile's vault. A default vault first moves to its own folder. */
    async shareVault(payload) {
      const id = readId(payload);
      const ids = readIds({ ids: (payload as { with?: unknown }).with });
      const profiles = (await store.load()).profiles;
      const owner = await controller.getProfile(id);
      const status = await brainStatus(root, controller, id);
      if (!status.enabled || status.external) throw new Error('Turn on this profile’s second brain first.');
      let folder = status.folder;
      if (!status.vault) {
        // The default vault lives inside the profile's own data, which other profiles must never point into.
        folder = path.join(root, 'vaults', owner.name.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || id);
        for (let n = 2; (await inspectVault(folder)).used; n++)
          folder = `${folder.replace(/ \d+$/, '')} ${n}`;
        await checkVault(root, controller, profiles, id, folder);
        await copyVault(status.folder, folder);
        await saveBrain(root, id, { enabled: true, vault: folder });
      }
      for (const other of ids) {
        if (other === id) continue;
        const theirs = await brainStatus(root, controller, other);
        if (theirs.external)
          throw new Error('A profile that runs its own capture.py hooks can’t join a vault.');
        await checkVault(root, controller, profiles, other, folder, true);
        if (
          path.resolve(theirs.folder) !== path.resolve(folder) &&
          (await inspectVault(theirs.folder)).notes
        ) {
          const name = (await controller.getProfile(other)).name;
          const answer = await dialog.showMessageBox(context.window(), {
            type: 'question',
            buttons: ['Cancel', 'Just share', 'Copy their notes in'],
            defaultId: 2,
            cancelId: 0,
            message: `Copy ${name}’s notes into the shared vault?`,
            detail: `Copying never replaces a file that’s already there. ${name}’s own vault stays as it is:\n${theirs.folder}`,
          });
          if (answer.response === 0) break;
          if (answer.response === 2) await copyVault(theirs.folder, folder);
        }
        await saveBrain(root, other, { enabled: true, vault: folder });
      }
      await context.profilesChanged();
    },
    /** The profile leaves a shared vault for its own default one. Nothing is moved or deleted. */
    async leaveVault(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      const status = await brainStatus(root, controller, id);
      await saveBrain(root, id, { enabled: status.enabled, vault: '' });
      await context.profilesChanged();
    },
    async sessions(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      return context.sessions(id);
    },
    async openSession(payload) {
      const id = readId(payload);
      await controller.getProfile(id);
      const session = (payload as { session?: unknown }).session;
      if (session !== undefined && (typeof session !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(session)))
        throw new Error('Invalid request.');
      context.openSession(id, session);
    },
    async pickWorkFolder() {
      const result = await dialog.showOpenDialog(context.window(), {
        title: 'Choose the client’s work folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    },
    async shortcut(payload) {
      createDesktopShortcut(await controller.getProfile(readId(payload)));
    },
    async pickExecutable() {
      const result = await dialog.showOpenDialog(context.window(), {
        title: 'Choose installed Claude Desktop',
        properties: ['openFile'],
        filters: [
          { name: mac ? 'Claude application' : 'Claude executable', extensions: [mac ? 'app' : 'exe'] },
        ],
      });
      if (result.canceled) return null;
      await detectInstallation(result.filePaths[0]);
      return result.filePaths[0];
    },
    async syncSendCode() {
      await context.sync.sendCode();
    },
    async syncVerify(payload) {
      if (!isRecord(payload) || typeof payload.code !== 'string')
        throw new Error('Enter the code from the email.');
      await context.sync.verify(payload.code);
    },
    async syncNow() {
      await context.sync.syncNow();
    },
    async syncSignOut() {
      await context.sync.signOut();
    },
    async settings(payload) {
      const next = validateSettings(payload);
      if (next.executable) await detectInstallation(next.executable);
      if (next.startWithWindows && !app.isPackaged)
        throw new Error('Start at login is available in the installed app.');
      if (next.hotkey) {
        const key = acceleratorKey(next.hotkey);
        const clash = (await store.load()).profiles.find((p) => p.hotkey && acceleratorKey(p.hotkey) === key);
        if (clash) throw new Error(`That shortcut already opens ${clash.name}. Choose another.`);
      }
      await saveSettings(root, next);
      controller.settings = next;
      nativeTheme.themeSource = next.theme;
      applyLoginItem(next.startWithWindows);
      await controller.detect();
      await context.profilesChanged();
    },
    /** The user's own verdict on the installed Claude version: working (no more warning) or not. */
    async confirmVersion(payload) {
      const works = (payload as { works?: unknown })?.works;
      const version = controller.installation?.version;
      if (typeof works !== 'boolean' || !version) throw new Error('Invalid request.');
      const others = controller.settings.confirmedVersions.filter((v) => v !== version);
      const next = {
        ...controller.settings,
        confirmedVersions: works ? [...others, version].slice(-50) : others,
      };
      await saveSettings(root, next);
      controller.settings = next;
      context.notify();
    },
    async completeSetup() {
      const next = { ...controller.settings, setupComplete: true };
      await saveSettings(root, next);
      controller.settings = next;
      context.notify();
    },
    async export() {
      const result = await dialog.showSaveDialog(context.window(), {
        title: 'Export profile labels and colors',
        defaultPath: 'hatstand-profiles.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return;
      await fs.writeFile(result.filePath, exportMetadata(await store.load()), { mode: 0o600 });
    },
    async chooseImport() {
      pendingImport = null;
      const result = await dialog.showOpenDialog(context.window(), {
        title: 'Import profile labels and colors',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled) return null;
      if ((await fs.stat(result.filePaths[0])).size > 1_000_000) throw new Error('Import is too large.');
      pendingImport = parseImport(await fs.readFile(result.filePaths[0], 'utf8'));
      return pendingImport satisfies ProfileInput[];
    },
    async confirmImport() {
      if (!pendingImport) throw new Error('Choose a file first.');
      const inputs = pendingImport;
      pendingImport = null;
      await store.importProfiles(inputs);
      await context.profilesChanged();
    },
    diagnostics,
    async exportDiagnostics() {
      const result = await dialog.showSaveDialog(context.window(), {
        title: 'Save the displayed diagnostic summary',
        defaultPath: 'hatstand-diagnostics.json',
      });
      if (!result.canceled && result.filePath)
        await fs.writeFile(result.filePath, JSON.stringify(await diagnostics(), null, 2));
    },
    async storage() {
      const registered = new Set((await store.load()).profiles.map((p) => p.id));
      return listProfileFolders(root, registered);
    },
    async trashFolder(payload) {
      const id = readId(payload);
      if ((await store.load()).profiles.some((p) => p.id === id))
        throw new Error('This folder belongs to a profile. Remove the profile instead.');
      const folder = await resolveRemovableFolder(root, id);
      await controller.refresh();
      if (controller.usesDirectory(controller.directories(id).desktop))
        throw new Error('A Claude window is still using this folder. Close it first.');
      const answer = await dialog.showMessageBox(context.window(), {
        type: 'warning',
        buttons: ['Cancel', `Move to ${trash}`],
        defaultId: 0,
        cancelId: 0,
        message: `Move this leftover Claude data to the ${trash}?`,
        detail: `${folder}\n\nIt may contain a signed-in session. You can restore it from the ${trash} until it is emptied.`,
      });
      if (answer.response !== 1) return false;
      await moveToRecycleBin(folder);
      return true;
    },
    async checkUpdates(): Promise<UpdateCheck> {
      const current = app.getVersion();
      const response = await net.fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Hatstand/${current}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) return { current, latest: null, newer: false };
      if (!response.ok)
        throw new Error(`GitHub could not be reached (HTTP ${response.status}). Try again later.`);
      const latest = parseLatestRelease(await response.json());
      return { current, latest, newer: isNewerVersion(latest.version, current) };
    },
    async openExternal(payload) {
      if (!isRecord(payload) || typeof payload.url !== 'string') throw new Error('Invalid link.');
      const allowed = ['https://claude.com/download', `${releasesUrl}`, issuesUrl, syncGuideUrl];
      const url = payload.url;
      if (!allowed.some((prefix) => url === prefix || url.startsWith(`${prefix}/`)))
        throw new Error('That link is not allowed.');
      await shell.openExternal(url);
    },
  };
}
