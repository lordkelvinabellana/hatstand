// Use Apple's hdiutil directly: the upstream DMG maker currently pulls an
// unpatched image-size parser. This maker does not process background images.
const { MakerBase } = require('@electron-forge/maker-base');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const execute = promisify(execFile);
module.exports = class NativeDMG extends MakerBase {
  name = 'native-dmg';
  defaultPlatforms = ['darwin'];
  isSupportedOnCurrentPlatform() {
    return process.platform === 'darwin';
  }
  async make({ dir, makeDir, appName, packageJSON, targetArch }) {
    const file = path.resolve(makeDir, `${appName}-${packageJSON.version}-${targetArch}.dmg`);
    await this.ensureFile(file);
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'hatstand-dmg-'));
    try {
      await execute('/usr/bin/ditto', [
        path.join(dir, `${appName}.app`),
        path.join(staging, `${appName}.app`),
      ]);
      await fs.symlink('/Applications', path.join(staging, 'Applications'));
      await execute(
        '/usr/bin/hdiutil',
        ['create', '-volname', appName, '-srcfolder', staging, '-ov', '-format', 'UDZO', file],
        { timeout: 180_000 },
      );
      return [file];
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
};
