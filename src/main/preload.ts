import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('clientdeck', {
  request: async (action: string, payload?: unknown) => {
    const result = await ipcRenderer.invoke('clientdeck:request', { action, payload });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onChange: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('clientdeck:changed', listener);
    return () => ipcRenderer.removeListener('clientdeck:changed', listener);
  },
});
