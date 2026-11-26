#!/usr/bin/env bash
# Non-destructive post-removal cleanup for VEGA Studio Debian package.
# Preserves user projects, ~/.local/share/vega-studio, and unrelated AppArmor profiles.
set -e

PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

ACTION="${1:-remove}"
SYMLINK_PATH="/usr/bin/vega-studio"
APPARMOR_PROFILE_TARGET="/etc/apparmor.d/vega-studio"

case "$ACTION" in
  remove|purge|disappear)
    if [ -f "${APPARMOR_PROFILE_TARGET}" ]; then
      if command -v apparmor_parser >/dev/null 2>&1 && { apparmor_status --enabled >/dev/null 2>&1 || aa-status --enabled >/dev/null 2>&1; }; then
        if ! { [ -x "/usr/bin/ischroot" ] && /usr/bin/ischroot; }; then
          apparmor_parser --remove "${APPARMOR_PROFILE_TARGET}" >/dev/null 2>&1 || true
        fi
      fi
      rm -f "${APPARMOR_PROFILE_TARGET}" 2>/dev/null || true
    fi

    if [ -L "${SYMLINK_PATH}" ] && [ ! -e "/opt/VEGA Studio/vega-studio" ]; then
      rm -f "${SYMLINK_PATH}" 2>/dev/null || true
    fi
    ;;
  upgrade|failed-upgrade|abort-install|abort-upgrade)
    # Keep the existing AppArmor profile loaded across upgrades until new postinst replaces it.
    ;;
esac

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi

exit 0
