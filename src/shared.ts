import type { Profile } from './core/profiles.ts';
import type { Settings } from './core/settings.ts';
import type { Installation } from './core/windows.ts';
export type ProfileStatus = 'stopped' | 'starting' | 'running' | 'closing' | 'error' | 'unknown';
export interface ProfileView extends Profile {
  status: ProfileStatus;
  message?: string;
  directory: string;
}
export interface Snapshot {
  profiles: ProfileView[];
  settings: Settings;
  installation: Installation | null;
  installationError?: string;
  processError?: string;
  hotkeyError?: string;
  version: string;
  packaged: boolean;
}
export interface Api {
  request(action: string, payload?: unknown): Promise<unknown>;
  onChange(callback: () => void): () => void;
}
