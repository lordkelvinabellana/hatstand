import type { ProfileStatus } from './core/controller.ts';
import type { Profile } from './core/profiles.ts';
import type { Settings } from './core/settings.ts';
import type { Installation } from './core/platform.ts';
import type { ReleaseInfo } from './core/project.ts';
import type { StorageFolder } from './core/storage.ts';
import type { SyncStatus } from './main/sync.ts';
import type { BrainStatus } from './main/brain.ts';
import type { SessionState, SessionSummary } from './core/pets.ts';
export type { ProfileStatus };

export interface ProfileView extends Profile {
  status: ProfileStatus;
  message?: string;
  directory: string;
  /** Attached existing folder: Hatstand never removes its data. */
  bound: boolean;
  hotkeyError?: string;
  /** Second brain: this profile's notes vault; `sharedWith` lists the other profiles writing to it. */
  brain: BrainStatus & { sharedWith: string[] };
}
export interface Snapshot {
  platform: 'darwin' | 'win32';
  profiles: ProfileView[];
  settings: Settings;
  installation: Installation | null;
  installationTested: boolean;
  /** The user marked the installed Claude version as working with Hatstand. */
  installationConfirmed: boolean;
  installationError?: string;
  processError?: string;
  hotkeyError?: string;
  version: string;
  /** The commit this build came from (dist/build.json), '' when unknown. */
  build: string;
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
/** A running Claude Code session, as the profile's menu-bar pet shows it. */
export interface SessionView {
  id: string;
  state: SessionState['state'];
  at: number;
  /** The desktop app's id for the session (local_…), used to open it. */
  host?: string;
  summary?: SessionSummary;
}
