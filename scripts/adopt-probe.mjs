// Adopt the two profiles the user signed into. Credentials stay in place.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProfileStore } from '../src/core/store.ts';
import { ensurePlainDirectory } from '../src/core/launch.ts';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(process.env.LOCALAPPDATA, 'ClientDeck');
await ensurePlainDirectory(root);
const store = new ProfileStore(root);
if ((await store.load()).profiles.length) throw new Error('Profiles already exist. No changes made.');
const bindings = {};
for (const [index, label] of ['test-b', 'test-c'].entries()) {
  const folder = path.join(project, '.local', 'probe', label);
  await fs.access(path.join(folder, 'desktop'));
  const profile = await store.create({
    name: `Client ${index + 1}`,
    accountLabel: 'Signed in during setup',
    color: index === 0 ? 'teal' : 'amber',
    icon: `C${index + 1}`,
  });
  bindings[profile.id] = folder;
}
await fs.writeFile(path.join(root, 'bindings.json'), JSON.stringify(bindings, null, 2), { mode: 0o600 });
console.log('Registered two existing profiles. Their session data stayed in place.');
