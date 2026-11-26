import { contextBridge, ipcRenderer } from 'electron';

export interface SelectDirectoryOptions {
  title?: string;
  defaultPath?: string;
}

export interface SelectDirectoryResult {
  canceled: boolean;
  path: string | null;
}

function sanitizeDialogOptions(options?: SelectDirectoryOptions): SelectDirectoryOptions | undefined {
  if (!options || typeof options !== 'object') return undefined;
  return {
    title: typeof options.title === 'string' ? options.title.slice(0, 120) : undefined,
    defaultPath:
      typeof options.defaultPath === 'string' ? options.defaultPath.slice(0, 512) : undefined,
  };
}

contextBridge.exposeInMainWorld('vegaStudio', {
  getBackendUrl: (): string => {
    try {
      return ipcRenderer.sendSync('get-backend-url') as string;
    } catch {
      return 'http://127.0.0.1:8765';
    }
  },

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
    return ipcRenderer.invoke('select-directory', sanitizeDialogOptions(options));
  },

  selectFile: (
    options?: SelectDirectoryOptions
  ): Promise<SelectDirectoryResult> => {
    return ipcRenderer.invoke('select-file', sanitizeDialogOptions(options));
  },

  getDefaultProjectsDir: (): Promise<string> => {
    return ipcRenderer.invoke('get-default-projects-dir');
  },

  windowControls: {
    mode: process.platform === 'win32' ? ('overlay' as const) : ('custom' as const),
    minimize: (): Promise<void> => ipcRenderer.invoke('window-minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window-toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window-close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
    onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => {
        cb(Boolean(maximized));
      };
      ipcRenderer.on('window-maximized-changed', listener);
      return () => {
        ipcRenderer.removeListener('window-maximized-changed', listener);
      };
    },
    setOverlayColor: (color: string, symbolColor?: string): Promise<void> =>
      ipcRenderer.invoke('set-titlebar-overlay-color', color, symbolColor),
  },
});
