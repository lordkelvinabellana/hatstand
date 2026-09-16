import { Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import type { Controller } from '../core/controller.ts';
import type { Profile } from '../core/profiles.ts';

export interface TrayActions {
  show(): void;
  launch(id: string): void;
  launchStartupGroup(): void;
  closeAll(): void;
  quit(): void;
}

export function createTray(onClick: () => void): Tray {
  // The .ico carries 16–256 px images, so Windows picks a sharp size for the current DPI.
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'resources', 'hatstand.ico'));
  const tray = new Tray(icon);
  tray.setToolTip('Hatstand');
  tray.on('click', onClick);
  return tray;
}

export function updateTray(tray: Tray, profiles: Profile[], controller: Controller, actions: TrayActions) {
  const active = profiles.filter((p) => !p.archived);
  const running = active.filter((p) => controller.owned(p.id));
  const startup = active.filter((p) => p.openAtStartup);
  tray.setToolTip(running.length ? `Hatstand · ${running.length} running` : 'Hatstand');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Hatstand', click: actions.show },
      { type: 'separator' },
      ...active.map((p) => {
        const isRunning = running.includes(p);
        return {
          label: `${isRunning ? 'Focus' : 'Launch'} ${p.name.replaceAll('&', '&&')}`,
          sublabel: isRunning ? 'Running' : undefined,
          type: 'checkbox' as const,
          checked: isRunning,
          click: () => actions.launch(p.id),
        };
      }),
      { type: 'separator' },
      {
        label: `Open startup profiles (${startup.length})`,
        enabled: startup.length > 0,
        click: actions.launchStartupGroup,
      },
      { label: 'Close all Claude profiles…', enabled: running.length > 0, click: actions.closeAll },
      { type: 'separator' },
      { label: 'Quit Hatstand', click: actions.quit },
    ]),
  );
}
