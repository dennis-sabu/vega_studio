/**
 * test-backend.js
 * Runs pytest in the backend virtualenv cleanly without shell injection/quoting issues.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');
const isWin = process.platform === 'win32';
const pytest = isWin
  ? path.join(backendDir, '.venv', 'Scripts', 'pytest.exe')
  : path.join(backendDir, '.venv', 'bin', 'pytest');

if (!fs.existsSync(pytest)) {
  console.error(
    `[test-backend] pytest not found at ${pytest}. Run 'npm run install:backend' first.`
  );
  process.exit(1);
}

const result = spawnSync(pytest, ['tests/', '-v'], {
  cwd: backendDir,
  stdio: 'inherit',
  shell: false,
});

if (result.error) {
  console.error('[test-backend] Failed to run pytest:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
