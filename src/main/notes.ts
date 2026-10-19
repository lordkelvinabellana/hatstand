import { BrowserWindow, dialog, type IpcMainInvokeEvent, nativeTheme, shell } from 'electron';
import { type FSWatcher, watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { backlinks, buildIndex, noteName } from '../core/links.ts';
import {
  createFolder,
  createNote,
  listVault,
  moveEntry,
  readAll,
  readNote,
  relinkVault,
  saveNote,
  trashEntry,
} from '../core/notes.ts';
import { isRecord } from '../core/profiles.ts';

/** What a notes window needs about its profile; throws when the profile has no vault Hatstand may open. */
export type VaultLookup = (id: string) => Promise<{ folder: string; name: string; color: string }>;

interface Entry {
  window: BrowserWindow;
  folder: string;
  watcher?: FSWatcher;
  timer?: NodeJS.Timeout;
}

const html = () => path.join(__dirname, 'notes.html');
const text = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 5_000_000) throw new Error('Invalid request.');
  return value;
};

/**
 * One notes window per profile. Each window is bound to its profile when created: its requests never
 * name a profile or a vault, so a window can only ever reach its own profile's notes.
 */
export class NotesWindows {
  private entries = new Map<string, Entry>();
  constructor(private vaultFor: VaultLookup) {}

  async open(id: string) {
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.focus();
      return;
    }
    const { folder, name } = await this.vaultFor(id);
    const window = new BrowserWindow({
      width: 1180,
      height: 800,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: `${name} — Notes`,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c2320' : '#f7f7f2',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const entry: Entry = { window, folder };
    this.entries.set(id, entry);
    window.webContents.setWindowOpenHandler(({ url }) => {
      // Web links in notes open in the default browser; nothing opens inside Hatstand.
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('page-title-updated', (event) => event.preventDefault());
    window.on('closed', () => {
      this.unwatch(entry);
      this.entries.delete(id);
    });
    window.once('ready-to-show', () => window.show());
    this.watch(entry);
    await window.loadFile(html());
  }

  /** After profile changes: follow a vault that moved, close windows of profiles that are gone or turned off. */
  async sync() {
    for (const [id, entry] of this.entries) {
      const vault = await this.vaultFor(id).catch(() => null);
      if (!vault) entry.window.close();
      else if (vault.folder !== entry.folder) {
        this.unwatch(entry);
        entry.folder = vault.folder;
        this.watch(entry);
        entry.window.webContents.send('notes:changed');
      }
    }
  }

  private watch(entry: Entry) {
    try {
      entry.watcher = watch(entry.folder, { recursive: true }, (_event, file) => {
        const rel = String(file ?? '');
        if (rel.split(/[\\/]/).some((p) => p.startsWith('.')) || rel.endsWith('-tmp')) return;
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => entry.window.webContents.send('notes:changed'), 250);
      });
      entry.watcher.on('error', () => this.unwatch(entry));
    } catch {
      // A vault that can't be watched still works; it just won't refresh on its own.
    }
  }
  private unwatch(entry: Entry) {
    clearTimeout(entry.timer);
    entry.watcher?.close();
    entry.watcher = undefined;
  }

  /** The `notes:request` IPC handler. */
  async handle(event: IpcMainInvokeEvent, request: unknown) {
    const found = [...this.entries].find(([, e]) => e.window.webContents === event.sender);
    if (
      !found ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.url !== pathToFileURL(html()).href
    )
      return { ok: false, error: 'Request rejected.' };
    try {
      if (!isRecord(request) || typeof request.action !== 'string') throw new Error('Unknown request.');
      const [id, entry] = found;
      // Looked up per request, so a vault switched in Hatstand meanwhile is followed, never a stale one.
      const vault = await this.vaultFor(id);
      entry.folder = vault.folder;
      const payload = isRecord(request.payload) ? request.payload : {};
      return { ok: true, value: await this.run(entry.window, vault, request.action, payload) };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'The operation failed. Try again.' };
    }
  }

  private async run(
    window: BrowserWindow,
    vault: Awaited<ReturnType<VaultLookup>>,
    action: string,
    payload: Record<string, unknown>,
  ) {
    const { folder } = vault;
    switch (action) {
      case 'info':
        return { name: vault.name, color: vault.color, platform: process.platform };
      case 'load': {
        await fs.mkdir(folder, { recursive: true });
        return { folders: (await listVault(folder)).folders, notes: await readAll(folder) };
      }
      case 'read':
        return readNote(folder, payload.path);
      case 'save':
        return saveNote(
          folder,
          payload.path,
          text(payload.text),
          payload.base === null ? null : text(payload.base),
        );
      case 'create':
        return createNote(folder, payload.path, payload.text === undefined ? '' : text(payload.text));
      case 'createFolder':
        return createFolder(folder, payload.path);
      case 'move':
        return this.move(window, folder, payload.from, payload.to);
      case 'trash': {
        const answer = await dialog.showMessageBox(window, {
          type: 'question',
          buttons: ['Cancel', `Move to ${process.platform === 'darwin' ? 'Trash' : 'Recycle Bin'}`],
          defaultId: 1,
          cancelId: 0,
          message: `Move “${String(payload.path).replace(/^.*\//, '')}” to the ${
            process.platform === 'darwin' ? 'Trash' : 'Recycle Bin'
          }?`,
          detail: 'You can restore it from there.',
        });
        if (answer.response !== 1) return false;
        await trashEntry(folder, payload.path, (file) => shell.trashItem(file));
        return true;
      }
      default:
        throw new Error('Unknown request.');
    }
  }

  /** Renames or moves; a note whose name changes can take its incoming links along. */
  private async move(window: BrowserWindow, folder: string, from: unknown, to: unknown) {
    const renamed =
      typeof from === 'string' &&
      typeof to === 'string' &&
      /\.md$/i.test(from) &&
      noteName(from) !== noteName(to);
    let relink = false;
    if (renamed) {
      const linking = backlinks(buildIndex(await readAll(folder)), from).length;
      if (linking) {
        const answer = await dialog.showMessageBox(window, {
          type: 'question',
          buttons: ['Don’t update', 'Update links'],
          defaultId: 1,
          cancelId: 0,
          message: `Update links in ${linking} note${linking === 1 ? '' : 's'}?`,
          detail: `[[${noteName(from)}]] becomes [[${noteName(to)}]].`,
        });
        relink = answer.response === 1;
      }
    }
    await moveEntry(folder, from, to);
    if (relink) await relinkVault(folder, noteName(from as string), noteName(to as string));
    return to;
  }
}
