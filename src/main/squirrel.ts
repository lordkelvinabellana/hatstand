import { app } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { applyLoginItem } from './integration.ts';

/**
 * Squirrel.Windows runs the app with lifecycle flags during install, update and
 * uninstall. Returns true when this process only exists to handle such an event.
 * `--squirrel-firstrun` is the normal launch right after install and is not handled here.
 */
export function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32') return false;
  const event = process.argv.find((arg) => arg.startsWith('--squirrel-'));
  if (!event || event === '--squirrel-firstrun') return false;
  const finish = () => app.quit();
  if (event === '--squirrel-uninstall') {
    // Profile data lives outside the install folder and is intentionally kept.
    try {
      applyLoginItem(false);
    } catch {}
  }
  const operation =
    event === '--squirrel-install' || event === '--squirrel-updated'
      ? '--createShortcut'
      : event === '--squirrel-uninstall'
        ? '--removeShortcut'
        : null;
  if (!operation) {
    finish();
    return true;
  }
  const update = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const child = spawn(update, [operation, path.basename(process.execPath)], {
    windowsHide: true,
    stdio: 'ignore',
  });
  child.once('error', finish);
  child.once('exit', finish);
  return true;
}
