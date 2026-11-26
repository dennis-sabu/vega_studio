/**
 * setup-backend.js
 * Creates the Python virtual environment and installs backend dependencies
 * cleanly on both Windows and Linux (Ubuntu 24.04).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const backendDir = path.join(__dirname, '..', 'backend');
const isWin = process.platform === 'win32';
const venvDir = path.join(backendDir, '.venv');
const pip = isWin
  ? path.join(venvDir, 'Scripts', 'pip.exe')
  : path.join(venvDir, 'bin', 'pip');

function resolvePythonLauncher() {
  const candidates = isWin
    ? [
        { cmd: 'py', baseArgs: ['-3.12'] },
        { cmd: 'py', baseArgs: ['-3'] },
        { cmd: 'python', baseArgs: [] },
        { cmd: 'python3', baseArgs: [] },
      ]
    : [
        { cmd: 'python3', baseArgs: [] },
        { cmd: 'python', baseArgs: [] },
      ];

  for (const cand of candidates) {
    const check = spawnSync(
      cand.cmd,
      [...cand.baseArgs, '-c', 'import sys; print(sys.version_info[:2])'],
      { cwd: backendDir, encoding: 'utf8', shell: false }
    );
    if (!check.error && check.status === 0) {
      return cand;
    }
  }
  throw new Error(
    'Python 3.11+ interpreter not found. Install Python 3 before running setup-backend.'
  );
}

function run(cmd, args, opts) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1. Create venv cleanly across Windows and Ubuntu 24.04
if (!fs.existsSync(venvDir)) {
  const launcher = resolvePythonLauncher();
  run(launcher.cmd, [...launcher.baseArgs, '-m', 'venv', '.venv'], { cwd: backendDir });
} else {
  console.log('[setup-backend] .venv already exists, skipping creation.');
}

// 2. Install dependencies (never use shell: true on executable paths containing spaces)
run(pip, ['install', '-r', 'requirements.txt', '-r', 'requirements-dev.txt'], { cwd: backendDir });

console.log('\n[setup-backend] Backend setup complete.');
