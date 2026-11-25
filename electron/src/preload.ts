import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('vegaStudio', {
  getBackendUrl: (): string => 'http://127.0.0.1:8765',

  getVersion: (): string => {
    try {
      return ipcRenderer.sendSync('get-app-version') as string;
    } catch {
      return '0.0.0';
    }
  },

  getPlatform: (): NodeJS.Platform => process.platform,
});
