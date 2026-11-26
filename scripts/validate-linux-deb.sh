#!/usr/bin/env bash
# Validates a built VEGA Studio Debian package on Ubuntu 24.04 x86_64.
# Usage:
#   bash scripts/validate-linux-deb.sh [path-to.deb] [--install]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DO_INSTALL=0
DEB_PATH=""

for arg in "$@"; do
  if [ "$arg" = "--install" ]; then
    DO_INSTALL=1
  else
    DEB_PATH="$arg"
  fi
done

if [ -z "${DEB_PATH}" ]; then
  DEB_PATH="$(find "${REPO_ROOT}/release" -maxdepth 1 -name 'vega-studio_*.deb' | head -n 1 || true)"
fi

if [ -z "${DEB_PATH}" ] || [ ! -f "${DEB_PATH}" ]; then
  echo "[validate-deb] ERROR: No .deb package found. Build release first or pass path explicitly." >&2
  exit 1
fi

echo "=== Inspecting Debian package: ${DEB_PATH} ==="
DEB_INFO="$(dpkg-deb -I "${DEB_PATH}")"
echo "${DEB_INFO}"
if ! grep -Eq "^ Package: vega-studio$" <<< "${DEB_INFO}"; then
  echo "[validate-deb] ERROR: Expected Debian Package name 'vega-studio'." >&2
  exit 1
fi

CONTENTS_FILE="$(mktemp)"
DESKTOP_TMP="$(mktemp --suffix=.desktop)"
trap 'rm -f "${CONTENTS_FILE}" "${DESKTOP_TMP}"' EXIT
dpkg-deb -c "${DEB_PATH}" > "${CONTENTS_FILE}"

if command -v desktop-file-validate >/dev/null 2>&1; then
  dpkg-deb --fsys-tarfile "${DEB_PATH}" | tar -xO ./usr/share/applications/vega-studio.desktop > "${DESKTOP_TMP}"
  desktop-file-validate "${DESKTOP_TMP}"
fi

echo "=== Checking required payload paths inside .deb ==="
for required_pattern in \
  "/opt/VEGA Studio/vega-studio" \
  "/opt/VEGA Studio/resources/app.asar" \
  "/opt/VEGA Studio/resources/frontend/out/index.html" \
  "/opt/VEGA Studio/resources/frontend/out/fonts/JetBrainsMono-Variable.woff2" \
  "/opt/VEGA Studio/resources/backend/vega-backend/vega-backend" \
  "/usr/share/applications/vega-studio.desktop" \
  "/usr/share/icons/hicolor/256x256/apps/vega-studio.png"; do
  if ! grep -Fq "${required_pattern}" "${CONTENTS_FILE}"; then
    echo "[validate-deb] ERROR: Missing expected path in .deb: ${required_pattern}" >&2
    exit 1
  fi
done

echo "=== Auditing .deb against leaked secrets, tests, caches & venvs ==="
for forbidden_pattern in \
  "/.venv/" \
  "/backend/tests/" \
  "/.env" \
  ".sqlite" \
  ".db" \
  "__pycache__"; do
  if grep -Fq "${forbidden_pattern}" "${CONTENTS_FILE}"; then
    echo "[validate-deb] ERROR: Forbidden dev/secret artifact detected in .deb: ${forbidden_pattern}" >&2
    exit 1
  fi
done

echo "[validate-deb] Static .deb inspection passed cleanly."

if [ "${DO_INSTALL}" -eq 1 ]; then
  echo "=== Running install / verify / remove lifecycle test (sudo required) ==="
  sudo apt-get update -qq
  sudo apt-get install -y "${DEB_PATH}"

  test -x "/opt/VEGA Studio/vega-studio"
  test -f "/usr/share/applications/vega-studio.desktop"
  test -x "/opt/VEGA Studio/resources/backend/vega-backend/vega-backend"

  # Smoke test packaged backend binary using an isolated DATA_DIR
  SMOKE_DATA_DIR="$(mktemp -d)"
  SMOKE_PORT=18765
  DATA_DIR="${SMOKE_DATA_DIR}" APP_ENV=production HOST=127.0.0.1 PORT="${SMOKE_PORT}" \
    "/opt/VEGA Studio/resources/backend/vega-backend/vega-backend" >/tmp/vega-deb-smoke.log 2>&1 &
  BACK_PID=$!
  READY=0
  for _ in $(seq 1 40); do
    if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${SMOKE_PORT}/api/health" >/dev/null; then
      READY=1
      break
    fi
    sleep 0.25
  done
  kill -TERM "${BACK_PID}" 2>/dev/null || true
  wait "${BACK_PID}" 2>/dev/null || true
  rm -rf "${SMOKE_DATA_DIR}"
  if [ "${READY}" -ne 1 ]; then
    cat /tmp/vega-deb-smoke.log >&2 || true
    echo "[validate-deb] ERROR: Installed backend smoke test failed." >&2
    exit 1
  fi

  # Verify clean removal without touching user data
  sudo apt-get remove -y vega-studio
  echo "[validate-deb] Install -> smoke check -> uninstall lifecycle passed cleanly."
fi
