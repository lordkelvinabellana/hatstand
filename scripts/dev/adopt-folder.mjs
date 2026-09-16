// Attach an existing Claude profile folder (one containing `desktop` and `code`, such as
// those created by scripts/dev/probe.mjs) as a ClientDeck profile. Nothing is moved or
// copied; ClientDeck will never remove an attached folder.
//
// Usage: node scripts/dev/adopt-folder.mjs --name "Client A" <folder>
// Quit ClientDeck first; it reads attached folders when it starts.
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ProfileStore } from '../../src/core/store.ts';
import { dataRoot } from '../../src/core/paths.ts';
import { readBindings } from '../../src/core/settings.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { name: { type: 'string' }, label: { type: 'string', default: '' }, color: { type: 'string' } },
});
if (!values.name || positionals.length !== 1)
  throw new Error('Usage: node scripts/dev/adopt-folder.mjs --name "Client A" <folder>');
const folder = path.resolve(positionals[0]);
await fs.access(path.join(folder, 'desktop'));
const info = await fs.lstat(folder);
if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Choose an ordinary folder, not a link.');

const root = dataRoot(process.env.LOCALAPPDATA);
await fs.mkdir(root, { recursive: true });
const bindings = await readBindings(root);
if (Object.values(bindings).some((bound) => path.resolve(bound).toLowerCase() === folder.toLowerCase()))
  throw new Error('That folder is already attached to a profile. No changes made.');

const profile = await new ProfileStore(root).create({
  name: values.name,
  accountLabel: values.label,
  color: values.color,
  icon: values.name.slice(0, 2).toUpperCase(),
});
bindings[profile.id] = folder;
const file = path.join(root, 'bindings.json');
await fs.writeFile(`${file}.tmp`, JSON.stringify(bindings, null, 2), { mode: 0o600 });
await fs.rename(`${file}.tmp`, file);
console.log(`Attached ${folder} as "${profile.name}". Its session data stayed in place.`);
