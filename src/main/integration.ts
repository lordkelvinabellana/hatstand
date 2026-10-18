// Platform shell integration: login items, Dock/jump lists and global shortcuts.
import { app, globalShortcut, shell, Menu } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { acceleratorKey } from '../core/accelerator.ts';
import { joinWindowsCommandLine, stableLauncher } from '../core/paths.ts';
import type { Profile } from '../core/profiles.ts';
import type { Controller } from '../core/controller.ts';
import type { Settings } from '../core/settings.ts';

export function launcher() {
  return process.platform === 'darwin'
    ? { target: process.execPath, args: (extra: string[]) => extra, icon: process.execPath }
    : stableLauncher(process.execPath, existsSync);
}

export function applyLoginItem(openAtLogin: boolean) {
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin });
    return;
  }
  const target = launcher();
  app.setLoginItemSettings({ openAtLogin, path: target.target, args: target.args(['--background']) });
}

export function safeFileName(name: string) {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/[. ]+$/, '')
      .slice(0, 60) || 'Client'
  );
}

export function createDesktopShortcut(profile: Profile) {
  if (process.platform !== 'win32')
    throw new Error('Use the Dock menu or a profile keyboard shortcut on macOS.');
  if (!app.isPackaged) throw new Error('Shortcuts are available in the installed app.');
  const target = launcher();
  const file = path.join(
    app.getPath('desktop'),
    `Hatstand - ${safeFileName(profile.name)} - ${profile.id.slice(0, 6)}.lnk`,
  );
  const ok = shell.writeShortcutLink(file, 'create', {
    target: target.target,
    args: joinWindowsCommandLine(target.args([`--profile=${profile.id}`])),
    description: `Open ${profile.name} in Claude Desktop`,
    icon: target.icon,
    iconIndex: 0,
    appUserModelId: 'com.squirrel.Hatstand.Hatstand',
  });
  if (!ok) throw new Error('Windows could not create the shortcut.');
}

let jumpListSignature = '';
export function updateJumpList(profiles: Profile[]) {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const active = profiles.filter((p) => !p.archived).slice(0, 10);
  const signature = JSON.stringify(active.map((p) => [p.id, p.name]));
  if (signature === jumpListSignature) return;
  const target = launcher();
  const result = app.setJumpList(
    active.length
      ? [
          {
            type: 'custom',
            name: 'Clients',
            items: active.map((p) => ({
              type: 'task' as const,
              title: p.name,
              description: `Open ${p.name} in Claude Desktop`,
              program: target.target,
              args: joinWindowsCommandLine(target.args([`--profile=${p.id}`])),
              iconPath: target.icon,
              iconIndex: 0,
            })),
          },
        ]
      : null,
  );
  // Windows can refuse updates (for example when jump lists are disabled); retry next change.
  jumpListSignature = result === 'ok' ? signature : '';
}

export interface HotkeyResult {
  managerError: string;
  profileErrors: Map<string, string>;
}
export function registerHotkeys(
  settings: Settings,
  profiles: Profile[],
  openManager: () => void,
  openProfile: (id: string) => void,
): HotkeyResult {
  globalShortcut.unregisterAll();
  const result: HotkeyResult = { managerError: '', profileErrors: new Map() };
  const register = (accelerator: string, callback: () => void) => {
    try {
      return globalShortcut.register(accelerator, callback)
        ? ''
        : 'That shortcut is already used by another app. Choose another.';
    } catch {
      return 'That shortcut is not valid.';
    }
  };
  if (settings.hotkey) result.managerError = register(settings.hotkey, openManager);
  const manager = settings.hotkey ? acceleratorKey(settings.hotkey) : '';
  for (const profile of profiles) {
    if (!profile.hotkey || profile.archived) continue;
    const error =
      acceleratorKey(profile.hotkey) === manager
        ? 'This shortcut is the Hatstand shortcut. Choose another.'
        : register(profile.hotkey, () => openProfile(profile.id));
    if (error) result.profileErrors.set(profile.id, error);
  }
  return result;
}

export function updateDockMenu(
  profiles: Profile[],
  controller: Controller,
  show: () => void,
  launch: (id: string) => void,
) {
  if (process.platform !== 'darwin') return;
  app.dock?.setMenu(
    Menu.buildFromTemplate([
      { label: 'Open Hatstand', click: show },
      { type: 'separator' },
      ...profiles
        .filter((p) => !p.archived)
        .map((p) => ({
          label: `${controller.owned(p.id) ? 'Focus' : 'Launch'} ${p.name}`,
          click: () => launch(p.id),
        })),
    ]),
  );
}
