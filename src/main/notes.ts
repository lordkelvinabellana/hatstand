import { type BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent, shell } from 'electron';
import { type FSWatcher, watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { askPrompt } from '../core/ask.ts';
import { deepGraphPrompt } from '../core/inferred.ts';
import { frontmatter } from '../core/brain.ts';
import { backlinks, buildIndex, noteName } from '../core/links.ts';
import {
  createFolder,
  createNote,
  listVault,
  moveEntry,
  readAll,
  readInferred,
  readNote,
  relinkVault,
  saveNote,
  trashEntry,
} from '../core/notes.ts';
import { isRecord } from '../core/profiles.ts';

/** What the notes page needs about a profile's vault; throws when the profile has no vault Hatstand may open. */
export type VaultLookup = (id: string) => Promise<{ folder: string; name: string; color: string }>;

/** Hands work to the profile's own Claude Desktop. 'launched' means only the app could be opened. */
export interface ClaudeActions {
  openSession(id: string, cliSession: string): Promise<'opened' | 'launched' | 'missing'>;
  ask(id: string, folder: string, question: string): Promise<'opened' | 'launched'>;
  /** Starts a Code session in the vault that writes the deep-graph links file. */
  deepGraph(id: string, folder: string): Promise<'opened' | 'launched'>;
}

const text = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 5_000_000) throw new Error('Invalid request.');
  return value;
};

/**
 * Notes for the Second brain page inside Hatstand's own window. Every request names a profile and is
 * answered from that profile's current vault only, looked up fresh each time; requests from anything but
 * the main window's own page are rejected. Each vault is watched so the page refreshes when Claude writes.
 */
export class NotesService {
  private watchers = new Map<string, { watcher: FSWatcher; timer?: NodeJS.Timeout }>();
  constructor(
    private vaultFor: VaultLookup,
    private claude: ClaudeActions,
    private window: () => BrowserWindow | undefined,
    private page: string,
  ) {}

  /** Watches exactly these vault folders (all profiles with a second brain). */
  sync(folders: string[]) {
    const wanted = new Set(folders);
    for (const [folder, entry] of this.watchers)
      if (!wanted.has(folder)) {
        clearTimeout(entry.timer);
        entry.watcher.close();
        this.watchers.delete(folder);
      }
    for (const folder of wanted) if (!this.watchers.has(folder)) this.watch(folder);
    this.window()?.webContents.send('notes:changed');
  }

  private watch(folder: string) {
    try {
      const entry: { watcher: FSWatcher; timer?: NodeJS.Timeout } = {
        watcher: watch(folder, { recursive: true }, (_event, file) => {
          const rel = String(file ?? '');
          const deep = rel.replaceAll('\\', '/') === '.hatstand/inferred-links.json';
          if ((!deep && rel.split(/[\\/]/).some((p) => p.startsWith('.'))) || rel.endsWith('-tmp')) return;
          clearTimeout(entry.timer);
          entry.timer = setTimeout(() => this.window()?.webContents.send('notes:changed'), 250);
        }),
      };
      entry.watcher.on('error', () => {
        entry.watcher.close();
        this.watchers.delete(folder);
      });
      this.watchers.set(folder, entry);
    } catch {
      // A vault that can't be watched (not created yet) still works; it just won't refresh on its own.
    }
  }

  dispose() {
    this.sync([]);
  }

  /** The `notes:request` IPC handler. */
  async handle(event: IpcMainInvokeEvent, request: unknown) {
    const window = this.window();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame?.url !== pathToFileURL(this.page).href
    )
      return { ok: false, error: 'Request rejected.' };
    try {
      if (!isRecord(request) || typeof request.action !== 'string' || typeof request.profile !== 'string')
        throw new Error('Unknown request.');
      const vault = await this.vaultFor(request.profile);
      const payload = isRecord(request.payload) ? request.payload : {};
      return { ok: true, value: await this.run(request.profile, window, vault, request.action, payload) };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'The operation failed. Try again.' };
    }
  }

  private async run(
    id: string,
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
        return {
          folders: (await listVault(folder)).folders,
          notes: await readAll(folder),
          inferred: await readInferred(folder),
        };
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
      case 'openSession': {
        // The session id comes from the note on disk, not from the window.
        const session = frontmatter(await readNote(folder, payload.path)).session ?? '';
        return this.claude.openSession(id, session);
      }
      case 'ask': {
        const question = text(payload.question);
        askPrompt(question); // validates before anything opens
        const result = await this.claude.ask(id, folder, question);
        // Where the link can't be delivered, the question waits on the clipboard.
        if (result === 'launched') clipboard.writeText(askPrompt(question));
        return result;
      }
      case 'deepGraph': {
        const today = new Date().toISOString().slice(0, 10);
        const result = await this.claude.deepGraph(id, folder);
        if (result === 'launched') clipboard.writeText(deepGraphPrompt(today));
        return result;
      }
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
