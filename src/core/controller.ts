import path from 'node:path';
import { ownsProcess, profilePaths } from './launch.ts';
import type { ProcessObservation } from './launch.ts';
import { assertId } from './profiles.ts';
import type { Profile } from './profiles.ts';
import { defaults } from './settings.ts';
import type { Settings } from './settings.ts';
import type { ProfileStore } from './store.ts';
import type { Installation } from './windows.ts';

export type ProfileStatus = 'stopped' | 'starting' | 'running' | 'closing' | 'error' | 'unknown';

/** Everything with side effects is injected so the lifecycle can be tested without Windows or Electron. */
export interface ControllerDeps {
  root: string;
  store: ProfileStore;
  listProcesses(): Promise<ProcessObservation[]>;
  detectInstallation(override: string): Promise<Installation | null>;
  launchProcess(installation: Installation, desktop: string, code: string): Promise<unknown>;
  closeProcess(
    installation: Installation,
    desktop: string,
    process: ProcessObservation,
    force: boolean,
  ): Promise<void>;
  ensureDirectory(directory: string, base: string): Promise<void>;
  log(action: string, id?: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Called whenever observable state changes. */
  changed(): void;
}
export const defaultTimings = {
  launchSettle: 1200,
  startTimeout: 20_000,
  closeWait: 8000,
  closePoll: 500,
  detectionReuse: 15_000,
};
interface Transition {
  status: ProfileStatus;
  since: number;
  message?: string;
}
export interface ProfileDirectories {
  base: string;
  desktop: string;
  code: string;
  /** Links and junctions are rejected below this folder. */
  trusted: string;
  /** Attached through bindings.json rather than created by Hatstand. */
  bound: boolean;
}

export class Controller {
  settings: Settings = { ...defaults };
  bindings: Record<string, string> = {};
  installation: Installation | null = null;
  installationError = '';
  processError = '';
  private processes: ProcessObservation[] = [];
  private detectedAt = Number.NEGATIVE_INFINITY;
  private scanning?: Promise<void>;
  private queued?: Promise<void>;
  private readonly busy = new Set<string>();
  private readonly transitions = new Map<string, Transition>();
  private readonly deps: ControllerDeps;
  private readonly timings: typeof defaultTimings;

  constructor(deps: ControllerDeps, timings = defaultTimings) {
    this.deps = deps;
    this.timings = timings;
  }

  directories(id: string): ProfileDirectories {
    assertId(id);
    const bound = this.bindings[id];
    if (bound)
      return {
        base: bound,
        desktop: path.join(bound, 'desktop'),
        code: path.join(bound, 'code'),
        trusted: bound,
        bound: true,
      };
    return { ...profilePaths(this.deps.root, id), trusted: this.deps.root, bound: false };
  }
  owned(id: string): ProcessObservation | undefined {
    const installation = this.installation;
    if (!installation) return undefined;
    const { desktop } = this.directories(id);
    return this.processes.find((p) => ownsProcess(p, installation.executable, desktop));
  }
  /** Whether any observed main Claude process uses this Desktop data folder, regardless of executable. */
  usesDirectory(desktop: string): boolean {
    const target = path.win32.normalize(desktop).toLowerCase();
    return this.processes.some((p) => p.commandLine.toLowerCase().includes(target));
  }
  status(id: string): { status: ProfileStatus; message?: string } {
    if (this.processError) return { status: 'unknown' };
    const transition = this.transitions.get(id);
    if (transition) return { status: transition.status, message: transition.message };
    return { status: this.owned(id) ? 'running' : 'stopped' };
  }

  async detect(force = true): Promise<Installation | null> {
    if (!force && this.installation && this.deps.now() - this.detectedAt < this.timings.detectionReuse)
      return this.installation;
    try {
      this.installation = await this.deps.detectInstallation(this.settings.executable);
      this.installationError = '';
    } catch (error) {
      this.installation = null;
      this.installationError =
        (error as Error).message ||
        'Claude installation could not be located. Choose Claude.exe in Settings.';
    }
    this.detectedAt = this.deps.now();
    return this.installation;
  }

  /** Scans processes. Callers arriving during a scan get a scan that starts after theirs was requested. */
  refresh(): Promise<void> {
    if (this.queued) return this.queued;
    const start = () => {
      const scan = this.scan().finally(() => {
        if (this.scanning === scan) this.scanning = undefined;
      });
      this.scanning = scan;
      return scan;
    };
    if (!this.scanning) return start();
    const queued = this.scanning
      .catch(() => {})
      .then(() => {
        this.queued = undefined;
        return start();
      });
    this.queued = queued;
    return queued;
  }
  private async scan() {
    try {
      this.processes = await this.deps.listProcesses();
      this.processError = '';
    } catch {
      this.processes = [];
      this.processError =
        'Could not read Claude process status. Check that Windows PowerShell is available, then refresh.';
    }
    for (const [id, transition] of this.transitions) {
      const running = !!this.owned(id);
      if ((transition.status === 'starting' || transition.status === 'error') && running)
        this.transitions.delete(id);
      else if (
        transition.status === 'starting' &&
        this.deps.now() - transition.since > this.timings.startTimeout
      )
        this.transitions.set(id, {
          status: 'error',
          since: this.deps.now(),
          message:
            'Claude did not start with this profile. Refresh the installation in Settings and try again.',
        });
    }
    this.deps.changed();
  }

