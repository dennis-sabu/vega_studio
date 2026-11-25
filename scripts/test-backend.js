/**
 * test-backend.js
 * Runs pytest in the backend virtualenv.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const isWin = process.platform === 'win32';
const pytest = isWin
  ? path.join(backendDir, '.venv', 'Scripts', 'pytest.exe')
  : path.join(backendDir, '.venv', 'bin', 'pytest');

const result = spawnSync(pytest, ['tests/', '-v'], {
  cwd: backendDir,
  stdio: 'inherit',
  shell: isWin,
});

if (result.error) {
  console.error('[test-backend] Failed to run pytest:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
