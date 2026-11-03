import type { Mood, RGBA } from './sprites.ts';

/**
 * Small pixel people for the Office world: one per session, never the profile's pet. A look comes from the
 * session's id (so it stays the same person every time) and the profile's colour (their shirt). No Node
 * imports: the renderer draws these.
 */
export interface Look {
  skin: string;
  hair: string;
  style: 'short' | 'long' | 'cap';
  shirt: string;
}
export const agentWidth = 16;
export const agentRows = 20;

const skins = ['#f0c8a0', '#d9a577', '#b57c52', '#80553a'];
const hairs = ['#2a211c', '#5b3a24', '#c9a24a', '#8a8f94', '#a8452e'];
const styles: Look['style'][] = ['short', 'long', 'cap'];

const hash = (text: string) => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};
export function lookFor(seed: string, shirt: string): Look {
  const h = hash(seed);
  return {
    skin: skins[h % skins.length],
    hair: hairs[(h >>> 4) % hairs.length],
    style: styles[(h >>> 8) % styles.length],
    shirt,
  };
}

const rgba = (hex: string, a = 255): RGBA => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255, a];
};
const outline = rgba('#1d2420');
const pants = rgba('#34414a');
const shoe = rgba('#1d2420');

/**
 * One frame. `step` alternates the typing hands and the walking legs; `walking` swings the legs.
 * The top four rows are left for a marker above the head: ! (needs you), a tick (done) or z (asleep).
 */
export function drawAgent(look: Look, mood: Mood, step: number, walking: boolean, blink = false): RGBA[][] {
  const grid: RGBA[][] = Array.from({ length: agentRows }, () =>
    Array.from({ length: agentWidth }, () => [0, 0, 0, 0] as RGBA),
  );
  const put = (x: number, y: number, color: RGBA) => {
    if (x >= 0 && x < agentWidth && y >= 0 && y < agentRows) grid[y][x] = color;
  };
  const rect = (x: number, y: number, w: number, h: number, color: RGBA) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, color);
  };
  const skin = rgba(look.skin);
  const hair = rgba(look.hair);
  const shirt = rgba(look.shirt);
  const shade = [shirt[0] * 0.8, shirt[1] * 0.8, shirt[2] * 0.8, 255].map(Math.round) as RGBA;
  const asleep = mood === 'sleep';
  // Everything shifts one row down when asleep: the head droops.
  const top = 5 + (asleep ? 1 : 0);

  // Legs, then torso, then head, so the head sits over the shoulders.
  const swing = walking ? step % 2 : 0;
  rect(5, 14, 2, 3 - swing, pants);
  rect(8, 14, 2, 3 - (walking ? 1 - swing : 0), pants);
  rect(4, 17 - swing, 3, 1, shoe);
  rect(8, 17 - (walking ? 1 - swing : 0), 3, 1, shoe);
  rect(4, 9, 7, 5, shirt);
  rect(4, 13, 7, 1, shade);
  // Arms: down by default, hands forward when working, one raised when asking.
  const arm = (x: number, up: boolean, forward: boolean) => {
    if (up) {
      rect(x, 6, 1, 4, shirt);
      put(x, 5, skin);
    } else if (forward) {
      rect(x, 9, 1, 2, shirt);
      put(x + (x < 7 ? 1 : -1), 11 - (step % 2), skin);
    } else {
      rect(x, 9, 1, 4, shirt);
      put(x, 13, skin);
    }
  };
  const working = mood === 'working';
  arm(3, mood === 'ask', working);
  arm(11, false, working);
  // Head.
  rect(5, top, 5, 4, skin);
  if (look.style === 'long') {
    rect(4, top - 1, 7, 2, hair);
    rect(4, top + 1, 1, 4, hair);
    rect(10, top + 1, 1, 4, hair);
  } else if (look.style === 'cap') {
    rect(4, top - 1, 7, 2, rgba(look.shirt));
    rect(10, top, 2, 1, rgba(look.shirt));
  } else {
    rect(4, top - 1, 7, 2, hair);
    put(4, top + 1, hair);
    put(10, top + 1, hair);
  }
  const eyes = blink || asleep ? rgba('#6b5448') : outline;
  put(6, top + 2, eyes);
  put(9, top + 2, eyes);
  if (mood === 'done') put(7, top + 3, rgba('#a8524a'));

  // A one-pixel outline round the person, then the marker above.
  const base = grid.map((row) => row.map((p) => p[3] > 0));
  for (let y = 0; y < agentRows; y++)
    for (let x = 0; x < agentWidth; x++)
      if (!base[y][x] && (base[y - 1]?.[x] || base[y + 1]?.[x] || base[y][x - 1] || base[y][x + 1]))
        grid[y][x] = outline;
  if (mood === 'ask') {
    const yellow = rgba('#f2b632');
    rect(7, 0, 2, 2, yellow);
    rect(7, 3, 2, 1, yellow);
  } else if (mood === 'done') {
    const green = rgba('#3fb37f');
    for (const [x, y] of [
      [5, 2],
      [6, 3],
      [7, 2],
      [8, 1],
      [9, 0],
    ] as const)
      put(x + 1, y, green);
  } else if (asleep) {
    const blue = rgba('#7b9fd6');
    for (const [x, y] of [
      [10, 0],
      [11, 0],
      [12, 0],
      [11, 1],
      [10, 2],
      [11, 2],
      [12, 2],
    ] as const)
      put(x, y, blue);
  }
  return grid;
}
