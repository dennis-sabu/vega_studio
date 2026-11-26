/**
 * Cross-platform packaging configuration & asset integrity check.
 * Run via: node scripts/verify-packaging.js [--skip-build]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const skipBuild = process.argv.includes('--skip-build');

function assertFileExists(relPath) {
  const full = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required packaging file: ${relPath}`);
  }
  return fs.readFileSync(full, 'utf8');
}

function main() {
  // 1. Version alignment check
  const syncRes = spawnSync(process.execPath, [path.join(__dirname, 'sync-version.js')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: false,
  });
  if (syncRes.status !== 0) process.exit(syncRes.status ?? 1);

  // 2. Icons & desktop integration assets
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    assertFileExists(`build/icons/${size}x${size}.png`);
  }
  assertFileExists('build/icon.png');
  assertFileExists('build/vega-studio.svg');
  const desktop = assertFileExists('build/linux/vega-studio.desktop');
  if (!desktop.includes('StartupWMClass=vega-studio') || !desktop.includes('Icon=vega-studio')) {
    throw new Error('Desktop entry missing expected Icon or StartupWMClass fields.');
  }
  if (desktop.includes('--no-sandbox')) {
    throw new Error('Desktop entry must never pass --no-sandbox.');
  }

  const appArmorProfile = assertFileExists('build/linux/apparmor-profile');
  for (const token of ['abi <abi/4.0>', 'flags=(unconfined)', 'userns,']) {
    if (!appArmorProfile.includes(token)) {
      throw new Error(`build/linux/apparmor-profile missing expected AppArmor rule: ${token}`);
    }
  }

  const builderYml = assertFileExists('electron/electron-builder.yml');
  for (const token of [
    'appId: com.vega.studio',
    'productName: VEGA Studio',
    'executableName: vega-studio',
    'appArmorProfile: ../build/linux/apparmor-profile',
    'frontend/out',
    'backend/vega-backend',
    'target: deb',
    'target: AppImage',
  ]) {
    if (!builderYml.includes(token)) {
      throw new Error(`electron-builder.yml missing expected entry: ${token}`);
    }
  }

  // 3. Ensure release outputs are ignored by Git
  const gitignore = assertFileExists('.gitignore');
  for (const ignored of ['release/', '*.deb', '*.AppImage', 'SHA256SUMS.txt', 'frontend/out/']) {
    if (!gitignore.includes(ignored)) {
      throw new Error(`.gitignore must ignore generated artifact pattern: ${ignored}`);
    }
  }

  // 4. Verify non-destructive Linux install/uninstall hooks & AppArmor lifecycle (ignoring comments)
  const afterInstall = assertFileExists('build/linux/after-install.sh');
  const activeInstallLines = afterInstall
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
  if (!activeInstallLines.includes('/etc/apparmor.d/vega-studio') || !activeInstallLines.includes('apparmor_parser')) {
    throw new Error('after-install.sh must install and load /etc/apparmor.d/vega-studio when AppArmor is active.');
  }
  if (activeInstallLines.includes('--no-sandbox') || activeInstallLines.includes('sysctl')) {
    throw new Error('after-install.sh must never set --no-sandbox or modify sysctl.');
  }

  const afterRemove = assertFileExists('build/linux/after-remove.sh');
  const activeLines = afterRemove
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .join('\n');
  if (
    activeLines.includes('HOME') ||
    activeLines.includes('.local/share/vega-studio') ||
    activeLines.includes('/home/')
  ) {
    throw new Error('after-remove.sh must never touch user home directories or application data.');
  }
  if (!activeLines.includes('/etc/apparmor.d/vega-studio') || !activeLines.includes('apparmor_parser --remove')) {
    throw new Error('after-remove.sh must unload and remove /etc/apparmor.d/vega-studio on uninstall.');
  }

  // 5. Verify production frontend static export + bundled backend packaging spec
  assertFileExists('backend/packaging/entrypoint.py');
  assertFileExists('backend/packaging/vega-backend.spec');

  if (!skipBuild) {
    const expRes = spawnSync(
      process.execPath,
      [path.join(__dirname, 'build-frontend-export.js')],
      { cwd: REPO_ROOT, stdio: 'inherit', shell: false }
    );
    if (expRes.status !== 0) process.exit(expRes.status ?? 1);
  }

  console.log('[verify-packaging] All packaging integrity checks passed.');
}

main();
