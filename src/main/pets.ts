import { execFile } from 'node:child_process';
import { type FSWatcher, watch } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron';
import type { Controller } from '../core/controller.ts';
import {
  drawPet,
  encodePng,
  hookScript,
  type Mood,
  parseSession,
  petMood,
  petSound,
  speciesNames,
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
          species: index % speciesNames.length,
          tray: new Tray(nativeImage.createEmpty()),
          folder,
          mood: 'sleep',
          seen: new Map(),
        };
        const current = pet;
        current.tray.on('click', () => this.acknowledge(current));
        current.tray.on('right-click', () => current.tray.popUpContextMenu(this.contextMenu(current)));
        this.pets.set(profile.id, current);
        await fs.mkdir(folder, { recursive: true }).catch(() => {});
        try {
          current.watcher = watch(folder, () => void this.scan(current));
        } catch {}
        await this.installHooks(profile.id).catch(() => {});
        await this.scan(current, true);
      } else {
        pet.profile = profile;
        await this.scan(pet);
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

  /** Adds the pet hooks to the profile's Claude Code settings; never overwrites a file it cannot read. */
  private async installHooks(id: string) {
    const file = path.join(this.controller.directories(id).code, 'settings.json');
    let text = '{}';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    }
    const settings = JSON.parse(text);
    const next = `${JSON.stringify(withPetHooks(settings, this.script), null, 2)}\n`;
    if (next === text) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
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
    pet.tray.setToolTip(`${pet.profile.name} · ${labels[mood]}`);
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
      // Idle pets only redraw to blink; stale sessions age out on the slower rescan.
      if (pet.mood !== 'sleep') this.draw(pet);
      if (this.frame % 130 === 0) void this.scan(pet);
    }
  }

  /** Clicking a pet opens its Claude and dismisses a "done" bubble. */
  private async acknowledge(pet: Pet) {
    this.open(pet.profile.id);
    for (const name of await fs.readdir(pet.folder).catch(() => [] as string[])) {
      const file = path.join(pet.folder, name);
      const session = parseSession(await fs.readFile(file, 'utf8').catch(() => ''));
      if (session?.state === 'done') await fs.rm(file, { force: true });
    }
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
