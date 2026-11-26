import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { getActiveBackendUrl, killBackend, prepareBackendPort, spawnBackend } from './backend';
import { logError, logInfo, logWarn } from './logger';
import {
  createMainWindow,
  getTrustedUrlCheck,
  resolveFrontendOutDir,
} from './window';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function assertTrustedIpcOrigin(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const frameUrl = event.senderFrame?.url ?? '';
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    event.senderFrame &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    (frameUrl === '' || getTrustedUrlCheck(frameUrl))
  ) {
    return;
  }
  throw new Error(`Rejected untrusted IPC call from frame URL: ${frameUrl}`);
}

async function resolveSafeDefaultPath(
  rawPath: unknown,
  requireDir: boolean
): Promise<string | undefined> {
  if (typeof rawPath !== 'string') return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > 4096) return undefined;
  // Avoid triggering SMB stalls via UNC paths
  if (trimmed.startsWith('\\\\')) return undefined;
  let candidate = path.resolve(trimmed);
  for (let depth = 0; depth < 8; depth++) {
    try {
      const st = await fs.promises.stat(candidate);
      if (!requireDir || st.isDirectory()) return candidate;
      return path.dirname(candidate);
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return undefined;
}

ipcMain.on('get-app-version', (event) => {
  try {
    assertTrustedIpcOrigin(event);
    event.returnValue = app.getVersion();
  } catch {
    event.returnValue = '0.0.0';
  }
});

ipcMain.on('get-backend-url', (event) => {
  try {
    assertTrustedIpcOrigin(event);
    event.returnValue = getActiveBackendUrl();
  } catch {
    event.returnValue = 'http://127.0.0.1:8765';
  }
});

ipcMain.handle(
  'select-directory',
  async (
    event,
    options?: { title?: unknown; defaultPath?: unknown }
  ): Promise<{ canceled: boolean; path: string | null }> => {
    assertTrustedIpcOrigin(event);
    const title =
      typeof options?.title === 'string' && options.title.trim().length > 0
        ? options.title.trim().slice(0, 120)
        : 'Select Directory';

    const defaultPath = await resolveSafeDefaultPath(options?.defaultPath, true);
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
    event,
    options?: { title?: unknown; defaultPath?: unknown }
  ): Promise<{ canceled: boolean; path: string | null }> => {
    assertTrustedIpcOrigin(event);
    const title =
      typeof options?.title === 'string' && options.title.trim().length > 0
        ? options.title.trim().slice(0, 120)
        : 'Select File';

    const defaultPath = await resolveSafeDefaultPath(options?.defaultPath, false);
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

ipcMain.handle('get-default-projects-dir', (event): string => {
  assertTrustedIpcOrigin(event);
  try {
    return path.join(app.getPath('documents'), 'VEGA Studio Projects');
  } catch {
    return path.join(app.getPath('home'), 'VEGA Studio Projects');
  }
});

ipcMain.handle('window-minimize', (event): void => {
  assertTrustedIpcOrigin(event);
  mainWindow?.minimize();
});

ipcMain.handle('window-toggle-maximize', (event): boolean => {
  assertTrustedIpcOrigin(event);
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window-close', (event): void => {
  assertTrustedIpcOrigin(event);
  mainWindow?.close();
});

ipcMain.handle('window-is-maximized', (event): boolean => {
  assertTrustedIpcOrigin(event);
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return mainWindow.isMaximized();
});

ipcMain.handle(
  'set-titlebar-overlay-color',
  (event, color: unknown, symbolColor?: unknown): void => {
    assertTrustedIpcOrigin(event);
    if (process.platform !== 'win32') return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Validate hex color strings before passing to native API.
    const isHex = (v: unknown): v is string =>
      typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
    if (!isHex(color)) return;
    mainWindow.setTitleBarOverlay({
      color,
      symbolColor: isHex(symbolColor) ? symbolColor : '#f3f5fc',
      height: 38,
    });
  }
);

function configureSessionSecurity(): void {
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
      return getTrustedUrlCheck(requestingOrigin);
    }
    return false;
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const allowed =
      (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') &&
      getTrustedUrlCheck(details.requestingUrl);
    callback(allowed);
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const isDocument =
      details.resourceType === 'mainFrame' || details.resourceType === 'subFrame';
    if (!isDocument) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob:",
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function registerPackagedAppProtocol(): void {
  const outRoot = resolveFrontendOutDir(REPO_ROOT);

  protocol.handle('app', async (request) => {
    try {
      const parsed = new URL(request.url);
      if (parsed.host !== 'vega-studio') {
        return new Response('Forbidden host', { status: 403 });
      }

      const decodedPath = decodeURIComponent(parsed.pathname || '/');
      const normalizedRel = decodedPath.replace(/^\/+/, '') || 'index.html';
      let targetPath = path.resolve(outRoot, normalizedRel);

      const relToRoot = path.relative(outRoot, targetPath);
      if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
        return new Response('Forbidden path', { status: 403 });
      }

      let st: fs.Stats | null = null;
      try {
        st = await fs.promises.stat(targetPath);
      } catch {
        st = null;
      }

      if (st?.isDirectory()) {
        targetPath = path.join(targetPath, 'index.html');
        try {
          st = await fs.promises.stat(targetPath);
        } catch {
          st = null;
        }
      } else if (!st && !path.extname(targetPath)) {
        const htmlCandidate = `${targetPath}.html`;
        try {
          st = await fs.promises.stat(htmlCandidate);
          if (st.isFile()) {
            targetPath = htmlCandidate;
          }
        } catch {
          st = null;
        }
      }

      if (!st || !st.isFile()) {
        return new Response('Not found', { status: 404 });
      }

      return net.fetch(pathToFileURL(targetPath).toString());
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function startBackendInBackground(preselectedPort?: number): void {
  if (isQuitting) return;
  logInfo('main', 'Spawning backend in background...');
  spawnBackend(
    REPO_ROOT,
    (exitMsg) => {
      if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
        logWarn('main', `Backend exited while app running: ${exitMsg}`);
      }
    },
    preselectedPort
  )
    .then(() => {
      logInfo('main', `Backend ready at ${getActiveBackendUrl()}`);
    })
    .catch((err: Error) => {
      logError('main', `Backend failed to start: ${err.message}`);
      if (!isQuitting) {
        const hint = app.isPackaged
          ? 'Inspect logs in the VEGA Studio logs folder or reinstall the application package.'
          : "Verify development backend dependencies are installed ('npm run install:backend').";
        dialog.showErrorBox(
          'VEGA Studio Backend Error',
          `The local Python backend could not start:\n\n${err.message}\n\n${hint}`
        );
      }
    });
}

async function shutdownAndQuit(exitCode?: number): Promise<void> {
  if (isQuitting) return;
  isQuitting = true;

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.destroy();
    }
  }
  mainWindow = null;

  logInfo('main', 'Shutting down backend before quit...');
  try {
    await killBackend();
    logInfo('main', 'Backend terminated cleanly');
  } catch (err) {
    logWarn('main', `Error during backend shutdown: ${(err as Error).message}`);
  }

  if (typeof exitCode === 'number') {
    app.exit(exitCode);
  } else {
    app.quit();
  }
}

process.on('SIGINT', () => {
  void shutdownAndQuit();
});

process.on('SIGTERM', () => {
  void shutdownAndQuit();
});

process.on('uncaughtException', (err) => {
  logError('main', `Uncaught exception: ${err.stack || err.message}`);
  void shutdownAndQuit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logError('main', `Unhandled promise rejection: ${msg}`);
});

if (gotSingleInstanceLock) {
  app.on('ready', async () => {
    logInfo('main', `Electron app ready (packaged=${app.isPackaged})`);
    registerPackagedAppProtocol();
    configureSessionSecurity();

    // Reserve backend port before creating window so renderer getBackendUrl() is deterministic
    const backendPort = await prepareBackendPort();
    startBackendInBackground(backendPort);
    mainWindow = createMainWindow();

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('window-all-closed', () => {
    logInfo('main', 'All windows closed — quitting');
    if (!isQuitting) {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    void shutdownAndQuit();
  });
}
