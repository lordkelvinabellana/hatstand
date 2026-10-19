import { build } from 'esbuild';
import fs from 'node:fs/promises';
import './make-icon.mjs';
import './build-macos.mjs';
await fs.mkdir('dist', { recursive: true });
await Promise.all([
  build({
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main.cjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    external: ['electron'],
    format: 'cjs',
  }),
  build({
    entryPoints: ['src/main/preload.ts'],
    outfile: 'dist/preload.cjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    external: ['electron'],
    format: 'cjs',
  }),
  build({
    entryPoints: ['src/brain/capture.ts'],
    outfile: 'dist/capture.cjs',
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
  }),
  build({
    entryPoints: ['src/ui/index.tsx'],
    outfile: 'dist/ui.js',
    bundle: true,
    platform: 'browser',
    target: 'chrome130',
    format: 'iife',
    jsx: 'automatic',
    minify: true,
  }),
]);
await fs.copyFile('src/ui/index.html', 'dist/index.html');
