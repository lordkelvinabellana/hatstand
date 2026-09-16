import { packager } from '@electron/packager';
import config from '../forge.config.cjs';
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
