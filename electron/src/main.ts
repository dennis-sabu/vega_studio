import { app, dialog, ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawnBackend, killBackend } from './backend';
import { createMainWindow } from './window';

// Repo root is two levels above electron/dist/main.js
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

// Register IPC handlers before the window exists so the renderer never waits.
ipcMain.on('get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.handle(
  'select-directory',
  async (
    _event,
    options?: { title?: unknown; defaultPath?: unknown }
  ): Promise<{ canceled: boolean; path: string | null }> => {
    const title =
      typeof options?.title === 'string' && options.title.trim().length > 0
        ? options.title.trim().slice(0, 120)
        : 'Select Directory';

    let defaultPath: string | undefined;
    if (
      typeof options?.defaultPath === 'string' &&
      options.defaultPath.trim().length > 0
    ) {
      const candidate = path.resolve(options.defaultPath.trim());
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        defaultPath = candidate;
      }
    }

    const dialogOptions: Electron.OpenDialogOptions = {
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  }
);

ipcMain.handle(
  'select-file',
  async (
    _event,
    options?: { title?: unknown; defaultPath?: unknown }
  ): Promise<{ canceled: boolean; path: string | null }> => {
    const title =
      typeof options?.title === 'string' && options.title.trim().length > 0
        ? options.title.trim().slice(0, 120)
        : 'Select File';

    let defaultPath: string | undefined;
    if (
      typeof options?.defaultPath === 'string' &&
      options.defaultPath.trim().length > 0
    ) {
      const candidate = path.resolve(options.defaultPath.trim());
      if (fs.existsSync(candidate)) {
        defaultPath = candidate;
      }
    }

    const dialogOptions: Electron.OpenDialogOptions = {
      title,
      defaultPath,
      properties: ['openFile'],
    };

    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, path: null };
    }

    return { canceled: false, path: result.filePaths[0] };
  }
);

ipcMain.handle('get-default-projects-dir', (): string => {
  return path.join(app.getPath('documents'), 'VEGA Studio Projects');
});

function startBackendInBackground(): void {
  if (isQuitting) return;
  console.log('[main] Spawning backend in background...');
  spawnBackend(REPO_ROOT)
    .then(() => {
      console.log('[main] Backend is ready');
    })
    .catch((err: Error) => {
      console.error('[main] Backend failed to start:', err.message);
    });
}

async function shutdownAndQuit(): Promise<void> {
  if (isQuitting) return;
  isQuitting = true;

  console.log('[main] Shutting down backend before quit...');
  try {
    await killBackend();
    console.log('[main] Backend terminated');
  } catch (err) {
    console.warn('[main] Error during backend shutdown:', (err as Error).message);
  }

  app.quit();
}

process.on('SIGINT', () => {
  void shutdownAndQuit();
});

process.on('SIGTERM', () => {
  void shutdownAndQuit();
});

app.on('ready', () => {
  console.log('[main] Electron app ready');
  console.log(`[main] Repo root: ${REPO_ROOT}`);

  // Create the window first and start the backend in parallel. The renderer
  // reports its own connection state via the health poll, so the UI never
  // blocks on the Python process becoming ready.
  console.log('[main] Creating main window...');
  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  startBackendInBackground();

  console.log('[main] Startup complete');
});

app.on('window-all-closed', () => {
  // Quit on all platforms (target is Linux desktop).
  console.log('[main] All windows closed — quitting');
  app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  void shutdownAndQuit();
});
