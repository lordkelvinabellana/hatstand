import fs from 'node:fs/promises';
import { packager } from '@electron/packager';
import config from '../forge.config.cjs';
// Stale installers from earlier versions would otherwise be checksummed and uploaded.
await fs.rm('out/make', { recursive: true, force: true });
const paths = await packager({
  ...config.packagerConfig,
  dir: '.',
  out: 'out',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  prune: false,
});
console.log(paths.join('\n'));
