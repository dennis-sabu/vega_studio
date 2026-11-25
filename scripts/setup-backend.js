/**
 * setup-backend.js
 * Creates the Python virtual environment and installs backend dependencies.
 * Equivalent to: py -3.12 -m venv .venv && pip install -r requirements.txt -r requirements-dev.txt
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

function run(cmd, args, opts) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: isWin, ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1. Create venv
if (!fs.existsSync(venvDir)) {
  run('py', ['-3.12', '-m', 'venv', '.venv'], { cwd: backendDir });
} else {
  console.log('[setup-backend] .venv already exists, skipping creation.');
}

// 2. Install dependencies
run(pip, ['install', '-r', 'requirements.txt', '-r', 'requirements-dev.txt'], { cwd: backendDir });

console.log('\n[setup-backend] Backend setup complete.');
