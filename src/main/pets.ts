import { execFile } from 'node:child_process';
import { type FSWatcher, watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, Menu, type MenuItemConstructorOptions, nativeImage, screen, Tray } from 'electron';
import type { Controller } from '../core/controller.ts';
import { withFileLock, writeFileAtomic } from '../core/files.ts';
import {
  drawPet,
  encodePng,
  hookScript,
  type Mood,
  modelName,
  parseSession,
  petMood,
  petSound,
  settledState,
  type SessionState,
  type SessionSummary,
  speciesNames,
  summarizeTranscript,
  withPetHooks,
} from '../core/pets.ts';
import type { Profile } from '../core/profiles.ts';
import { type PanelSession, panelHtml } from './panel.ts';
import type { SessionView } from '../shared.ts';

export const labels: Record<Mood, string> = {
  sleep: 'Not running',
  idle: 'Idle',
  working: 'Working…',
  ask: 'Needs your input',
  done: 'Done, output ready',
};

export interface Pet {
  profile: Profile;
  species: number;
  tray: Tray;
  folder: string;
  watcher?: FSWatcher;
  mood: Mood;
  /** Last seen `state@at` per session file, to play a sound only on a change. */
  seen: Map<string, string>;
}

/** One menu-bar pet per profile (macOS). Replaces Hatstand's hat icon while profiles exist. */
export class Pets {
  private pets = new Map<string, Pet>();
  private frame = 0;
  private lastSound = 0;
  private menu: MenuItemConstructorOptions[] = [];
  private timer: NodeJS.Timeout;
  private script: string;
  private sounds: string;
  private panel?: BrowserWindow;
  private panelFor?: Pet;
  /** Opened by a click (stays until you click elsewhere) rather than by hovering. */
  private pinned = false;
  private hiddenAt = 0;
  /** Which sessions are expanded in each pet's panel; unset shows the most urgent one open. */
  private expanded = new Map<string, string[]>();
  private transcripts = new Map<string, { stamp: string; summary: SessionSummary }>();

  constructor(
    root: string,
    private controller: Controller,
    /** Brings up the profile's Claude, at the given desktop session (local_…) when there is one. */
    private open: (id: string, session?: string) => void,
  ) {
    this.script = path.join(root, 'pet-hook.sh');
    this.sounds = path.join(root, 'pet-sounds');
    this.timer = setInterval(() => this.tick(), 450);
    this.timer.unref();
  }

  async start() {
    await fs.writeFile(this.script, hookScript, { mode: 0o755 });
    await fs.mkdir(this.sounds, { recursive: true });
    for (let species = 0; species < speciesNames.length; species++)
      for (const kind of ['ask', 'done'] as const)
        await fs.writeFile(path.join(this.sounds, `${kind}-${species}.wav`), petSound(kind, species));
  }

  get count() {
    return this.pets.size;
  }

  /** Adds, removes and refreshes pets to match the profiles; `menu` is Hatstand's tray menu. */
  async update(profiles: Profile[], menu: MenuItemConstructorOptions[]) {
    this.menu = menu;
    const active = profiles.filter((p) => !p.archived);
    for (const [id, pet] of this.pets)
      if (!active.some((p) => p.id === id)) {
        pet.watcher?.close();
        pet.tray.destroy();
        this.pets.delete(id);
      }
    // Created right to left, so the first profile ends up leftmost in the menu bar.
    for (const [index, profile] of [...active.entries()].reverse()) {
      let pet = this.pets.get(profile.id);
      if (!pet) {
        const folder = path.join(this.controller.directories(profile.id).base, 'pet');
        pet = {
          profile,
          species: 0,
          tray: new Tray(nativeImage.createEmpty()),
          folder,
          mood: 'sleep',
          seen: new Map(),
        };
        const current = pet;
        current.tray.on('click', () => {
          // Clicking the pet blurs (and hides) its open panel first; that click should just close it.
          if (this.panelFor === current && Date.now() - this.hiddenAt < 400) return;
          if (this.pinned && this.panelFor === current) {
            this.hidePanel();
            return;
          }
          this.pinned = true;
          void this.showPanel(current);
        });
        current.tray.on('mouse-enter', () => {
          if (!this.pinned) void this.showPanel(current);
        });
        current.tray.on('right-click', () => current.tray.popUpContextMenu(this.contextMenu(current)));
        this.pets.set(profile.id, current);
        this.watch(current);
        await this.scan(current, true);
      } else {
        pet.profile = profile;
        await this.scan(pet);
      }
      // Retried on every update: a profile's folders appear only once it has been launched.
      await this.installHooks(profile.id).catch(() => {});
      const species = profile.pet ? speciesNames.indexOf(profile.pet) : index % speciesNames.length;
      if (species !== pet.species) {
        pet.species = species;
        this.draw(pet);
      }
    }
  }

