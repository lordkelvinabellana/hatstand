module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'Hatstand',
    name: 'Hatstand',
    appBundleId: 'io.github.lordkelvinabellana.hatstand',
    icon: 'resources/hatstand.ico',
    ignore: (file) => {
      const relative = file.replaceAll('\\', '/');
      if (!relative) return false;
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
    { name: '@electron-forge/maker-zip', platforms: ['win32'] },
  ],
};
