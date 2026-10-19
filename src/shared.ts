import type { ProfileStatus } from './core/controller.ts';
import type { Profile } from './core/profiles.ts';
import type { Settings } from './core/settings.ts';
import type { Installation } from './core/platform.ts';
import type { ReleaseInfo } from './core/project.ts';
import type { StorageFolder } from './core/storage.ts';
import type { SyncStatus } from './main/sync.ts';
export type { ProfileStatus };

export interface ProfileView extends Profile {
  status: ProfileStatus;
  message?: string;
  directory: string;
  /** Attached existing folder: Hatstand never removes its data. */
  bound: boolean;
  hotkeyError?: string;
}
export interface Snapshot {
  platform: 'darwin' | 'win32';
  profiles: ProfileView[];
  settings: Settings;
  installation: Installation | null;
  installationTested: boolean;
  installationError?: string;
  processError?: string;
  hotkeyError?: string;
  version: string;
  packaged: boolean;
  dataFolder: string;
  sync: SyncStatus;
}
export interface UpdateCheck {
  current: string;
  latest: ReleaseInfo | null;
  newer: boolean;
}
export type { ReleaseInfo, StorageFolder };
export interface Api {
  request(action: string, payload?: unknown): Promise<unknown>;
  onChange(callback: () => void): () => void;
}
