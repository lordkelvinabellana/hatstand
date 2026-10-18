import type { Color } from './profiles.ts';

/** Pixel pets, drawn from text grids. No Node imports: the manager window draws avatars with this too. */
export type Mood = 'sleep' | 'idle' | 'working' | 'ask' | 'done';

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
  // bear
  [
    '........',
    '........',
    '.ooo....',
    'obbbo...',
    'obdboooo',
    '.obbbbbb',
    'obbbbbbb',
    'obbkkbbb',
    'obbkkbbb',
    'obpbbwww',
    'obbbbwwk',
    'obbbbwww',
    '.obbbbbb',
    '..oooooo',
    '........',
    '........',
  ],
  // chick
  [
    '.......o',
    '......o.',
    '....oooo',
    '..oobbbb',
    '.obbbbbb',
    '.obbbbbb',
    'obbkkbbb',
    'obbkkbbb',
    'obpbbbrr',
    'obbbbbbr',
    'obbbbbbb',
    '.obbbbbb',
    '..oobbbb',
    '....oooo',
    '........',
    '........',
  ],
  // slime
  [
    '........',
    '........',
    '......oo',
    '....oobb',
    '...obbbb',
    '..obwbbb',
    '.obwbbbb',
    '.obbbbbb',
    'obbkkbbb',
    'obbkkbbb',
    'obbbbbbb',
    'obpbbbbb',
    'obbbbbbb',
    '.ooooooo',
    '........',
    '........',
  ],
  // robot
  [
    '.......r',
    '.......o',
    '.......o',
    '.ooooooo',
    '.obbbbbb',
    '.obddddd',
    '.obdwwdd',
    '.obdwwdd',
    '.obddddd',
    '.obbbbbb',
    'oobbbbbb',
    '.obbbobo',
    '.obbbbbb',
    '.ooooooo',
    '........',
    '........',
  ],
];
export const speciesNames = ['cat', 'frog', 'ghost', 'bunny', 'bear', 'chick', 'slime', 'robot'];

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
export type RGBA = [number, number, number, number];
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
