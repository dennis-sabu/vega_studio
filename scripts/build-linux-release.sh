#!/usr/bin/env bash
# End-to-end Ubuntu 24.04 x86_64 release pipeline for VEGA Studio (.deb + AppImage).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
if [ "${OS_NAME}" != "Linux" ]; then
  echo "[release] ERROR: Linux release packaging must be executed on Linux (detected: ${OS_NAME})." >&2
  exit 1
fi
if [ "${ARCH_NAME}" != "x86_64" ]; then
  echo "[release] ERROR: Ubuntu 24.04 x86_64 release requires x86_64 host (detected: ${ARCH_NAME})." >&2
  exit 1
fi

TARGETS="${VEGA_LINUX_TARGETS:-deb AppImage}"

echo "=== 1. Verifying version consistency ==="
node scripts/sync-version.js

echo "=== 2. Generating application icons ==="
node scripts/generate-icons.js

echo "=== 3. Checking backend venv & packaging dependencies ==="
if [ ! -x "backend/.venv/bin/python" ]; then
  echo "[release] Creating backend virtualenv..."
  python3 -m venv backend/.venv
fi
backend/.venv/bin/pip install --upgrade pip
backend/.venv/bin/pip install -r backend/requirements-packaging.txt

echo "=== 4. Building production frontend static export ==="
node scripts/build-frontend-export.js

echo "=== 5. Packaging standalone backend executable (PyInstaller) ==="
node scripts/build-backend.js

echo "=== 6. Compiling Electron main & preload ==="
npm run build:electron

echo "=== 7. Cleaning previous release outputs ==="
rm -rf "${REPO_ROOT}/release"
mkdir -p "${REPO_ROOT}/release"

echo "=== 8. Packaging Electron (${TARGETS}) ==="
# shellcheck disable=SC2086
npx --yes --prefix electron electron-builder --config electron/electron-builder.yml --linux ${TARGETS} --x64 --publish never

echo "=== 9. Computing release checksums ==="
(
  cd "${REPO_ROOT}/release"
  rm -f SHA256SUMS.txt
  shopt -s nullglob
  artifacts=(*.deb *.AppImage)
  if [ ${#artifacts[@]} -eq 0 ]; then
    echo "[release] ERROR: No .deb or .AppImage artifacts produced in release/." >&2
    exit 1
  fi
  sha256sum "${artifacts[@]}" > SHA256SUMS.txt
  chmod +x *.AppImage 2>/dev/null || true
)

echo ""
echo "=== VEGA Studio Linux Release Artifacts ==="
ls -lh "${REPO_ROOT}/release"
cat "${REPO_ROOT}/release/SHA256SUMS.txt"
