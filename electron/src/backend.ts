import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_READY_SIGNAL = 'VEGA Studio Backend started';
const BACKEND_TIMEOUT_MS = 15000;
const KILL_TIMEOUT_MS = 3000;

let backendProcess: child_process.ChildProcess | null = null;

function findPython(repoRoot: string): string {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(repoRoot, '.venv', 'Scripts', 'python.exe'),
          path.join(repoRoot, 'backend', '.venv', 'Scripts', 'python.exe'),
        ]
      : [
          path.join(repoRoot, '.venv', 'bin', 'python'),
          path.join(repoRoot, 'backend', '.venv', 'bin', 'python'),
        ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32' ? 'py' : 'python3';
}

function getPythonCommand(repoRoot: string): { command: string; args: string[] } {
  const command = findPython(repoRoot);
  if (command === 'py') {
    return { command, args: ['-3.12', '-m', 'app'] };
  }
  return { command, args: ['-m', 'app'] };
}

export function spawnBackend(repoRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const backendDir = path.join(repoRoot, 'backend');
    const { command, args } = getPythonCommand(repoRoot);

    console.log(`[backend] Spawning: ${command} ${args.join(' ')} in ${backendDir}`);

    const proc = child_process.spawn(command, args, {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    backendProcess = proc;

    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Backend did not become ready within ${BACKEND_TIMEOUT_MS}ms`));
      }
    }, BACKEND_TIMEOUT_MS);

    const checkReady = (text: string) => {
      if (!settled && text.includes(BACKEND_READY_SIGNAL)) {
        settled = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(`[backend:stdout] ${text}`);
      checkReady(text);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      process.stderr.write(`[backend:stderr] ${text}`);
      checkReady(text);
    });

    proc.on('error', (err) => {
      console.error('[backend] Failed to spawn process:', err.message);
      if (backendProcess === proc) {
        backendProcess = null;
      }
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    proc.on('exit', (code, signal) => {
      if (backendProcess === proc) {
        backendProcess = null;
      }
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Backend exited early (code=${code}, signal=${signal})`));
      } else {
        console.warn(`[backend] Process exited unexpectedly (code=${code}, signal=${signal})`);
      }
    });
  });
}

export function killBackend(): Promise<void> {
  return new Promise((resolve) => {
    const proc = backendProcess;
    if (!proc || proc.killed) {
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

    console.log(`[backend] Terminating PID ${pid}...`);

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
        // On Windows, SIGTERM is not reliably handled; terminate the process tree.
        child_process.exec(`taskkill /PID ${pid} /T /F`, (err) => {
          if (err) {
            try {
              process.kill(pid);
            } catch {
              // Process already exited.
            }
          }
        });
      } else {
        proc.kill('SIGTERM');
      }
    } catch (err) {
      console.warn('[backend] Error sending terminate signal:', (err as Error).message);
      cleanup();
      return;
    }

    forceKillTimer = setTimeout(() => {
      if (!proc.killed) {
        console.warn('[backend] Force-killing backend after timeout...');
        try {
          if (process.platform === 'win32') {
            process.kill(pid);
          } else {
            proc.kill('SIGKILL');
          }
        } catch {
          // Already dead.
        }
      }
      cleanup();
    }, KILL_TIMEOUT_MS);
  });
}

export function getBackendPid(): number | undefined {
  return backendProcess?.pid;
}
