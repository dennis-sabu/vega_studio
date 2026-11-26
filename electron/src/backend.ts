import { app } from 'electron';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { logError, logInfo, logWarn } from './logger';

const BACKEND_READY_SIGNAL = 'VEGA Studio Backend started';
const DEFAULT_BACKEND_PORT = 8765;
const BACKEND_TIMEOUT_MS = 15000;
const KILL_TIMEOUT_MS = 3500;

let backendProcess: child_process.ChildProcess | null = null;
let activeBackendPort: number = DEFAULT_BACKEND_PORT;

function hasExited(proc: child_process.ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

export function getCanonicalBackendDataDir(): string {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return path.resolve(process.env.DATA_DIR.trim());
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData
      ? path.join(localAppData, 'VEGA Studio')
      : path.join(os.homedir(), 'AppData', 'Local', 'VEGA Studio');
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome && xdgDataHome.trim()) {
    return path.join(xdgDataHome.trim(), 'vega-studio');
  }
  return path.join(os.homedir(), '.local', 'share', 'vega-studio');
}

function resolveRuntimeRoot(repoRoot: string): string {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return repoRoot;
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.existsSync(candidate)) return false;
    const st = fs.statSync(candidate);
    if (!st.isFile()) return false;
    if (process.platform !== 'win32') {
      fs.accessSync(candidate, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function resolvePackagedBackendBinary(runtimeRoot: string): string | null {
  const exeName = process.platform === 'win32' ? 'vega-backend.exe' : 'vega-backend';
  const overridePath = process.env.VEGA_PACKAGED_BACKEND;
  if (overridePath && !app.isPackaged && isExecutableFile(overridePath)) {
    return path.resolve(overridePath);
  }
  const candidates = [
    path.join(runtimeRoot, 'backend', 'vega-backend', exeName),
    path.join(runtimeRoot, 'backend', exeName),
    path.join(runtimeRoot, 'build', 'backend-dist', 'vega-backend', exeName),
  ];
  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findPython(rootDir: string): string {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(rootDir, '.venv', 'Scripts', 'python.exe'),
          path.join(rootDir, 'backend', '.venv', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(rootDir, '.venv', 'bin', 'python'),
          path.join(rootDir, 'backend', '.venv', 'bin', 'python'),
        ];

  for (const candidate of candidates) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32' ? 'py' : 'python3';
}

function getPythonCommand(rootDir: string): { command: string; args: string[] } {
  const command = findPython(rootDir);
  if (command === 'py') {
    return { command, args: ['-3.12', '-m', 'app'] };
  }
  return { command, args: ['-m', 'app'] };
}

function checkPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Unable to allocate loopback port')));
        return;
      }
      const chosen = addr.port;
      srv.close(() => resolve(chosen));
    });
  });
}

function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/health',
        timeout: 1000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

export function getActiveBackendUrl(): string {
  return `http://127.0.0.1:${activeBackendPort}`;
}

export function getActiveBackendPort(): number {
  return activeBackendPort;
}

