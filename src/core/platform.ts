import * as windows from './windows.ts';
import * as macos from './macos.ts';
import type { ProcessObservation } from './launch.ts';

export interface Installation {
  executable: string;
  version: string;
  kind: 'MSIX' | 'Squirrel' | 'Manual' | 'macOS';
}
export interface Platform {
  detectInstallation(override?: string): Promise<Installation | null>;
  listClaudeProcesses(): Promise<ProcessObservation[]>;
  launchClaude(installation: Installation, desktop: string, code: string): Promise<number>;
  closeOwnedProcess(
    installation: Installation,
    desktop: string,
    expected: ProcessObservation,
    force: boolean,
  ): Promise<void>;
}
export function platformFor(os: NodeJS.Platform): Platform {
  if (os === 'darwin') return macos;
  if (os === 'win32') return windows;
  throw new Error('Hatstand supports Windows and macOS.');
}
