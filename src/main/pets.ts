import { execFile } from 'node:child_process';
import { type FSWatcher, watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, Menu, type MenuItemConstructorOptions, nativeImage, screen, Tray } from 'electron';
import type { Controller } from '../core/controller.ts';
import {
  drawPet,
  encodePng,
  hookScript,
  type Mood,
  modelName,
  parseSession,
  petMood,
  petSound,
  type SessionState,
  type SessionSummary,
  speciesNames,
  summarizeTranscript,
  withPetHooks,
} from '../core/pets.ts';
import type { Profile } from '../core/profiles.ts';

const labels: Record<Mood, string> = {
  sleep: 'Not running',
  idle: 'Idle',
  working: 'Working…',
  ask: 'Needs your input',
  done: 'Done, output ready',
};

interface Pet {
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
  private transcripts = new Map<string, { stamp: string; summary: SessionSummary }>();

  constructor(
    root: string,
    private controller: Controller,
    private open: (id: string) => void,
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
    let text = '{}';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
    const settings = JSON.parse(text);
    const next = `${JSON.stringify(withPetHooks(settings, this.script), null, 2)}\n`;
    if (next === text) return;
    await fs.writeFile(`${file}.hatstand-tmp`, next);
    await fs.rename(`${file}.hatstand-tmp`, file);
  }

