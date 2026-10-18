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
      // hdiutil sometimes fails with "Resource busy" on CI runners while macOS scans the
      // staging folder; that clears on its own, so retry a few times before giving up.
      for (let attempt = 1; ; attempt++) {
        try {
          await execute(
            '/usr/bin/hdiutil',
            ['create', '-volname', appName, '-srcfolder', staging, '-ov', '-format', 'UDZO', file],
            { timeout: 180_000 },
          );
          break;
        } catch (error) {
          if (attempt >= 4 || !/Resource busy/i.test(String(error.stderr ?? error.message))) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
        }
      }
      return [file];
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
};
