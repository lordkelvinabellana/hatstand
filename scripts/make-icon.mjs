// Original geometric "C" mark rendered at every size Windows asks for (tray, taskbar,
// Explorer, installer). Each size is supersampled from the same vector description.
import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const background = [35, 101, 83];
const ink = [241, 248, 240];

// Shapes in a 64-unit design space.
function coverage(x, y) {
  const radius = 12;
  const cx = Math.min(Math.max(x, radius), 64 - radius);
  const cy = Math.min(Math.max(y, radius), 64 - radius);
  const inTile = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2 && x >= 2 && y >= 2 && x <= 62 && y <= 62;
  const inMark =
    (x >= 17 && x < 25 && y >= 16 && y < 48) ||
    (x >= 25 && x < 47 && ((y >= 16 && y < 24) || (y >= 40 && y < 48)));
  return { inTile, inMark };
}

function render(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let tile = 0;
      let mark = 0;
      for (let sy = 0; sy < samples; sy++)
        for (let sx = 0; sx < samples; sx++) {
          const c = coverage(
            ((x + (sx + 0.5) / samples) * 64) / size,
            ((y + (sy + 0.5) / samples) * 64) / size,
          );
          if (c.inTile) tile++;
          if (c.inTile && c.inMark) mark++;
        }
      const total = samples * samples;
      const i = (y * size + x) * 4;
      const m = tile ? mark / tile : 0;
      for (let channel = 0; channel < 3; channel++)
        pixels[i + channel] = Math.round(background[channel] * (1 - m) + ink[channel] * m);
      pixels[i + 3] = Math.round((255 * tile) / total);
    }
  return pixels; // RGBA, top-down
}

function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = ((size - 1 - y) * size + x) * 4;
      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
export function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [16, 20, 24, 32, 40, 48, 64, 256];
const images = sizes.map((size) => (size === 256 ? png(size, render(size)) : bmpEntry(size, render(size))));
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  directory[entry] = size === 256 ? 0 : size;
  directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
await fs.mkdir('resources', { recursive: true });
await fs.writeFile('resources/clientdeck.ico', Buffer.concat([directory, ...images]));
await fs.writeFile('resources/clientdeck.png', png(256, render(256)));
