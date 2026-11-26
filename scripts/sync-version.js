/**
 * Single-source version synchronization / verification script.
 * Root package.json is the canonical version authority for:
 *   - frontend/package.json
 *   - electron/package.json
 *   - backend/app/config.py (APP_VERSION)
 *
 * Usage:
 *   node scripts/sync-version.js           # Verify consistency (fails if mismatched)
 *   node scripts/sync-version.js --write   # Synchronize all manifests to root version
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT_PKG = path.join(REPO_ROOT, 'package.json');
const FRONTEND_PKG = path.join(REPO_ROOT, 'frontend', 'package.json');
const ELECTRON_PKG = path.join(REPO_ROOT, 'electron', 'package.json');
const BACKEND_CONFIG = path.join(REPO_ROOT, 'backend', 'app', 'config.py');

const writeMode = process.argv.includes('--write');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const rootPkg = readJson(ROOT_PKG);
  const targetVersion = String(rootPkg.version || '').trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(targetVersion)) {
    throw new Error(`Invalid root version '${targetVersion}' in ${ROOT_PKG}`);
  }

  const mismatches = [];

  for (const [label, filePath] of [
    ['frontend/package.json', FRONTEND_PKG],
    ['electron/package.json', ELECTRON_PKG],
  ]) {
    const pkg = readJson(filePath);
    if (pkg.version !== targetVersion) {
      mismatches.push(`${label}: ${pkg.version} != ${targetVersion}`);
      if (writeMode) {
        pkg.version = targetVersion;
        fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      }
    }
  }

  const configText = fs.readFileSync(BACKEND_CONFIG, 'utf8');
  const match = configText.match(/^(\s*APP_VERSION:\s*str\s*=\s*")([^"]+)(")/m);
  if (!match) {
    throw new Error(`Could not locate APP_VERSION in ${BACKEND_CONFIG}`);
  }
  if (match[2] !== targetVersion) {
    mismatches.push(`backend/app/config.py APP_VERSION: ${match[2]} != ${targetVersion}`);
    if (writeMode) {
      const updated = configText.replace(
        /^(\s*APP_VERSION:\s*str\s*=\s*")([^"]+)(")/m,
        `$1${targetVersion}$3`
      );
      fs.writeFileSync(BACKEND_CONFIG, updated, 'utf8');
    }
  }

  if (mismatches.length > 0 && !writeMode) {
    console.error('[sync-version] Version mismatches detected:\n  - ' + mismatches.join('\n  - '));
    console.error("Run 'node scripts/sync-version.js --write' to align all manifests.");
    process.exit(1);
  }

  console.log(`[sync-version] All components aligned at version ${targetVersion}`);
}

main();
