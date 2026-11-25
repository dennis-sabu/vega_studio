const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const waitOn = require('wait-on');

const FRONTEND_URL = 'http://localhost:3000';
const TIMEOUT_MS = 60000;
const ELECTRON_DIR = path.join(__dirname, '..', 'electron');
const IS_WIN = process.platform === 'win32';

let child = null;
let build = null;
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (child && !child.killed) child.kill();
  if (build && !build.killed) build.kill();
  process.exit(code);
}

for (const sig of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM'])) {
  process.on(sig, () => shutdown(0));
}

function resolveElectronBinary() {
  try {
    const resolved = require('electron');
    if (typeof resolved === 'string' && fs.existsSync(resolved)) {
      return resolved;
    }
  } catch {
    // Fall through to the manual lookups below.
  }

  const candidates = [
    path.join(
      __dirname,
      '..',
      'node_modules',
      'electron',
      'dist',
      IS_WIN ? 'electron.exe' : 'electron'
    ),
    path.join(
      ELECTRON_DIR,
      'node_modules',
      'electron',
      'dist',
      IS_WIN ? 'electron.exe' : 'electron'
    ),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

// Compile the Electron main process while the Next dev server boots. These two
// steps are independent, so overlapping them removes the `tsc` wait from the
// critical path.
function buildElectron() {
  return new Promise((resolve, reject) => {
    let tscBin = null;
    try {
      tscBin = require.resolve('typescript/bin/tsc');
    } catch {
      tscBin = null;
    }

    const command = tscBin ? process.execPath : IS_WIN ? 'npm.cmd' : 'npm';
    const args = tscBin ? [tscBin, '-p', ELECTRON_DIR] : ['run', 'build'];

    console.log('[start-electron] Building Electron main process...');
    build = spawn(command, args, {
      cwd: ELECTRON_DIR,
      stdio: 'inherit',
      shell: !tscBin && IS_WIN,
    });

    build.on('error', reject);
    build.on('exit', (code) => {
      if (shuttingDown) return;
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Electron build failed (exit code ${code})`));
      }
    });
  });
}

const frontendReady = waitOn({
  resources: [FRONTEND_URL],
  timeout: TIMEOUT_MS,
  interval: 100,
  window: 100,
});

console.log('[start-electron] Waiting for frontend at', FRONTEND_URL, '...');

Promise.all([frontendReady, buildElectron()])
  .then(() => {
    if (shuttingDown) return;

    const electronBinary = resolveElectronBinary();
    if (!electronBinary) {
      throw new Error(
        'Could not locate the Electron binary. Run `npm install` at the repo root.'
      );
    }

    console.log('[start-electron] Frontend ready. Launching Electron...');
    child = spawn(electronBinary, ['dist/main.js'], {
      cwd: ELECTRON_DIR,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        shutdown(0);
        return;
      }
      shutdown(code ?? 0);
    });

    child.on('error', (err) => {
      console.error('[start-electron] Electron process error:', err.message);
      shutdown(1);
    });
  })
  .catch((err) => {
    console.error('[start-electron] Startup failed:', err.message);
    shutdown(1);
  });
