import { app, BrowserWindow, dialog, Menu, nativeImage, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { logError, logInfo, logWarn } from './logger';

const DEV_SERVER_URL = 'http://localhost:3000';
export const PACKAGED_APP_ORIGIN = 'app://vega-studio';
export const PACKAGED_ENTRY_URL = `${PACKAGED_APP_ORIGIN}/index.html`;
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

const SHOW_FALLBACK_MS = 2000;
const DEV_RETRY_MS = 400;
const DEV_MAX_RETRIES = 60;

export function resolveFrontendOutDir(repoRoot?: string): string {
  const baseRoot = app.isPackaged
    ? process.resourcesPath
    : repoRoot ?? path.join(__dirname, '..', '..');
  return path.resolve(baseRoot, 'frontend', 'out');
}

export function resolveAppIconPath(repoRoot?: string): string | undefined {
  const baseRoot = app.isPackaged
    ? process.resourcesPath
    : repoRoot ?? path.join(__dirname, '..', '..');
  const candidates = [
    path.join(baseRoot, 'build', 'icons', '256x256.png'),
    path.join(baseRoot, 'build', 'icon.png'),
    path.join(baseRoot, 'icons', '256x256.png'),
  ];
  return candidates.find((cand) => fs.existsSync(cand));
}

export function getTrustedUrlCheck(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (isDev) {
      const origin = `${parsed.protocol}//${parsed.host}`;
      return (
        origin === 'http://localhost:3000' ||
        origin === 'http://127.0.0.1:3000'
      );
    }
    return parsed.protocol === 'app:' && parsed.host === 'vega-studio';
  } catch {
    return false;
  }
}

function configureWindowChromeMenu(win: BrowserWindow): void {
  Menu.setApplicationMenu(null);
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
  win.removeMenu();
}

function attachDevShortcuts(win: BrowserWindow): void {
  if (!isDev) return;
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = input.key.toLowerCase();

    if (input.key === 'F12' || (mod && input.shift && key === 'i')) {
      event.preventDefault();
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }

    if ((mod && key === 'r') || input.key === 'F5') {
      event.preventDefault();
      if (input.shift) {
        win.webContents.reloadIgnoringCache();
      } else {
        win.webContents.reload();
      }
    }
  });
}

function loadErrorFallbackHtml(
  win: BrowserWindow,
  title: string,
  detail: string
): void {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const html = `<!doctype html><html><body style="margin:0;background:#000000;color:#f3f5fc;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="max-width:480px;padding:24px;border:1px solid rgba(255,255,255,0.16);border-radius:10px;background:rgba(10,12,18,0.96)"><h2 style="margin:0 0 8px;font-size:16px">${esc(title)}</h2><p style="margin:0;font-size:13px;opacity:0.85;line-height:1.5">${esc(detail)}</p></div></body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

export function createMainWindow(): BrowserWindow {
  const iconPath = resolveAppIconPath();
  const iconImage = iconPath ? nativeImage.createFromPath(iconPath) : undefined;
  const useWinOverlay = process.platform === 'win32';
  const useFramelessLinux = process.platform === 'linux';

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    title: 'VEGA Studio',
    autoHideMenuBar: true,
    ...(useWinOverlay
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            // Match the workspace toolbar background (#181818).
            // The frontend updates this via set-titlebar-overlay-color IPC
            // when switching between home and workspace mode.
            color: '#181818',
            symbolColor: '#f3f5fc',
            height: 38,
          },
        }
      : useFramelessLinux
        ? {
            frame: false,
          }
        : {}),
    ...(iconImage && !iconImage.isEmpty() ? { icon: iconImage } : {}),
    show: false,
    backgroundColor: '#000000',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  configureWindowChromeMenu(win);
  attachDevShortcuts(win);

  win.on('maximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-maximized-changed', true);
    }
  });
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window-maximized-changed', false);
    }
  });

  let shown = false;
  const showWindow = (): void => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
    logInfo('window', 'Main window ready and shown');
  };

  win.once('ready-to-show', showWindow);
  const showFallback = setTimeout(showWindow, SHOW_FALLBACK_MS);
  win.once('closed', () => clearTimeout(showFallback));

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(parsed.toString()).catch((err: Error) => {
          logWarn('window', `Failed opening external URL (${parsed.toString()}): ${err.message}`);
        });
      } else {
        logWarn('window', `Blocked external URL scheme: ${url}`);
      }
    } catch {
      logWarn('window', `Blocked invalid external URL: ${url}`);
    }
    return { action: 'deny' };
  });

  const blockUntrustedNav = (
    event: Electron.Event,
    navigationUrl: string,
    kind: string
  ): void => {
    if (navigationUrl.startsWith('data:text/html;charset=utf-8,')) {
      return;
    }
    if (!getTrustedUrlCheck(navigationUrl)) {
      logWarn('window', `Blocked ${kind} to untrusted target: ${navigationUrl}`);
      event.preventDefault();
    }
  };

  win.webContents.on('will-navigate', (event, navigationUrl) => {
    blockUntrustedNav(event, navigationUrl, 'will-navigate');
  });

  win.webContents.on('will-redirect', (event, navigationUrl) => {
    blockUntrustedNav(event, navigationUrl, 'will-redirect');
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logError(
      'window',
      `Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`
    );
    if (win.isDestroyed()) return;
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: 'VEGA Studio Renderer Crashed',
        message: 'The IDE interface process terminated unexpectedly.',
        detail: `Reason: ${details.reason} (code ${details.exitCode}). Would you like to reload the window?`,
        buttons: ['Reload Window', 'Close App'],
        defaultId: 0,
      })
      .then((choice) => {
        if (win.isDestroyed()) return;
        if (choice.response === 0) {
          win.reload();
        } else {
          app.quit();
        }
      });
  });

  win.on('unresponsive', () => {
    logWarn('window', 'Main window became unresponsive');
  });

  if (isDev) {
    let attempts = 0;

    const loadDevServer = (): void => {
      attempts += 1;
      logInfo('window', `Loading dev server: ${DEV_SERVER_URL} (attempt ${attempts})`);
      win.loadURL(DEV_SERVER_URL).catch((err: Error) => {
        logError('window', `Failed to load dev server: ${err.message}`);
      });
    };

    win.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        if (attempts >= DEV_MAX_RETRIES) {
          logError(
            'window',
            `Giving up after ${attempts} attempts: ${errorDescription}`
          );
          loadErrorFallbackHtml(
            win,
            'Frontend Server Unavailable',
            `Could not connect to ${DEV_SERVER_URL} (${errorDescription}). Verify 'npm run dev:frontend' is running.`
          );
          return;
        }
        setTimeout(loadDevServer, DEV_RETRY_MS);
      }
    );

    loadDevServer();
  } else {
    const outDir = resolveFrontendOutDir();
    const indexPath = path.join(outDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
      logError('window', `Production static export not found at ${indexPath}`);
      loadErrorFallbackHtml(
        win,
        'Production Frontend Bundle Missing',
        `Expected bundled UI assets at ${indexPath}. Rebuild using 'npm run build:frontend:export' or reinstall VEGA Studio.`
      );
    } else {
      logInfo('window', `Loading production bundle: ${PACKAGED_ENTRY_URL} (from ${outDir})`);
      win.loadURL(PACKAGED_ENTRY_URL).catch((err: Error) => {
        logError('window', `Failed to load production build: ${err.message}`);
      });
    }
  }

  return win;
}
