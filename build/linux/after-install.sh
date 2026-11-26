#!/usr/bin/env bash
# Non-destructive post-install / post-upgrade script for VEGA Studio Debian package.
# Never modifies /etc/udev rules, sysctl settings, user groups, or user home directories.
set -e

PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

INSTALL_DIR="/opt/VEGA Studio"
SANDBOX_BIN="${INSTALL_DIR}/chrome-sandbox"
APP_BIN="${INSTALL_DIR}/vega-studio"
SYMLINK_PATH="/usr/bin/vega-studio"
APPARMOR_PROFILE_SOURCE="${INSTALL_DIR}/resources/apparmor-profile"
APPARMOR_PROFILE_TARGET="/etc/apparmor.d/vega-studio"

if [ -x "${APP_BIN}" ] && [ -d "/usr/bin" ]; then
  ln -sf "${APP_BIN}" "${SYMLINK_PATH}" 2>/dev/null || true
fi

# Install and load the VEGA Studio AppArmor profile on Ubuntu 24.04+ (AppArmor 4.0+)
# so Chromium's namespace sandbox can use unprivileged user namespaces safely.
# Skips gracefully on non-AppArmor distros or older AppArmor versions (e.g. Ubuntu 22.04).
APPARMOR_PROFILE_ACTIVE=0
if [ -f "${APPARMOR_PROFILE_SOURCE}" ] && command -v apparmor_parser >/dev/null 2>&1; then
  if apparmor_status --enabled >/dev/null 2>&1 || aa-status --enabled >/dev/null 2>&1; then
    if apparmor_parser --skip-kernel-load --debug "${APPARMOR_PROFILE_SOURCE}" >/dev/null 2>&1; then
      if [ -d "/etc/apparmor.d" ]; then
        cp -f "${APPARMOR_PROFILE_SOURCE}" "${APPARMOR_PROFILE_TARGET}" 2>/dev/null || true
        chmod 0644 "${APPARMOR_PROFILE_TARGET}" 2>/dev/null || true
        if ! { [ -x "/usr/bin/ischroot" ] && /usr/bin/ischroot; }; then
          if apparmor_parser --replace --write-cache --skip-read-cache "${APPARMOR_PROFILE_TARGET}" 2>/dev/null; then
            APPARMOR_PROFILE_ACTIVE=1
          else
            echo "[vega-studio] Warning: could not load AppArmor profile ${APPARMOR_PROFILE_TARGET}." >&2
          fi
        fi
      fi
    else
      echo "[vega-studio] Skipping AppArmor profile install (host AppArmor ABI does not support abi/4.0 userns)." >&2
    fi
  fi
fi

# Mirror electron-builder sandbox helper permissions: use 0755 when user namespaces
# are active/supported, and only set 4755 fallback when kernel userns are unavailable.
if [ -f "${SANDBOX_BIN}" ]; then
  if [ "${APPARMOR_PROFILE_ACTIVE}" -eq 1 ] || { [ -L /proc/self/ns/user ] && unshare --user true >/dev/null 2>&1; }; then
    chown root:root "${SANDBOX_BIN}" 2>/dev/null || true
    chmod 0755 "${SANDBOX_BIN}" 2>/dev/null || true
  else
    chown root:root "${SANDBOX_BIN}" 2>/dev/null || true
    chmod 4755 "${SANDBOX_BIN}" 2>/dev/null || true
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi

exit 0
