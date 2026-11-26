/**
 * Builds the frozen standalone FastAPI backend bundle via PyInstaller (--onedir)
 * into build/backend-dist/vega-backend/ and optionally executes a live loopback smoke test.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const SPEC_FILE = path.join(BACKEND_DIR, 'packaging', 'vega-backend.spec');
const DIST_BASE = path.join(REPO_ROOT, 'build', 'backend-dist');
const WORK_BASE = path.join(REPO_ROOT, 'build', 'backend-work');
const IS_WIN = process.platform === 'win32';

function resolveBackendPython() {
  const candidates = IS_WIN
    ? [
        path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe'),
        'python',
      ]
    : [
        path.join(BACKEND_DIR, '.venv', 'bin', 'python'),
        'python3',
      ];
  return candidates.find((p) => p === 'python' || p === 'python3' || fs.existsSync(p));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Port allocation failed')));
        return;
      }
      const p = addr.port;
      srv.close(() => resolve(p));
    });
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function smokeTestExecutable(binPath) {
  const port = await getFreePort();
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vega-backend-smoke-'));
  console.log(`[build-backend] Smoke-testing frozen executable on 127.0.0.1:${port} (DATA_DIR=${tempDataDir})...`);

  const proc = spawn(binPath, [], {
    cwd: tempDataDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: {
      ...process.env,
      APP_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: tempDataDir,
    },
  });

  let logs = '';
  proc.stdout.on('data', (d) => {
    logs += d.toString('utf8');
  });
  proc.stderr.on('data', (d) => {
    logs += d.toString('utf8');
  });

  try {
    let healthy = false;
    for (let i = 0; i < 40; i += 1) {
      if (proc.exitCode !== null) {
        throw new Error(`Frozen backend exited early (code=${proc.exitCode}):\n${logs}`);
      }
      try {
        const health = await httpGetJson(`http://127.0.0.1:${port}/api/health`);
        if (health.status === 'ok') {
          healthy = true;
          break;
        }
      } catch {
        // Retry briefly while uvicorn initializes
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!healthy) {
      throw new Error(`Frozen backend timed out waiting for /api/health.\n${logs}`);
    }

    const boards = await httpGetJson(`http://127.0.0.1:${port}/api/boards`);
    if (!Array.isArray(boards.boards) || boards.boards.length === 0) {
      throw new Error('Expected non-empty boards catalog from packaged backend.');
    }

    const docs = await httpGetJson(`http://127.0.0.1:${port}/api/docs`);
    if (!Array.isArray(docs.docs) || docs.docs.length === 0) {
      throw new Error('Expected bundled learning docs catalog from packaged backend.');
    }

    const examples = await httpGetJson(`http://127.0.0.1:${port}/api/examples`);
    if (!Array.isArray(examples.examples) || examples.examples.length === 0) {
      throw new Error('Expected bundled examples catalog from packaged backend.');
    }

    const ai = await httpGetJson(`http://127.0.0.1:${port}/api/ai/providers`);
    if (!ai || !Array.isArray(ai.providers)) {
      throw new Error('Expected AI provider registry from packaged backend.');
    }

    const sqliteDb = path.join(tempDataDir, 'vega_studio.db');
    if (!fs.existsSync(sqliteDb)) {
      throw new Error(`Expected SQLite state DB in DATA_DIR at ${sqliteDb}`);
    }

    console.log(
      `[build-backend] Smoke test passed (boards=${boards.boards.length}, docs=${docs.docs.length}, examples=${examples.examples.length}, providers=${ai.providers.length}).`
    );
  } finally {
    if (proc.exitCode === null) {
      if (IS_WIN && proc.pid) {
        spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        proc.kill('SIGTERM');
      }
    }
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tempDataDir, { recursive: true, force: true });
  }
}

async function main() {
  const skipSmoke = process.argv.includes('--no-smoke');
  const pythonExe = resolveBackendPython();
  if (!pythonExe) {
    throw new Error('No Python executable found to invoke PyInstaller.');
  }

  const pyiCheck = spawnSync(pythonExe, ['-m', 'PyInstaller', '--version'], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
    shell: false,
  });
  if (pyiCheck.error || pyiCheck.status !== 0) {
    throw new Error(
      "PyInstaller is not installed in backend environment. Run 'backend/.venv/bin/pip install -r backend/requirements-packaging.txt' (or equivalent on Windows)."
    );
  }

  fs.rmSync(DIST_BASE, { recursive: true, force: true });
  fs.rmSync(WORK_BASE, { recursive: true, force: true });
  fs.mkdirSync(DIST_BASE, { recursive: true });
  fs.mkdirSync(WORK_BASE, { recursive: true });

  console.log(`[build-backend] Running PyInstaller ${pyiCheck.stdout.trim()} on ${SPEC_FILE}...`);
  const build = spawnSync(
    pythonExe,
    [
      '-m',
      'PyInstaller',
      '--clean',
      '--noconfirm',
      '--distpath',
      DIST_BASE,
      '--workpath',
      WORK_BASE,
      SPEC_FILE,
    ],
    { cwd: BACKEND_DIR, stdio: 'inherit', shell: false }
  );

  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);

  const exeName = IS_WIN ? 'vega-backend.exe' : 'vega-backend';
  const binPath = path.join(DIST_BASE, 'vega-backend', exeName);
  if (!fs.existsSync(binPath)) {
    throw new Error(`Expected frozen binary missing at ${binPath}`);
  }
  if (!IS_WIN) {
    fs.chmodSync(binPath, 0o755);
  }

  if (!skipSmoke) {
    await smokeTestExecutable(binPath);
  }

  console.log(`[build-backend] Packaged backend ready at ${binPath}`);
}

main().catch((err) => {
  console.error('[build-backend] Failed:', err.message);
  process.exit(1);
});
