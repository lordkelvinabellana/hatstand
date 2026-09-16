import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertId, newProfile, validateInput, validateState } from './profiles.ts';
import type { Profile, ProfileState } from './profiles.ts';

export class ProfileStore {
  readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(directory: string) { this.directory = path.resolve(directory); }
  private get filename() { return path.join(this.directory, 'profiles.json'); }
  async load(): Promise<ProfileState> {
    try {
      const stats = await fs.stat(this.filename);
      if (stats.size > 1_000_000) throw new Error('Profile file is too large.');
      return validateState(JSON.parse(await fs.readFile(this.filename, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {schemaVersion:1, profiles:[]};
      // Never silently replace damaged metadata with an empty store.
      throw error;
    }
  }
  private mutate<T>(fn: (state: ProfileState) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const state = await this.load();
      const result = fn(state);
      validateState(state);
      await fs.mkdir(this.directory, {recursive:true});
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(state,null,2)); await file.sync(); }
        finally { await file.close(); }
        try { await fs.copyFile(this.filename, `${this.filename}.backup`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await fs.rename(temporary, this.filename);
      } finally { await fs.rm(temporary, {force:true}); }
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  create(input: unknown): Promise<Profile> {
    const profile = newProfile(input);
    return this.mutate(state => {state.profiles.push(profile); return profile;});
  }
  update(id: string, input: unknown): Promise<Profile> {
    assertId(id);
    const values = validateInput(input);
    return this.mutate(state => {
      const profile = state.profiles.find(p => p.id === id);
      if (!profile) throw new Error('Profile not found.');
      Object.assign(profile, values);
      return profile;
    });
  }
  archive(id: string, archived: boolean): Promise<void> {
    assertId(id);
    if (typeof archived !== 'boolean') throw new Error('Invalid archive state.');
    return this.mutate(state => {
      const profile = state.profiles.find(p => p.id === id);
      if (!profile) throw new Error('Profile not found.');
      profile.archived = archived;
    });
  }
  reorder(ids: string[]): Promise<void> {
    return this.mutate(state => {
      if (!Array.isArray(ids) || ids.length !== state.profiles.length || new Set(ids).size !== ids.length) throw new Error('Reorder must contain every profile exactly once.');
      const mapped = ids.map(id => { assertId(id); const p = state.profiles.find(p => p.id === id); if (!p) throw new Error('Unknown profile.'); return p; });
      state.profiles = mapped;
    });
  }
  remove(id: string): Promise<void> {
    assertId(id);
    return this.mutate(state => {
      if (!state.profiles.some(p => p.id === id)) throw new Error('Profile not found.');
      state.profiles = state.profiles.filter(p => p.id !== id);
      // Intentionally preserves authenticated data on disk.
    });
  }
  importProfiles(inputs: unknown[]): Promise<Profile[]> {
    const profiles = inputs.map(newProfile);
    return this.mutate(state => {state.profiles.push(...profiles); return profiles;});
  }
}
