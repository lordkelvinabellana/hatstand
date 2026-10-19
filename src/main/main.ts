import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme } from 'electron';
import type { Tray } from 'electron';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Controller } from '../core/controller.ts';
import { ensurePlainDirectory } from '../core/launch.ts';
import { dataRoot, legacyDataRoot, migrateLegacyData } from '../core/paths.ts';
import { findProfileByArgument, isRecord } from '../core/profiles.ts';
import { readBindings, readSettings } from '../core/settings.ts';
import { ProfileStore } from '../core/store.ts';
import { platformFor } from '../core/platform.ts';
const { closeOwnedProcess, detectInstallation, launchClaude, listClaudeProcesses } = platformFor(
  process.platform,
);
import { createHandlers } from './handlers.ts';
import { applyLoginItem, registerHotkeys, updateJumpList, updateDockMenu } from './integration.ts';
import type { HotkeyResult } from './integration.ts';
import { handleSquirrelEvent } from './squirrel.ts';
import { openClaudeSession } from '../core/macos.ts';
import { wireBrains } from './brain.ts';
import { Pets } from './pets.ts';
import { ProfileSync } from './sync.ts';
import { createTray, type TrayActions, trayMenu, updateTray } from './tray.ts';

const testMode = process.env.HATSTAND_TEST_MODE === '1' && !app.isPackaged;
const localAppData = process.env.LOCALAPPDATA ?? path.join(app.getPath('appData'), '..', 'Local');
const root =
  testMode && process.env.HATSTAND_TEST_ROOT
    ? path.resolve(process.env.HATSTAND_TEST_ROOT)
    : dataRoot(process.platform === 'darwin' ? app.getPath('appData') : localAppData);
app.setPath('userData', path.join(root, 'manager'));
const html = path.join(__dirname, 'index.html');
const store = new ProfileStore(root);
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let pets: Pets | undefined;
let quitting = false;
let hotkeys: HotkeyResult = { managerError: '', profileErrors: new Map() };

async function log(action: string, id?: string) {
  const folder = path.join(root, 'logs');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'manager.log');
  try {
    if ((await fs.stat(file)).size > 500_000) await fs.rename(file, `${file}.previous`);
  } catch {}
  // Profile identifiers and actions only: no names, paths, or account labels.
  await fs.appendFile(file, `${JSON.stringify({ time: new Date().toISOString(), action, id })}\n`);
}

const controller = new Controller({
  root,
  store,
  listProcesses: listClaudeProcesses,
  // Tests can simulate a machine without Claude Desktop, as on CI runners.
  detectInstallation: (override) =>
    testMode && process.env.HATSTAND_TEST_NO_CLAUDE === '1'
      ? Promise.resolve(null)
      : detectInstallation(override),
  launchProcess: launchClaude,
  closeProcess: closeOwnedProcess,
  ensureDirectory: ensurePlainDirectory,
  log,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  changed: () => void syncShell().catch(() => {}),
});

function notify() {
  if (window && !window.isDestroyed()) window.webContents.send('hatstand:changed');
}
function show() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  void controller.refresh().catch(() => {});
}
function reportError(error: unknown) {
  // Errors from shortcuts, tray and command-line launches surface in the manager window.
  notify();
  if (window && !window.isVisible()) show();
  return error;
}
function launchFromShell(id: string) {
  void controller.launch(id).catch(reportError);
}
/** Opens a Claude Code session in its own profile's Claude (macOS); otherwise launches or focuses the profile. */
async function openSession(id: string, session?: string) {
  const installation = controller.installation;
  if (session && installation && process.platform === 'darwin' && controller.owned(id)) {
    try {
      if (await openClaudeSession(installation, controller.directories(id).desktop, session)) return;
    } catch (error) {
      reportError(error);
      return;
    }
  }
  launchFromShell(id);
}

const trayActions: TrayActions = {
  show,
  launch: launchFromShell,
  launchStartupGroup: () => void launchStartupGroup().catch(reportError),
  closeAll: () => {
    show();
    void handlers.closeAll(null).catch(reportError);
  },
  quit: () => {
    quitting = true;
    app.quit();
  },
};

