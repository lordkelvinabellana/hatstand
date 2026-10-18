import { createContext, useContext } from 'react';
import type { Api, Snapshot } from '../shared.ts';

declare global {
  interface Window {
    hatstand: Api;
  }
}
export const api = window.hatstand;

export type Page = 'profiles' | 'archive' | 'settings' | 'about';

export interface AppContextValue {
  data: Snapshot;
  pending: string | null;
  /** Runs an action, shows `message` on success, refreshes, and rethrows failures after showing them. */
  run(action: string, payload?: unknown, message?: string): Promise<unknown>;
  /** Fire-and-forget variant of `run`. */
  fire(action: string, payload?: unknown, message?: string): void;
  navigate(page: Page): void;
  refresh(): Promise<void>;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext is missing.');
  return value;
}

export const isMac = navigator.platform.toLowerCase().includes('mac');
export const trashName = isMac ? 'Trash' : 'Recycle Bin';
export function formatShortcut(accelerator: string) {
  if (isMac)
    return accelerator
      .replace('CommandOrControl', 'Cmd')
      .replace('Command', 'Cmd')
      .replace('Control', 'Ctrl')
      .replace('Super', 'Cmd');
  return accelerator.replace('CommandOrControl', 'Ctrl').replace('Control', 'Ctrl').replace('Super', 'Win');
}
export function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