  dispose() {
    clearInterval(this.timer);
    for (const pet of this.pets.values()) {
      pet.watcher?.close();
      pet.tray.destroy();
    }
    this.pets.clear();
  }

  /** Watches the pet folder once the hook has created it; Hatstand never creates profile folders itself. */
  private watch(pet: Pet) {
    if (pet.watcher) return;
    try {
      pet.watcher = watch(pet.folder, () => void this.scan(pet));
      pet.watcher.on('error', () => {
        pet.watcher?.close();
        pet.watcher = undefined;
      });
      void this.scan(pet);
    } catch {}
  }

  /** Adds the pet hooks to the profile's Claude Code settings; never overwrites a file it cannot read. */
  private async installHooks(id: string) {
    const code = this.controller.directories(id).code;
    // A profile that was never launched has no folders; creating them would look like leftover data.
    if (!(await fs.stat(code).catch(() => undefined))?.isDirectory()) return;
    const file = path.join(code, 'settings.json');
    // The second brain edits the same settings.json; one queue per file keeps either from dropping the other's hooks.
    await withFileLock(file, async () => {
      let text = '{}';
      try {
        text = await fs.readFile(file, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
      }
      const settings = JSON.parse(text);
      const next = `${JSON.stringify(withPetHooks(settings, this.script), null, 2)}\n`;
      if (next === text) return;
      await writeFileAtomic(file, next);
    });
  }

  private async scan(pet: Pet, quiet = false) {
    const sessions = [];
    let chime: 'ask' | 'done' | undefined;
    const now = Date.now();
    for (const { id, session } of await this.read(pet, false)) {
      sessions.push(session);
      const key = `${session.state}@${session.at}`;
      if (pet.seen.get(id) !== key && session.state !== 'working' && now - session.at < 60_000)
        chime = chime === 'ask' ? 'ask' : session.state;
      pet.seen.set(id, key);
    }
    const mood = petMood(!!this.controller.owned(pet.profile.id), sessions, now);
    if (mood !== pet.mood || quiet) {
      pet.mood = mood;
      this.draw(pet);
    }
    if (this.panelFor === pet && this.panel?.isVisible()) void this.showPanel(pet);
    if (chime && !quiet) this.play(chime, pet.species);
  }

  private play(kind: 'ask' | 'done', species: number) {
    if (!this.controller.settings.petSounds) return;
    if (Date.now() - this.lastSound < 1500) return;
    this.lastSound = Date.now();
    execFile('/usr/bin/afplay', [path.join(this.sounds, `${kind}-${species}.wav`)], () => {});
  }

  private draw(pet: Pet) {
    const png = encodePng(drawPet(pet.species, pet.profile.color, pet.mood, this.frame), 2);
    pet.tray.setImage(nativeImage.createFromBuffer(png, { scaleFactor: 2 }));
  }

  private tick() {
    this.frame++;
    for (const pet of this.pets.values()) {
      this.watch(pet);
      // Idle pets only redraw to blink; stale sessions age out on the slower rescan.
      if (pet.mood !== 'sleep') this.draw(pet);
      if (this.frame % 130 === 0) void this.scan(pet);
    }
    // mouse-leave is unreliable on macOS trays, so the panel closes once the pointer is elsewhere.
    if (this.panel?.isVisible() && this.panelFor && !this.pinned) {
      const at = screen.getCursorScreenPoint();
      const inside = (r: Electron.Rectangle) =>
        at.x >= r.x - 2 && at.x <= r.x + r.width + 2 && at.y >= r.y - 2 && at.y <= r.y + r.height + 8;
      if (!inside(this.panelFor.tray.getBounds()) && !inside(this.panel.getBounds())) this.hidePanel();
    }
  }

  /** The profile's live sessions for its page in Hatstand; empty when it has no pet. */
  async liveSessions(id: string): Promise<SessionView[]> {
    const pet = this.pets.get(id);
    if (!pet) return [];
    return (await this.sessions(pet)).map(({ id, session, summary }) => ({
      id,
      state: session.state,
      at: session.at,
      host: session.host,
      summary,
    }));
  }

  /** Live sessions with what their transcripts say, most urgent first. */
  private async sessions(pet: Pet) {
    const found = (await this.read(pet, true)).filter(
      ({ session }) => petMood(true, [session], Date.now()) !== 'idle',
    );
    const rank = { ask: 0, done: 1, working: 2 };
    return found.sort((a, b) => rank[a.session.state] - rank[b.session.state] || b.session.at - a.session.at);
  }

  /**
   * Every session file, with its state settled against the transcript: a turn that ended mid-plan
   * is still working, one that ended on a question needs you. `all` also reads transcripts of working sessions.
   */
  private async read(pet: Pet, all: boolean): Promise<PanelSession[]> {
    const code = path.resolve(this.controller.directories(pet.profile.id).code);
    const found: PanelSession[] = [];
    for (const name of await fs.readdir(pet.folder).catch(() => [] as string[])) {
      if (!name.endsWith('.json')) continue;
      const session = parseSession(await fs.readFile(path.join(pet.folder, name), 'utf8').catch(() => ''));
      if (!session) continue;
      let summary: SessionSummary | undefined;
      const transcript = session.transcript ? path.resolve(session.transcript) : '';
      // Only this profile's own transcripts: the pet files are not trusted to point elsewhere.
      if (
        (all || session.state === 'done') &&
        transcript.startsWith(code + path.sep) &&
        transcript.endsWith('.jsonl')
      ) {
        const stat = await fs.stat(transcript).catch(() => undefined);
        const stamp = `${stat?.mtimeMs}:${stat?.size}`;
        const cached = this.transcripts.get(transcript);
        if (cached?.stamp === stamp) summary = cached.summary;
        else if (stat) {
          summary = summarizeTranscript(await fs.readFile(transcript, 'utf8').catch(() => ''));
          this.transcripts.set(transcript, { stamp, summary });
        }
      }
      found.push({
        id: name.replace(/\.json$/, ''),
        session: { ...session, state: settledState(session, summary) },
        summary,
      });
    }
    return found;
  }

  private async showPanel(pet: Pet) {
    this.panelFor = pet;
    const html = panelHtml(
      pet,
      labels,
      await this.sessions(pet),
      this.icon(pet),
      this.expanded.get(pet.profile.id),
    );
    if (this.panelFor !== pet) return;
    if (!this.panel || this.panel.isDestroyed()) {
      this.panel = new BrowserWindow({
        width: 340,
        height: 120,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: true,
        acceptFirstMouse: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      this.panel.setAlwaysOnTop(true, 'pop-up-menu');
      this.panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      // Links in the panel are commands: hatstand-pet://open/<session> or hatstand-pet://open.
      this.panel.webContents.on('will-navigate', (event, url) => {
        event.preventDefault();
        const match = /^hatstand-pet:\/\/open(?:\/([A-Za-z0-9_-]+))?$/.exec(url);
        if (match && this.panelFor) void this.openSession(this.panelFor, match[1]);
      });
      // The panel reports its height and open sessions through its title whenever a session is toggled.
      this.panel.webContents.on('page-title-updated', (_event, title) => {
        try {
          const report = JSON.parse(title);
          if (!this.panelFor || !Array.isArray(report.open)) return;
          this.expanded.set(this.panelFor.profile.id, report.open.map(String));
          const bounds = this.panel?.getBounds();
          if (bounds)
            this.panel?.setBounds({
              ...bounds,
              height: Math.min(560, Number(report.height) || bounds.height),
            });
        } catch {}
      });
      this.panel.on('blur', () => {
        if (this.pinned) this.hidePanel();
      });
    }
    const panel = this.panel;
    await panel.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const height = Math.min(
      560,
      Number(await panel.webContents.executeJavaScript('document.body.scrollHeight')),
    );
    const tray = pet.tray.getBounds();
    const area = screen.getDisplayNearestPoint({ x: tray.x, y: tray.y }).workArea;
    const x = Math.min(Math.max(tray.x + tray.width / 2 - 170, area.x + 8), area.x + area.width - 348);
    panel.setBounds({ x: Math.round(x), y: tray.y + tray.height + 4, width: 340, height });
    if (this.panelFor !== pet) return;
    if (this.pinned) {
      panel.show();
      panel.focus();
    } else if (!panel.isVisible()) panel.showInactive();
  }

  private hidePanel() {
    if (this.panel?.isVisible()) this.hiddenAt = Date.now();
    this.pinned = false;
    this.panel?.hide();
  }

  private icon(pet: Pet) {
    return encodePng(
      drawPet(pet.species, pet.profile.color, pet.mood === 'sleep' ? 'sleep' : 'idle', 0),
      3,
    ).toString('base64');
  }

  /** Brings up the profile's Claude (launching it if needed) and clears the session's "done" bubble. */
  private async openSession(pet: Pet, id?: string) {
    this.hidePanel();
    const settled = id ? (await this.read(pet, false)).find((s) => s.id === id) : undefined;
    const host = settled?.session.host;
    this.open(pet.profile.id, host && /^local_[A-Za-z0-9-]{1,64}$/.test(host) ? host : undefined);
    if (!id) return;
    if (settled?.session.state === 'done') await fs.rm(path.join(pet.folder, `${id}.json`), { force: true });
    await this.scan(pet);
  }

  private contextMenu(pet: Pet) {
    return Menu.buildFromTemplate([
      { label: `${pet.profile.name} (${speciesNames[pet.species]})`, enabled: false },
      { label: labels[pet.mood], enabled: false },
      { type: 'separator' },
      ...this.menu,
    ]);
  }
}
