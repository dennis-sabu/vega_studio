/**
 * Builds the production Next.js static bundle cleanly into frontend/out/
 * with VEGA_STATIC_EXPORT=1 and verifies local assets + zero localhost:3000 leaks.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
const OUT_DIR = path.join(FRONTEND_DIR, 'out');
const IS_WIN = process.platform === 'win32';

function walkFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function main() {
  const nextDir = path.join(FRONTEND_DIR, '.next');
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true, force: true });
  }
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }

  const frontendNextBin = path.join(FRONTEND_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
  const rootNextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const nextBin = fs.existsSync(frontendNextBin) ? frontendNextBin : rootNextBin;
  const command = fs.existsSync(nextBin)
    ? process.execPath
    : IS_WIN
      ? 'npx.cmd'
      : 'npx';
  const args = fs.existsSync(nextBin) ? [nextBin, 'build', FRONTEND_DIR] : ['next', 'build', FRONTEND_DIR];

  console.log('[build-frontend-export] Building production static export (VEGA_STATIC_EXPORT=1)...');
  const res = spawnSync(command, args, {
    cwd: FRONTEND_DIR,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      VEGA_STATIC_EXPORT: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });

  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);

  const requiredFiles = [
    path.join(OUT_DIR, 'index.html'),
    path.join(OUT_DIR, 'fonts', 'Geist-Variable.woff2'),
    path.join(OUT_DIR, 'fonts', 'GeistMono-600.woff2'),
    path.join(OUT_DIR, 'fonts', 'JetBrainsMono-Variable.woff2'),
    path.join(OUT_DIR, 'fonts', 'JetBrainsMono-Italic-Variable.woff2'),
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      throw new Error(`[build-frontend-export] Missing required static asset: ${file}`);
    }
  }

  const exportedFiles = walkFiles(OUT_DIR);
  const textFiles = exportedFiles.filter((f) => /\.(html|js|css|json|txt)$/i.test(f));
  const leaks = [];
  for (const file of textFiles) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('localhost:3000') || content.includes('127.0.0.1:3000')) {
      leaks.push(path.relative(OUT_DIR, file));
    }
  }

  if (leaks.length > 0) {
    throw new Error(
      `[build-frontend-export] Found development URLs (localhost:3000) in production bundle:\n  ${leaks.join('\n  ')}`
    );
  }

  console.log(`[build-frontend-export] Export verified cleanly (${exportedFiles.length} files in frontend/out).`);
}

main();
