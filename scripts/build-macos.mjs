import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

if (process.platform === 'darwin') {
  const arch = process.env.HATSTAND_ARCH ?? process.arch;
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Build arm64 or x64 separately.');
  await fs.mkdir('resources/bin', { recursive: true });
  execFileSync(
    'xcrun',
    [
      'swiftc',
      '-O',
      '-target',
      `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`,
      'native/macos.swift',
      '-o',
      'resources/bin/hatstand-macos',
    ],
    { stdio: 'inherit' },
  );
}
