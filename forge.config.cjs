module.exports = {
  packagerConfig: {asar:true, executableName:'ClientDeck', name:'ClientDeck', appBundleId:'dev.clientdeck.app',icon:'resources/clientdeck.ico',
    ignore:(file)=>{
      const relative=file.replaceAll('\\','/');
      if(!relative)return false;
      return !['/dist','/resources','/package.json','/LICENSE'].some(prefix=>relative===prefix||relative.startsWith(prefix+'/'));
    },
  },
  rebuildConfig:{},
  makers:[{name:'@electron-forge/maker-squirrel',config:{name:'ClientDeck',authors:'ClientDeck contributors',description:'Manage client profiles for Claude Desktop.',setupIcon:'resources/clientdeck.ico'}},{name:'@electron-forge/maker-zip',platforms:['win32']}],
};
