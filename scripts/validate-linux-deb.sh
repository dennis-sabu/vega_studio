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
  if grep -Fq -- "--no-sandbox" "${DESKTOP_TMP}"; then
    echo "[validate-deb] ERROR: Desktop launcher inside .deb must never pass --no-sandbox." >&2
    exit 1
  fi
fi

echo "=== Checking AppArmor profile and maintainer scripts inside .deb ==="
APPARMOR_TMP="$(mktemp)"
POSTINST_TMP="$(mktemp)"
POSTRM_TMP="$(mktemp)"
trap 'rm -f "${CONTENTS_FILE}" "${DESKTOP_TMP}" "${APPARMOR_TMP}" "${POSTINST_TMP}" "${POSTRM_TMP}"' EXIT

for required_pattern in \
  "/opt/VEGA Studio/vega-studio" \
  "/opt/VEGA Studio/resources/app.asar" \
  "/opt/VEGA Studio/resources/apparmor-profile" \
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

dpkg-deb --fsys-tarfile "${DEB_PATH}" | tar -xO "./opt/VEGA Studio/resources/apparmor-profile" > "${APPARMOR_TMP}"
grep -Fq 'profile "vega-studio" "/opt/VEGA Studio/vega-studio" flags=(unconfined)' "${APPARMOR_TMP}"
grep -Fq 'userns,' "${APPARMOR_TMP}"

dpkg-deb -I "${DEB_PATH}" postinst > "${POSTINST_TMP}"
dpkg-deb -I "${DEB_PATH}" postrm > "${POSTRM_TMP}"
grep -Fq '/etc/apparmor.d/vega-studio' "${POSTINST_TMP}"
grep -Fq '/etc/apparmor.d/vega-studio' "${POSTRM_TMP}"
if grep -Ev '^[[:space:]]*#' "${POSTINST_TMP}" | grep -Eq '(--no-sandbox|sysctl)'; then
  echo "[validate-deb] ERROR: postinst must not reference --no-sandbox or sysctl." >&2
  exit 1
fi

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
  test -f "/opt/VEGA Studio/resources/apparmor-profile"
  if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1; then
    test -f "/etc/apparmor.d/vega-studio"
    aa-status 2>/dev/null | grep -Fq "vega-studio" || true
  fi

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

  # Verify clean removal without touching user data and clean AppArmor profile removal
  sudo apt-get remove -y vega-studio
  test ! -e "/etc/apparmor.d/vega-studio"
  echo "[validate-deb] Install -> smoke check -> uninstall lifecycle passed cleanly."
fi
