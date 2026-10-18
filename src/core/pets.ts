import { crc32, deflateSync } from 'node:zlib';
import type { Color } from './profiles.ts';

/**
 * Menu-bar pets: one pixel pet per profile that shows what that account's Claude Code
 * sessions are doing. Claude Code hooks (pet-hook.sh) write one small JSON file per
 * session into `<profile>/pet/`; Hatstand reads them, draws the pet and plays a sound.
 */
export type Mood = 'sleep' | 'idle' | 'working' | 'ask' | 'done';
export interface SessionState {
  state: 'working' | 'ask' | 'done';
  at: number;
}

const minute = 60_000;
// shortcut: a session that stops sending hook events (crash, force quit) is dropped after
// these ages; raise them if long tool-free thinking ever shows the pet idle too early.
const maxAge = { working: 20 * minute, ask: 12 * 60 * minute, done: 12 * 60 * minute };

export function petMood(running: boolean, sessions: SessionState[], now: number): Mood {
  const live = sessions.filter((s) => maxAge[s.state] && now - s.at < maxAge[s.state]);
  for (const state of ['ask', 'done', 'working'] as const)
    if (live.some((s) => s.state === state)) return state;
  return running ? 'idle' : 'sleep';
}

export function parseSession(text: string): SessionState | null {
  try {
    const value = JSON.parse(text);
    if (['working', 'ask', 'done'].includes(value?.state) && Number.isFinite(value?.at)) return value;
  } catch {}
  return null;
}

// Sprites are drawn as a left half and mirrored. o outline, b body, d shade, w white, k eye, p pink.
const species: string[][] = [
  // cat
  [
    '........',
    '........',
    '..o.....',
    '.obo....',
    '.obbo...',
    '.obbboooo',
    '.obbbbbbb',
    'obbbbbbbb',
    'obbkkbbbb',
    'obbkkbbbb',
    'obpbbbbbp',
    'obbbbbbob',
    '.obbbbbbb',
    '..ooooooo',
    '........',
    '........',
  ],
  // frog
  [
    '........',
    '........',
    '.oooo...',
    'owwwwo..',
    'owkkwo..',
    'owkkwooo',
    'obbbbbbb',
    'obpbbbbb',
    'obbbbbbb',
    'obbooooo',
    'obbbbbbb',
    '.obbbbbb',
    '..oooooo',
    '........',
    '........',
    '........',
  ],
  // ghost
  [
    '........',
    '....oooo',
    '...obbbb',
    '..obbbbb',
    '.obbbbbb',
    '.obkkbbb',
    'obbkkbbb',
    'obbbbbbb',
    'obpbbbbb',
    'obbbbbbb',
    'obbbbbbb',
    'obbbbbbb',
    'obobbobb',
    'o.o..o.o',
    '........',
    '........',
  ],
  // bunny
  [
    '...oo...',
    '..obbo..',
    '..obpo..',
    '..obpo..',
    '..obbo..',
    '.obbbbooo',
    'obbbbbbbb',
    'obbkkbbbb',
    'obbkkbbbb',
    'obpbbbbbp',
    'obbbbbbob',
    '.obbbbbbb',
    '..ooooooo',
    '........',
    '........',
    '........',
  ],
];
export const speciesNames = ['cat', 'frog', 'ghost', 'bunny'];

function mirror(half: string[]): string[] {
  return half.map((row) => {
    const left = row.padEnd(8, '.').slice(0, 8);
    return left + [...left].reverse().join('');
  });
}
const sprites = species.map(mirror);

const bubble = [
  '..oooooo..',
  '.owwwwwwo.',
  'owwwwwwwwo',
  'owwwwwwwwo',
  'owwwwwwwwo',
  'owwwwwwwwo',
  '.owwwwwwo.',
  '..oooooo..',
  '.oo.......',
  'o.........',
];
const glyphs: Record<string, string[]> = {
  ask: ['..rr..', '..rr..', '..rr..', '......', '..rr..'],
  done: ['.....g', '....gg', 'g..gg.', 'gggg..', '.gg...'],
  dots0: ['......', '......', 'k.....', '......', '......'],
  dots1: ['......', '......', 'k.k...', '......', '......'],
  dots2: ['......', '......', 'k.k.k.', '......', '......'],
};

const bodies: Record<Color, string> = {
  teal: '#3fbf92',
  amber: '#f2ad35',
  violet: '#a586ea',
  blue: '#5fa2ea',
  rose: '#ea7395',
  slate: '#98aca3',
};
type RGBA = [number, number, number, number];
function hex(value: string, alpha = 255): RGBA {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}
function shade([r, g, b, a]: RGBA, by: number): RGBA {
  return [Math.round(r * by), Math.round(g * by), Math.round(b * by), a];
}
function gray([r, g, b, a]: RGBA): RGBA {
  const v = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return [v, v, v, Math.round(a * 0.75)];
}

export const petWidth = 16;
export const fullWidth = 26;
export const petHeight = 16;

