import fs from 'node:fs/promises';
import { packager } from '@electron/packager';
import config from '../forge.config.cjs';
// Stale installers from earlier versions would otherwise be checksummed and uploaded.
await fs.rm('out/make', { recursive: true, force: true });
const paths = await packager({
  ...config.packagerConfig,
  dir: '.',
  out: 'out',
  platform: process.platform,
  arch: process.env.HATSTAND_ARCH ?? (process.platform === 'win32' ? 'x64' : process.arch),
  overwrite: true,
  prune: false,
});
console.log(paths.join('\n'));
