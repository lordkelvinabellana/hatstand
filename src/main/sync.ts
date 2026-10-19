import * as fs from 'node:fs/promises';
import path from 'node:path';
import { net, safeStorage } from 'electron';
import type { Settings } from '../core/settings.ts';
import type { ProfileStore } from '../core/store.ts';
import {
  mergeProfiles,
  readTombstones,
  SupabaseClient,
  type SupabaseSession,
  writeTombstones,
} from '../core/sync.ts';

export interface SyncStatus {
  signedIn: boolean;
  syncing: boolean;
  lastSyncAt: string;
  error: string;
}

/** Keeps the Supabase session (encrypted with the OS keychain) and runs profile syncs. */
export class ProfileSync {
  status: SyncStatus = { signedIn: false, syncing: false, lastSyncAt: '', error: '' };
  private session: SupabaseSession | null = null;
  private soon: NodeJS.Timeout | undefined;
  private applying = false;
  private root: string;
  private store: ProfileStore;
  private settings: () => Settings;
  private applied: () => Promise<void>;
  private notify: () => void;

  constructor(
    root: string,
    store: ProfileStore,
    settings: () => Settings,
    applied: () => Promise<void>,
    notify: () => void,
  ) {
    this.root = root;
    this.store = store;
    this.settings = settings;
    this.applied = applied;
    this.notify = notify;
    setInterval(() => this.scheduleSoon(0), 10 * 60_000).unref();
  }

  private get sessionFile() {
    return path.join(this.root, 'sync-session.bin');
  }
  private client() {
    const { syncUrl, syncKey } = this.settings();
    if (!syncUrl || !syncKey) throw new Error('Add your Supabase project URL and publishable key first.');
    return new SupabaseClient(syncUrl, syncKey, (url, init) => net.fetch(url, init));
  }

  async start() {
    try {
      const sealed = await fs.readFile(this.sessionFile);
      this.session = JSON.parse(safeStorage.decryptString(sealed));
    } catch {
      this.session = null;
    }
    this.status.signedIn = !!this.session;
    this.scheduleSoon(0);
  }

  private async keep(session: SupabaseSession | null) {
    this.session = session;
    this.status.signedIn = !!session;
    if (!session) {
      await fs.rm(this.sessionFile, { force: true });
      return;
    }
    // The refresh token is a credential: only ever stored encrypted by the OS keychain.
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('This computer cannot encrypt the sync sign-in, so Hatstand will not store it.');
    await fs.writeFile(this.sessionFile, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 });
  }

  async sendCode() {
    const email = this.settings().syncEmail;
    if (!email) throw new Error('Enter your email first.');
    await this.client().sendCode(email);
  }

  async verify(code: string) {
    if (!/^\d{6,10}$/.test(code.trim())) throw new Error('Enter the code from the email.');
    await this.keep(await this.client().verifyCode(this.settings().syncEmail, code.trim()));
    this.status.error = '';
    await this.syncNow();
  }

  async signOut() {
    await this.keep(null);
    this.status.lastSyncAt = '';
    this.notify();
  }

  /** Records a removed profile so other computers remove it too. */
  async markDeleted(id: string) {
    const markers = await readTombstones(this.root);
    markers[id] = new Date().toISOString();
    await writeTombstones(this.root, markers);
  }

  /** Syncs a moment after a change; changes this sync applies itself don't start another. */
  scheduleSoon(delay = 2000) {
    if (this.applying || !this.settings().syncEnabled || !this.session) return;
    clearTimeout(this.soon);
    this.soon = setTimeout(() => void this.syncNow().catch(() => {}), delay);
  }

  private async token() {
    if (!this.session) throw new Error('Sign in to sync profiles.');
    if (this.session.expires_at - Date.now() < 60_000) {
      try {
        await this.keep(await this.client().refresh(this.session.refresh_token));
      } catch (error) {
        await this.keep(null);
        throw new Error(`Sign in again to keep syncing. (${(error as Error).message})`);
      }
    }
    return this.session!.access_token;
  }

  async syncNow() {
    if (this.status.syncing) return;
    this.status.syncing = true;
    this.notify();
    try {
      const client = this.client();
      const token = await this.token();
      const remote = await client.pull(token);
      const markers = await readTombstones(this.root);
      const local = (await this.store.load()).profiles;
      const result = mergeProfiles(local, markers, remote);
      if (JSON.stringify(result.profiles) !== JSON.stringify(local)) {
        // Removed profiles keep their data on disk, exactly like removing one in Hatstand.
        await this.store.replaceAll(result.profiles);
        this.applying = true;
        try {
          await this.applied();
        } finally {
          this.applying = false;
        }
      }
      await client.push(token, result.push);
      // Markers this sync handled are pushed or superseded; ones added meanwhile wait for the next sync.
      const remaining = await readTombstones(this.root);
      for (const id of Object.keys(markers)) if (remaining[id] === markers[id]) delete remaining[id];
      await writeTombstones(this.root, remaining);
      this.status.lastSyncAt = new Date().toISOString();
      this.status.error = '';
    } catch (error) {
      this.status.error = (error as Error).message || 'Sync failed.';
      throw error;
    } finally {
      this.status.syncing = false;
      this.notify();
    }
  }
}