export async function spawnBackend(
  repoRoot: string,
  onUnexpectedExit?: (reason: string) => void
): Promise<void> {
  const runtimeRoot = resolveRuntimeRoot(repoRoot);
  const dataDir = getCanonicalBackendDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  let port = DEFAULT_BACKEND_PORT;
  const preferredFree = await checkPortFree(DEFAULT_BACKEND_PORT);
  if (!preferredFree) {
    port = await allocateFreePort();
    logWarn(
      'backend',
      `Default port ${DEFAULT_BACKEND_PORT} is occupied; selected free loopback port ${port}.`
    );
  }
  activeBackendPort = port;

  let command: string;
  let args: string[];
  let spawnCwd: string;
  let appEnv: string;

  if (app.isPackaged || process.env.VEGA_USE_PACKAGED_BACKEND === '1') {
    const packagedBin = resolvePackagedBackendBinary(runtimeRoot);
    if (!packagedBin) {
      throw new Error(
        `Bundled backend executable was not found or lacks execute permission under '${path.join(runtimeRoot, 'backend')}'.`
      );
    }
    command = packagedBin;
    args = [];
    spawnCwd = dataDir;
    appEnv = 'production';
  } else {
    const backendDir = path.join(runtimeRoot, 'backend');
    if (!fs.existsSync(backendDir)) {
      throw new Error(`Backend directory not found at '${backendDir}'.`);
    }
    const pyCmd = getPythonCommand(runtimeRoot);
    command = pyCmd.command;
    args = pyCmd.args;
    spawnCwd = backendDir;
    appEnv = process.env.APP_ENV || 'development';
  }

  logInfo(
    'backend',
    `Spawning: ${command}${args.length ? ` ${args.join(' ')}` : ''} on 127.0.0.1:${port} (cwd=${spawnCwd}, data=${dataDir})`
  );

  return new Promise((resolve, reject) => {
    const proc = child_process.spawn(command, args, {
      cwd: spawnCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        APP_ENV: appEnv,
        DATA_DIR: dataDir,
        PYTHONUNBUFFERED: '1',
        HOST: '127.0.0.1',
        PORT: String(port),
      },
    });
    backendProcess = proc;

    let settled = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const finishSuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(healthPoller);
      resolve();
    };

    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(healthPoller);
      reject(err);
    };

    const timeout = setTimeout(() => {
      if (!settled) {
        logError('backend', `Timed out waiting ${BACKEND_TIMEOUT_MS}ms for backend readiness`);
        void killBackend().finally(() => {
          finishError(
            new Error(`Backend did not become ready within ${BACKEND_TIMEOUT_MS}ms`)
          );
        });
      }
    }, BACKEND_TIMEOUT_MS);

    const healthPoller = setInterval(() => {
      if (settled || hasExited(proc)) return;
      void probeHealth(port).then((ok) => {
        if (ok) finishSuccess();
      });
    }, 350);

    const processBufferedLines = (chunk: string, isStderr: boolean) => {
      if (isStderr) {
        stderrBuf += chunk;
        const lines = stderrBuf.split(/\r?\n/);
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) {
            logWarn('backend:stderr', line);
          }
          if (line.includes(BACKEND_READY_SIGNAL)) finishSuccess();
        }
        if (stderrBuf.includes(BACKEND_READY_SIGNAL)) finishSuccess();
      } else {
        stdoutBuf += chunk;
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) {
            logInfo('backend:stdout', line);
          }
          if (line.includes(BACKEND_READY_SIGNAL)) finishSuccess();
        }
        if (stdoutBuf.includes(BACKEND_READY_SIGNAL)) finishSuccess();
      }
    };

    proc.stdout?.on('data', (data: Buffer) => {
      processBufferedLines(data.toString('utf8'), false);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      processBufferedLines(data.toString('utf8'), true);
    });

    proc.on('error', (err) => {
      logError('backend', `Failed to spawn backend process: ${err.message}`);
      if (backendProcess === proc) {
        backendProcess = null;
      }
      finishError(err);
    });

    proc.on('exit', (code, signal) => {
      if (backendProcess === proc) {
        backendProcess = null;
      }
      if (!settled) {
        finishError(
          new Error(`Backend exited early (code=${code}, signal=${signal})`)
        );
      } else {
        const msg = `Backend process exited unexpectedly (code=${code}, signal=${signal})`;
        logWarn('backend', msg);
        onUnexpectedExit?.(msg);
      }
    });
  });
}

export function killBackend(): Promise<void> {
  return new Promise((resolve) => {
    const proc = backendProcess;
    if (!proc || hasExited(proc)) {
      backendProcess = null;
      resolve();
      return;
    }

    const pid = proc.pid;
    if (pid === undefined) {
      backendProcess = null;
      resolve();
      return;
    }

    logInfo('backend', `Terminating backend PID ${pid}...`);

    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    const cleanup = () => {
      if (done) return;
      done = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }
      if (backendProcess === proc) {
        backendProcess = null;
      }
      resolve();
    };

    proc.once('exit', cleanup);

    try {
      if (process.platform === 'win32') {
        child_process.execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (err) => {
          if (err && !hasExited(proc)) {
            try {
              process.kill(pid);
            } catch {
              // Already dead
            }
          }
        });
      } else {
        // Send graceful SIGTERM to the entire detached process group first
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          proc.kill('SIGTERM');
        }
      }
    } catch (err) {
      logWarn('backend', `Error sending terminate signal: ${(err as Error).message}`);
      cleanup();
      return;
    }

    forceKillTimer = setTimeout(() => {
      if (!hasExited(proc)) {
        logWarn('backend', `Force-killing backend PID ${pid} after timeout...`);
        try {
          if (process.platform === 'win32') {
            child_process.execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {
              // ignore
            });
          } else {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch {
              proc.kill('SIGKILL');
            }
          }
        } catch {
          // Already dead
        }
      }
      cleanup();
    }, KILL_TIMEOUT_MS);
  });
}

export function getBackendPid(): number | undefined {
  return backendProcess?.pid;
}
