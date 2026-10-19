import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { listPackage } from '@electron/asar';
const arch = process.env.HATSTAND_ARCH ?? (process.platform === 'win32' ? 'x64' : process.arch);
const resources =
  process.platform === 'darwin'
    ? `out/Hatstand-darwin-${arch}/Hatstand.app/Contents/Resources`
    : `out/Hatstand-win32-${arch}/resources`;
if (process.platform === 'darwin') await fs.access(path.join(resources, 'hatstand-macos'), fs.constants.X_OK);
const entries = listPackage(path.join(resources, 'app.asar')).map((name) => name.replaceAll('\\', '/'));
const allowed = ['/dist', '/resources', '/package.json', '/LICENSE'];
for (const entry of entries)
  if (!allowed.some((prefix) => entry === prefix || entry.startsWith(prefix + '/')))
    throw new Error(`Unexpected packaged entry: ${entry}`);
if (
  !entries.includes('/dist/main.cjs') ||
  !entries.includes('/dist/preload.cjs') ||
  !entries.includes('/dist/index.html') ||
  !entries.includes('/dist/notes.html')
)
  throw new Error('Required runtime files missing.');
async function walk(folder) {
  const results = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) results.push(...(await walk(file)));
    else if (entry.name !== 'SHA256SUMS.txt') results.push(file);
  }
  return results;
}
const artifacts = await walk('out/make');
if (!artifacts.length) throw new Error('No release artifacts found.');
if (
  process.platform === 'darwin' &&
  (!artifacts.some((file) => file.endsWith('.dmg')) || !artifacts.some((file) => file.endsWith('.zip')))
)
  throw new Error('Mac DMG and ZIP are required.');
const sums = [];
for (const file of artifacts) {
  const hash = createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
  sums.push(`${hash}  ${path.relative('out/make', file).replaceAll('\\', '/')}`);
}
await fs.writeFile('out/make/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(
  `Verified ${entries.length} allowlisted package entries; checksums written for ${artifacts.length} artifacts.`,
);
