import { contextBridge, ipcRenderer } from 'electron';

export interface SelectDirectoryOptions {
  title?: string;
  defaultPath?: string;
}

export interface SelectDirectoryResult {
  canceled: boolean;
  path: string | null;
}

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

  selectDirectory: (
    options?: SelectDirectoryOptions
  ): Promise<SelectDirectoryResult> => {
    return ipcRenderer.invoke('select-directory', options);
  },

  selectFile: (
    options?: SelectDirectoryOptions
  ): Promise<SelectDirectoryResult> => {
    return ipcRenderer.invoke('select-file', options);
  },

  getDefaultProjectsDir: (): Promise<string> => {
    return ipcRenderer.invoke('get-default-projects-dir');
  },
});
