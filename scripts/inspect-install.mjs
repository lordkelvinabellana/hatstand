// Read-only inspection of launch-related strings in the installed application.
// Does not extract, modify, or redistribute Claude's code or access account data.
import fs from 'node:fs';
const input = process.argv[2];
if (!input) throw new Error('Pass the installed app.asar path.');
const fd = fs.openSync(input, 'r');
try {
  const prefix = Buffer.alloc(16);
  fs.readSync(fd, prefix, 0, 16, 0);
  const headerSize = prefix.readUInt32LE(4);
  const jsonSize = prefix.readUInt32LE(12);
  if (jsonSize > 10_000_000) throw new Error('Unexpected ASAR header');
  const data = Buffer.alloc(jsonSize);
  fs.readSync(fd, data, 0, jsonSize, 16);
  const header = JSON.parse(data.toString());
  function walk(tree, base = '') {
    for (const [name, item] of Object.entries(tree.files ?? {})) {
      const path = `${base}/${name}`;
      if (item.files) walk(item, path);
      else if (/\/build\/(index|main)[^/]*\.js$/.test(path) && !item.unpacked) {
        const buffer = Buffer.alloc(item.size);
        fs.readSync(fd, buffer, 0, item.size, 8 + headerSize + Number(item.offset));
        const source = buffer.toString();
        const needles = ['user-data-dir', 'requestSingleInstanceLock', 'setPath("userData"', "setPath('userData'", 'CLAUDE_CONFIG_DIR'];
        for (const needle of needles) {
          let start = 0, count = 0;
          while ((start = source.indexOf(needle, start)) !== -1 && count++ < 6) {
            console.log(JSON.stringify({file:path, needle, context:source.slice(Math.max(0,start-180),start+250)}));
            start += needle.length;
          }
        }
      }
    }
  }
  walk(header);
  console.log('Top-level entries:', Object.keys(header.files));
} finally { fs.closeSync(fd); }