  private async scan(pet: Pet, quiet = false) {
    let names: string[] = [];
    try {
      names = (await fs.readdir(pet.folder)).filter((n) => n.endsWith('.json'));
    } catch {}
    const sessions = [];
    let chime: 'ask' | 'done' | undefined;
    const now = Date.now();
    for (const name of names) {
      const session = parseSession(await fs.readFile(path.join(pet.folder, name), 'utf8').catch(() => ''));
      if (!session) continue;
      sessions.push(session);
      const key = `${session.state}@${session.at}`;
      if (pet.seen.get(name) !== key && session.state !== 'working' && now - session.at < 60_000)
        chime = chime === 'ask' ? 'ask' : session.state;
      pet.seen.set(name, key);
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

  /** Live sessions with what their transcripts say, most urgent first. */
  private async sessions(pet: Pet) {
    const code = path.resolve(this.controller.directories(pet.profile.id).code);
    const found: PanelSession[] = [];
    for (const name of await fs.readdir(pet.folder).catch(() => [] as string[])) {
      const session = parseSession(await fs.readFile(path.join(pet.folder, name), 'utf8').catch(() => ''));
      if (!session || petMood(true, [session], Date.now()) === 'idle') continue;
      let summary: SessionSummary | undefined;
      const transcript = session.transcript ? path.resolve(session.transcript) : '';
      // Only this profile's own transcripts: the pet files are not trusted to point elsewhere.
      if (transcript.startsWith(code + path.sep) && transcript.endsWith('.jsonl')) {
        const stat = await fs.stat(transcript).catch(() => undefined);
        const stamp = `${stat?.mtimeMs}:${stat?.size}`;
        const cached = this.transcripts.get(transcript);
        if (cached?.stamp === stamp) summary = cached.summary;
        else if (stat) {
          summary = summarizeTranscript(await fs.readFile(transcript, 'utf8').catch(() => ''));
          this.transcripts.set(transcript, { stamp, summary });
        }
      }
      found.push({ id: name.replace(/\.json$/, ''), session, summary });
    }
    const rank = { ask: 0, done: 1, working: 2 };
    return found.sort((a, b) => rank[a.session.state] - rank[b.session.state] || b.session.at - a.session.at);
  }

  private async showPanel(pet: Pet) {
    this.panelFor = pet;
    const html = panelHtml(pet, await this.sessions(pet), this.icon(pet));
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
    this.open(pet.profile.id);
    if (!id) return;
    const file = path.join(pet.folder, `${id}.json`);
    const session = parseSession(await fs.readFile(file, 'utf8').catch(() => ''));
    if (session?.state === 'done') await fs.rm(file, { force: true });
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

const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}
const stateLabels = { ask: 'Needs your input', done: 'Done', working: 'Working' };

interface PanelSession {
  id: string;
  session: SessionState;
  summary?: SessionSummary;
}
function panelHtml(pet: Pet, sessions: PanelSession[], icon: string) {
  const cards = sessions.map(({ id, session, summary }) => {
    const plan = summary?.plan ?? [];
    const finished = plan.filter((s) => s.status === 'completed').length;
    // Up to seven steps around the current one.
    const current = Math.max(
      0,
      plan.findIndex((s) => s.status !== 'completed'),
    );
    const first = Math.max(0, Math.min(current - 2, plan.length - 7));
    const steps = plan
      .slice(first, first + 7)
      .map((s) => `<li class="${s.status}">${esc(clip(s.content, 60))}</li>`)
      .join('');
    const usage = summary
      ? [
          `Context ${tokens(summary.context)}`,
          `Output ${tokens(summary.output)}`,
          summary.model ? modelName(summary.model) : '',
        ].filter(Boolean)
      : [];
    return `<a class="session" href="hatstand-pet://open/${id}">
      <div class="top"><span class="dot ${session.state}"></span><b>${esc(clip(summary?.title || 'Claude session', 48))}</b><span class="when">${ago(session.at)}</span></div>
      <div class="meta">${stateLabels[session.state]}${summary?.cwd ? ` · ${esc(clip(path.basename(summary.cwd), 40))}` : ''}</div>
      ${summary?.prompt ? `<div class="prompt">${esc(clip(summary.prompt, 140))}</div>` : ''}
      ${plan.length ? `<div class="progress"><span style="width:${Math.round((finished / plan.length) * 100)}%"></span></div><div class="meta">${finished} of ${plan.length} tasks done</div><ol>${steps}</ol>` : ''}
      ${usage.length ? `<div class="usage">${usage.map(esc).join(' · ')}</div>` : ''}
    </a>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>
:root { --bg: rgba(250,250,248,.97); --fg: #1d2421; --muted: #66706b; --line: rgba(0,0,0,.08); --track: rgba(0,0,0,.08); }
@media (prefers-color-scheme: dark) { :root { --bg: rgba(32,36,34,.97); --fg: #eef2f0; --muted: #9aa5a0; --line: rgba(255,255,255,.08); --track: rgba(255,255,255,.12); } }
html, body { margin: 0; background: transparent; }
body { font: 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--fg); padding: 4px; cursor: default; user-select: none; }
.card { background: var(--bg); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
header img { width: 32px; height: 32px; image-rendering: pixelated; }
header div { display: flex; flex-direction: column; }
header b { font-size: 13px; }
header span { color: var(--muted); }
a { color: inherit; text-decoration: none; }
.open { margin-left: auto; padding: 4px 10px; border-radius: 6px; background: var(--track); font-weight: 600; }
.open:hover { background: var(--line); }
.session { display: block; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.session:last-child { border-bottom: 0; }
.session:hover { background: var(--track); }
.top { display: flex; align-items: center; gap: 6px; }
.top b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.when { margin-left: auto; color: var(--muted); white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.ask { background: #ff5a36; } .dot.done { background: #22b35e; } .dot.working { background: #5fa2ea; }
.meta { color: var(--muted); margin-top: 2px; }
.prompt { margin-top: 6px; padding-left: 8px; border-left: 2px solid var(--line); color: var(--muted); }
.progress { height: 4px; border-radius: 2px; background: var(--track); margin-top: 8px; overflow: hidden; }
.progress span { display: block; height: 100%; background: #22b35e; }
ol { list-style: none; margin: 6px 0 0; padding: 0; }
li { padding-left: 18px; position: relative; margin: 2px 0; }
li::before { position: absolute; left: 2px; }
li.completed { color: var(--muted); text-decoration: line-through; } li.completed::before { content: "✓"; color: #22b35e; }
li.in_progress { font-weight: 600; } li.in_progress::before { content: "▸"; color: #5fa2ea; }
li.pending::before { content: "○"; color: var(--muted); }
.usage { margin-top: 8px; color: var(--muted); font-variant-numeric: tabular-nums; }
.empty { padding: 12px; color: var(--muted); margin: 0; }
</style></head><body><div class="card">
<header><img src="data:image/png;base64,${icon}" alt=""><div><b>${esc(pet.profile.name)}</b><span>${labels[pet.mood]}</span></div><a class="open" href="hatstand-pet://open">${pet.mood === 'sleep' ? 'Launch' : 'Open'} Claude</a></header>
${cards.join('') || '<p class="empty">No active sessions.</p>'}
</div></body></html>`;
}
