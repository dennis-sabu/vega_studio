#!/usr/bin/env bash
# Non-destructive post-install script for VEGA Studio Debian package.
# Never modifies /etc/udev rules, user groups, or user home directories.
set -e

INSTALL_DIR="/opt/VEGA Studio"
SANDBOX_BIN="${INSTALL_DIR}/chrome-sandbox"
APP_BIN="${INSTALL_DIR}/vega-studio"
SYMLINK_PATH="/usr/bin/vega-studio"

if [ -f "${SANDBOX_BIN}" ]; then
  chown root:root "${SANDBOX_BIN}" 2>/dev/null || true
  chmod 4755 "${SANDBOX_BIN}" 2>/dev/null || true
fi

if [ -x "${APP_BIN}" ] && [ -d "/usr/bin" ]; then
  ln -sf "${APP_BIN}" "${SYMLINK_PATH}" 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi

exit 0