async function syncShell() {
  const profiles = (await store.load()).profiles;
  // Pets can be switched on and off in Settings; the hook files they read stay in place.
  if (process.platform === 'darwin' && controller.settings.pets && !pets) {
    pets = new Pets(root, controller, (id, session) => void openSession(id, session));
    await pets.start().catch(() => {});
  } else if (pets && !controller.settings.pets) {
    pets.dispose();
    pets = undefined;
    if (!tray) tray = createTray(show);
  }
  if (pets) {
    await pets.update(profiles, trayMenu(profiles, controller, trayActions));
    // The pets carry the Hatstand menu; the hat comes back only when there are no profiles.
    if (pets.count && tray) {
      tray.destroy();
      tray = undefined;
    } else if (!pets.count && !tray) tray = createTray(show);
  }
  // After the pets, which also rewrite each profile's settings.json.
  await wireBrains(root, controller, profiles).catch(() => {});
  if (tray) updateTray(tray, profiles, controller, trayActions);
  updateDockMenu(profiles, controller, show, launchFromShell);
  notify();
}
async function profilesChanged() {
  const profiles = (await store.load()).profiles;
  hotkeys = registerHotkeys(controller.settings, profiles, show, launchFromShell);
  updateJumpList(profiles);
  await syncShell();
  sync.scheduleSoon();
}
const sync = new ProfileSync(root, store, () => controller.settings, profilesChanged, notify);
async function launchStartupGroup() {
  const ids = (await store.load()).profiles.filter((p) => p.openAtStartup && !p.archived).map((p) => p.id);
  await handlers.launchMany({ ids });
}
async function launchArgument(args: string[]) {
  const value = args.find((arg) => arg.startsWith('--profile='))?.slice('--profile='.length);
  if (!value) return;
  try {
    const profile = findProfileByArgument((await store.load()).profiles, value);
    await controller.launch(profile.id);
  } catch (error) {
    show();
    if (window) void dialog.showMessageBox(window, { type: 'error', message: (error as Error).message });
  }
}

const handlers = createHandlers({
  root,
  store,
  controller,
  window: () => window!,
  hotkeyErrors: () => hotkeys,
  profilesChanged,
  notify,
  sync,
});

// Poll often while the manager is visible; rarely while it only lives in the tray.
function schedulePolling() {
  const delay = window?.isVisible() ? 8000 : 30_000;
  const timer = setTimeout(() => {
    void controller
      .refresh()
      .catch(() => {})
      .finally(schedulePolling);
  }, delay);
  timer.unref();
}

async function start() {
  if (!testMode && process.platform === 'win32') await migrateLegacyData(legacyDataRoot(localAppData), root);
  await fs.mkdir(root, { recursive: true });
  controller.settings = await readSettings(root);
  controller.bindings = await readBindings(root);
  const profiles = (await store.load()).profiles;
  nativeTheme.themeSource = controller.settings.theme;
  await controller.detect();
  if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.Hatstand.Hatstand');
  // Re-applying keeps the login item pointed at the current launcher after updates.
  if (controller.settings.startWithWindows) applyLoginItem(true);

  window = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 580,
    show: false,
    title: 'Hatstand',
    icon: path.join(
      __dirname,
      '..',
      'resources',
      process.platform === 'darwin' ? 'hatstand.png' : 'hatstand.ico',
    ),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c2320' : '#f7f7f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'fileMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ])
      : null,
  );
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (!quitting && controller.settings.minimizeToTray) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.on('closed', () => {
    if (!quitting) {
      quitting = true;
      app.quit();
    }
  });
  ipcMain.handle('hatstand:request', async (event, request: unknown) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame?.url !== pathToFileURL(html).href
    )
      return { ok: false, error: 'Request rejected.' };
    try {
      if (
        !isRecord(request) ||
        typeof request.action !== 'string' ||
        !Object.hasOwn(handlers, request.action)
      )
        throw new Error('Unknown request.');
      return { ok: true, value: await handlers[request.action](request.payload) };
    } catch (error) {
      return { ok: false, error: (error as Error).message || 'The operation failed. Try again.' };
    }
  });
  if (process.platform !== 'darwin' || !controller.settings.pets) tray = createTray(show);
  await window.loadFile(html);
  hotkeys = registerHotkeys(controller.settings, profiles, show, launchFromShell);
  updateJumpList(profiles);
  await controller.refresh();
  await syncShell();
  void sync.start();
  const background =
    process.argv.includes('--background') ||
    (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!background) show();
  if (background && profiles.some((p) => p.openAtStartup && !p.archived))
    void launchStartupGroup().catch(reportError);
  void launchArgument(process.argv);
  schedulePolling();
}

if (!handleSquirrelEvent()) {
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    app.on('second-instance', (_event, args) => {
      if (args.some((arg) => arg.startsWith('--profile='))) void launchArgument(args);
      else show();
    });
    app.on('activate', show);
    app.on('will-quit', () => globalShortcut.unregisterAll());
    app.on('before-quit', () => {
      quitting = true;
    });
    app.whenReady().then(async () => {
      try {
        await start();
      } catch (error) {
        dialog.showErrorBox('Hatstand could not start', (error as Error).message);
        quitting = true;
        app.quit();
      }
    });
  }
}
