// IPC request handlers. Every payload arrives from the renderer and is validated here.
import { app, dialog, nativeTheme, net, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import { acceleratorKey } from '../core/accelerator.ts';
import { checksFor, isTestedVersion } from '../core/compat.ts';
import type { Controller } from '../core/controller.ts';
import { assertId, exportMetadata, isRecord, parseImport, validateInput } from '../core/profiles.ts';
import type { ProfileInput } from '../core/profiles.ts';
import { isNewerVersion, issuesUrl, parseLatestRelease, releasesUrl, repository } from '../core/project.ts';
import { saveSettings, validateSettings } from '../core/settings.ts';
import { listProfileFolders, resolveRemovableFolder } from '../core/storage.ts';
import type { ProfileStore } from '../core/store.ts';
import { platformFor } from '../core/platform.ts';
const { detectInstallation } = platformFor(process.platform);
const mac = process.platform === 'darwin';
const trash = mac ? 'Trash' : 'Recycle Bin';
import type { Snapshot, UpdateCheck } from '../shared.ts';
import { applyLoginItem, createDesktopShortcut } from './integration.ts';

export interface HandlerContext {
  root: string;
  store: ProfileStore;
  controller: Controller;
  window(): BrowserWindow;
  hotkeyErrors(): { managerError: string; profileErrors: Map<string, string> };
  /** Re-registers shortcuts and refreshes tray, jump list and renderer. */
  profilesChanged(): Promise<void>;
  notify(): void;
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

  async function snapshot(): Promise<Snapshot> {
    const state = await store.load();
    const hotkeys = context.hotkeyErrors();
    return {
      platform: mac ? 'darwin' : 'win32',
      profiles: state.profiles.map((p) => {
        const directories = controller.directories(p.id);
        return {
          ...p,
          ...controller.status(p.id),
          directory: directories.base,
          bound: directories.bound,
          hotkeyError: hotkeys.profileErrors.get(p.id),
        };
      }),
      settings: controller.settings,
      installation: controller.installation,
      installationTested: isTestedVersion(controller.installation?.version),
      installationError: controller.installationError,
      processError: controller.processError,
      hotkeyError: hotkeys.managerError,
      version: app.getVersion(),
      packaged: app.isPackaged,
      dataFolder: root,
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
      const allowed = ['https://claude.com/download', `${releasesUrl}`, issuesUrl];
      const url = payload.url;
      if (!allowed.some((prefix) => url === prefix || url.startsWith(`${prefix}/`)))
        throw new Error('That link is not allowed.');
      await shell.openExternal(url);
    },
  };
}
