const mac = process.platform === 'darwin';
const signedRelease = process.env.HATSTAND_SIGN === '1';
if (signedRelease && (!process.env.APPLE_SIGNING_IDENTITY || !process.env.APPLE_NOTARY_PROFILE))
  throw new Error('Signed releases require APPLE_SIGNING_IDENTITY and APPLE_NOTARY_PROFILE.');

module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node_modules/sherpa-onnx*/**' },
    executableName: 'Hatstand',
    name: 'Hatstand',
    appBundleId: 'io.github.lordkelvinabellana.hatstand',
    icon: mac ? 'resources/hatstand.icns' : 'resources/hatstand.ico',
    ...(mac
      ? {
          extendInfo: {
            LSMinimumSystemVersion: '13.0',
            NSMicrophoneUsageDescription:
              'Hatstand listens while you hold the talk button, to turn your voice into text on this computer.',
            NSAppleEventsUsageDescription:
              'Hatstand opens a Claude Code session in the Claude window of the account it belongs to.',
          },
          appCategoryType: 'public.app-category.productivity',
          darwinDarkModeSupport: true,
          extraResource: ['resources/bin/hatstand-macos'],
          ...(signedRelease
            ? {
                osxSign: {
                  identity: process.env.APPLE_SIGNING_IDENTITY,
                  optionsForFile: () => ({
                    hardenedRuntime: true,
                    entitlements: 'resources/entitlements.plist',
                  }),
                },
                osxNotarize: { keychainProfile: process.env.APPLE_NOTARY_PROFILE },
              }
            : {}),
        }
      : {}),
    ignore: (file) => {
      const relative = file.replaceAll('\\', '/');
      if (!relative) return false;
      if (relative === '/resources/bin' || relative.startsWith('/resources/bin/')) return true;
      // The voice library and its per-platform binaries are the only modules shipped (everything else is bundled).
      if (relative === '/node_modules' || relative.startsWith('/node_modules/sherpa-onnx')) return false;
      return !['/dist', '/resources', '/package.json', '/LICENSE'].some(
        (prefix) => relative === prefix || relative.startsWith(prefix + '/'),
      );
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Hatstand',
        authors: 'Hatstand contributors',
        description: 'Manage client profiles for Claude Desktop.',
        setupIcon: 'resources/hatstand.ico',
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin'] },
    { name: './scripts/maker-dmg.cjs', platforms: ['darwin'] },
  ],
};
