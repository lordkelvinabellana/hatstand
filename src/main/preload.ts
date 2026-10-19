import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('hatstand', {
  request: async (action: string, payload?: unknown) => {
    const result = await ipcRenderer.invoke('hatstand:request', { action, payload });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onChange: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('hatstand:changed', listener);
    return () => ipcRenderer.removeListener('hatstand:changed', listener);
  },
});
contextBridge.exposeInMainWorld('notes', {
  request: async (action: string, payload?: unknown) => {
    const result = await ipcRenderer.invoke('notes:request', { action, payload });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onChange: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('notes:changed', listener);
    return () => ipcRenderer.removeListener('notes:changed', listener);
  },
});