/** Draws one animation frame as a grid of RGBA pixels. */
export function drawPet(speciesIndex: number, color: Color, mood: Mood, frame: number): RGBA[][] {
  const sprite = sprites[speciesIndex % sprites.length];
  const withBubble = mood === 'ask' || mood === 'done' || mood === 'working';
  const width = withBubble ? fullWidth : petWidth;
  const grid: RGBA[][] = Array.from({ length: petHeight }, () =>
    Array.from({ length: width }, () => [0, 0, 0, 0] as RGBA),
  );
  const body = hex(bodies[color] ?? bodies.slate);
  const palette: Record<string, RGBA> = {
    o: [24, 24, 28, 255],
    b: body,
    d: shade(body, 0.7),
    w: [255, 255, 255, 255],
    k: [24, 24, 28, 255],
    p: hex('#ff9fb8'),
    r: hex('#ff5a36'),
    g: hex('#22b35e'),
  };
  const blink = mood === 'sleep' || (mood === 'idle' && frame % 12 === 11);
  // Working pets bob; pets asking for you hop.
  const lift = (mood === 'working' && frame % 2 === 1) || (mood === 'ask' && frame % 4 < 2) ? 1 : 0;
  stamp(grid, sprite, 0, -lift, (ch, x, y) => {
    // Closed eyes: the eye's lower row becomes a line, the rest becomes skin.
    const key = blink && ch === 'k' ? (sprite[y + 1]?.[x] === 'k' ? 'b' : 'o') : ch;
    return mood === 'sleep' ? gray(palette[key]) : palette[key];
  });
  if (withBubble) {
    const glyph = mood === 'working' ? glyphs[`dots${frame % 3}`] : glyphs[mood];
    // The bubble blinks while the pet is asking, so it catches the eye.
    const showGlyph = mood !== 'ask' || frame % 4 !== 3;
    stamp(grid, bubble, petWidth, 0, (ch) => palette[ch]);
    if (showGlyph) stamp(grid, glyph, petWidth + 2, 2, (ch) => palette[ch]);
  }
  return grid;
}

function stamp(
  grid: RGBA[][],
  rows: string[],
  dx: number,
  dy: number,
  pixel: (ch: string, x: number, y: number) => RGBA,
) {
  for (const [y, row] of rows.entries())
    for (const [x, ch] of [...row].entries())
      if (ch !== '.' && grid[y + dy]?.[x + dx]) grid[y + dy][x + dx] = pixel(ch, x, y);
}

/** Encodes an RGBA grid as a PNG, scaled up by `scale` with hard pixel edges. */
export function encodePng(grid: RGBA[][], scale: number): Buffer {
  const height = grid.length * scale;
  const width = grid[0].length * scale;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = grid[Math.floor(y / scale)];
    for (let x = 0; x < width; x++) raw.set(row[Math.floor(x / scale)], y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A short square-wave jingle as a 16-bit mono WAV. Each species sings in its own key,
 * so you can tell by ear which account wants you.
 */
export function petSound(kind: 'ask' | 'done', speciesIndex: number): Buffer {
  const rate = 22050;
  const transpose = [0, 3, 5, -2][speciesIndex % 4];
  // [semitones above A4, seconds]; null is a rest.
  const notes: [number | null, number][] =
    kind === 'ask'
      ? [
          [7, 0.07],
          [12, 0.11],
          [null, 0.08],
          [7, 0.07],
          [12, 0.14],
        ]
      : [
          [3, 0.06],
          [7, 0.06],
          [10, 0.06],
          [15, 0.2],
        ];
  const samples: number[] = [];
  for (const [note, seconds] of notes) {
    const count = Math.round(seconds * rate);
    const frequency = note === null ? 0 : 440 * 2 ** ((note + transpose) / 12);
    for (let i = 0; i < count; i++) {
      if (!frequency) {
        samples.push(0);
        continue;
      }
      const t = i / rate;
      const envelope = Math.min(1, t / 0.004) * Math.exp(-t * 9);
      samples.push((t * frequency) % 1 < 0.5 ? envelope : -envelope);
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  for (const [i, s] of samples.entries()) data.writeInt16LE(Math.round(s * 0.22 * 32767), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Records the session's state where Hatstand watches: `<profile>/pet/<session>.json`. */
export const hookScript = `#!/bin/sh
# Hatstand menu-bar pet hook (written by Hatstand). Usage: pet-hook.sh working|ask|done|end
[ -n "$CLAUDE_CONFIG_DIR" ] || exit 0
sid=$(grep -o '"session_id" *: *"[^"]*"' | head -n 1 | sed 's/.*"\\([^"]*\\)"$/\\1/')
case "$sid" in '' | *[!A-Za-z0-9_-]*) exit 0 ;; esac
dir="$(dirname "$CLAUDE_CONFIG_DIR")/pet"
mkdir -p "$dir" || exit 0
if [ "$1" = end ]; then rm -f "$dir/$sid.json"; exit 0; fi
printf '{"state":"%s","at":%s000}\\n' "$1" "$(date +%s)" > "$dir/$sid.tmp" && mv -f "$dir/$sid.tmp" "$dir/$sid.json"
`;

/** Returns `settings` with the pet hooks added (replacing any earlier pet hooks), leaving other hooks alone. */
export function withPetHooks(settings: Record<string, unknown>, script: string): Record<string, unknown> {
  const run = (state: string) => ({
    type: 'command',
    command: `/bin/sh "${script}" ${state}`,
    timeout: 5,
    async: true,
  });
  const wanted: [string, string | undefined, string][] = [
    ['UserPromptSubmit', undefined, 'working'],
    ['PostToolUse', undefined, 'working'],
    ['PreToolUse', 'AskUserQuestion|ExitPlanMode', 'ask'],
    ['PermissionRequest', undefined, 'ask'],
    ['Notification', 'permission_prompt|elicitation_dialog', 'ask'],
    ['Stop', undefined, 'done'],
    ['SessionEnd', undefined, 'end'],
  ];
  const isPet = (group: unknown) =>
    JSON.stringify((group as { hooks?: unknown })?.hooks ?? '').includes('pet-hook.sh');
  const hooks: Record<string, unknown[]> = {};
  const existing = (settings.hooks ?? {}) as Record<string, unknown[]>;
  for (const [event, groups] of Object.entries(existing))
    hooks[event] = Array.isArray(groups) ? groups.filter((g) => !isPet(g)) : groups;
  for (const [event, matcher, state] of wanted) {
    hooks[event] ??= [];
    hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [run(state)] });
  }
  return { ...settings, hooks };
}
