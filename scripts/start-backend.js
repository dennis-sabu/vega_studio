const { spawn } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const isWin = process.platform === 'win32';
const python = isWin
  ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
  : path.join(backendDir, '.venv', 'bin', 'python');

const child = spawn(python, ['-m', 'app'], {
  cwd: backendDir,
  stdio: 'inherit',
});

for (const sig of /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM'])) {
  process.on(sig, () => {
    if (!child.killed) {
      child.kill(sig);
    }
  });
}

child.on('error', (err) => {
  console.error('[start-backend] Failed to start backend:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0);
  }
  process.exit(code ?? 0);
});
