#!/usr/bin/env bash
# Non-destructive post-removal cleanup for VEGA Studio Debian package.
# Preserves user projects and ~/.local/share/vega-studio application data.
set -e

SYMLINK_PATH="/usr/bin/vega-studio"
if [ -L "${SYMLINK_PATH}" ] && [ ! -e "/opt/VEGA Studio/vega-studio" ]; then
  rm -f "${SYMLINK_PATH}" 2>/dev/null || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor 2>/dev/null || true
fi

exit 0