  async getProfile(id: string): Promise<Profile> {
    assertId(id);
    const profile = (await this.deps.store.load()).profiles.find((p) => p.id === id);
    if (!profile) throw new Error('This profile no longer exists.');
    return profile;
  }

  /** Launches a stopped profile, or asks the running instance to come to the front. */
  async launch(id: string, reuseDetection = false): Promise<void> {
    const profile = await this.getProfile(id);
    if (profile.archived) throw new Error('Restore this profile before launching it.');
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      // Rediscover because a Claude update can replace its path.
      const installation = await this.detect(!reuseDetection);
      if (!installation)
        throw new Error(this.installationError || 'Install Claude Desktop or choose Claude.exe in Settings.');
      const paths = this.directories(id);
      const focusing = !!this.owned(id);
      await this.deps.ensureDirectory(paths.desktop, paths.trusted);
      await this.deps.ensureDirectory(paths.code, paths.trusted);
      if (!focusing) {
        this.transitions.set(id, { status: 'starting', since: this.deps.now() });
        this.deps.changed();
      }
      await this.deps.launchProcess(installation, paths.desktop, paths.code);
      await this.deps.log(focusing ? 'focus' : 'launch', id).catch(() => {});
      if (!focusing) {
        await this.deps.sleep(this.timings.launchSettle);
        await this.refresh();
      }
    } catch (error) {
      this.transitions.set(id, {
        status: 'error',
        since: this.deps.now(),
        message: (error as Error).message,
      });
      this.deps.changed();
      throw error;
    } finally {
      this.busy.delete(id);
    }
  }

  /** Launches several profiles in order; one failure does not stop the rest. */
  async launchMany(ids: string[]): Promise<{ id: string; message: string }[]> {
    const failures: { id: string; message: string }[] = [];
    for (const [index, id] of ids.entries()) {
      try {
        await this.launch(id, index > 0);
      } catch (error) {
        failures.push({ id, message: (error as Error).message });
      }
    }
    return failures;
  }

  async close(id: string, force = false): Promise<void> {
    await this.getProfile(id);
    await this.refresh();
    const process = this.owned(id);
    const installation = this.installation;
    if (!process || !installation) return;
    if (this.busy.has(id)) throw new Error('This profile is busy. Try again in a moment.');
    this.busy.add(id);
    const { desktop } = this.directories(id);
    this.transitions.set(id, { status: 'closing', since: this.deps.now() });
    this.deps.changed();
    let requestError: Error | undefined;
    try {
      try {
        await this.deps.closeProcess(installation, desktop, process, force);
        await this.deps.log(force ? 'force-close' : 'close', id).catch(() => {});
      } catch (error) {
        requestError = error as Error;
      }
      // taskkill returns before Claude exits, so wait for the process to disappear.
      const deadline = this.deps.now() + (requestError ? 0 : this.timings.closeWait);
      do {
        await this.deps.sleep(this.timings.closePoll);
        await this.refresh();
      } while (this.owned(id) && this.deps.now() < deadline);
    } finally {
      this.transitions.delete(id);
      this.busy.delete(id);
      this.deps.changed();
    }
    if (!this.owned(id)) return;
    if (requestError?.message === 'The process changed. Refresh and try again.') throw requestError;
    throw new Error(
      force
        ? 'Claude is still running. Refresh in a moment; if it remains, end it from Task Manager.'
        : 'Claude is still running, possibly in its tray. Use File → Exit in that Claude window, or choose Force close if it has no active work.',
    );
  }

  async restart(id: string): Promise<void> {
    await this.close(id);
    await this.launch(id);
  }

  /** Politely closes every running profile; returns the ones that stayed open. */
  async closeAll(): Promise<{ id: string; message: string }[]> {
    await this.refresh();
    const profiles = (await this.deps.store.load()).profiles.filter((p) => this.owned(p.id));
    const failures: { id: string; message: string }[] = [];
    for (const profile of profiles) {
      try {
        await this.close(profile.id);
      } catch (error) {
        failures.push({ id: profile.id, message: (error as Error).message });
      }
    }
    return failures;
  }

  runningCount(profiles: Profile[]) {
    return profiles.filter((p) => this.owned(p.id)).length;
  }
}
