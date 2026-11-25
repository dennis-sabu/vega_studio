import { BrowserWindow, shell } from 'electron';
import * as path from 'path';

const DEV_SERVER_URL = 'http://localhost:3000';
const isDev = process.env.NODE_ENV !== 'production';

// Show the window even if the first paint is slow (Next dev compile), so the
// app feels instant instead of sitting invisible.
const SHOW_FALLBACK_MS = 2000;
const DEV_RETRY_MS = 400;
const DEV_MAX_RETRIES = 60;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    center: true,
    title: 'VEGA Studio',
    show: false,
    // Paint the window background immediately while the renderer loads.
    backgroundColor: '#06070c',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Nothing in the shell needs spellcheck; disabling it avoids a costly
      // dictionary load on first focus.
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  let shown = false;
  const showWindow = (): void => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
    console.log('[window] Main window ready and shown');
  };

  win.once('ready-to-show', showWindow);

  const showFallback = setTimeout(showWindow, SHOW_FALLBACK_MS);
  win.once('closed', () => clearTimeout(showFallback));

  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[window] Blocked window.open to: ${url}`);
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
      const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
      if (!allowedOrigins.includes(origin)) {
        console.warn(`[window] Blocked navigation to: ${navigationUrl}`);
        event.preventDefault();
      }
    } catch {
      console.warn(`[window] Blocked invalid navigation URL: ${navigationUrl}`);
      event.preventDefault();
    }
  });

  if (isDev) {
    let attempts = 0;

    const loadDevServer = (): void => {
      attempts += 1;
      console.log(`[window] Loading dev server: ${DEV_SERVER_URL} (attempt ${attempts})`);
      win.loadURL(DEV_SERVER_URL).catch((err: Error) => {
        console.error('[window] Failed to load dev server:', err.message);
      });
    };

    // The dev server may still be compiling its first page. Retry instead of
    // leaving the user on Electron's error screen.
    win.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED
        if (attempts >= DEV_MAX_RETRIES) {
          console.error(
            `[window] Giving up after ${attempts} attempts: ${errorDescription}`
          );
          return;
        }
        setTimeout(loadDevServer, DEV_RETRY_MS);
      }
    );

    loadDevServer();
  } else {
    const indexPath = path.join(__dirname, '..', '..', 'frontend', 'out', 'index.html');
    console.log(`[window] Loading production build: ${indexPath}`);
    win.loadFile(indexPath).catch((err: Error) => {
      console.error('[window] Failed to load production build:', err.message);
    });
  }

  return win;
}
