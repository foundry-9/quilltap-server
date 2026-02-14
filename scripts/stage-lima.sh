#!/bin/bash
# Stage Lima binaries into electron/resources/lima/ for Electron bundling.
# Copies only the files needed to run Quilltap's VM — not the full Lima install.
#
# Usage: ./scripts/stage-lima.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEST="$PROJECT_ROOT/electron/resources/lima"

# Find limactl — prefer Homebrew, fall back to PATH
if [ -x /opt/homebrew/bin/limactl ]; then
  LIMA_PREFIX="$(dirname "$(readlink -f /opt/homebrew/bin/limactl)")"
  LIMA_PREFIX="$(dirname "$LIMA_PREFIX")"
elif command -v limactl >/dev/null 2>&1; then
  LIMA_PREFIX="$(dirname "$(dirname "$(readlink -f "$(command -v limactl)")")")"
else
  echo "ERROR: limactl not found. Install Lima first: brew install lima"
  exit 1
fi

echo "Lima installation found at: $LIMA_PREFIX"
echo "Staging to: $DEST"

# Clean and create directory structure
rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/share/lima"

# Copy limactl binary
cp "$LIMA_PREFIX/bin/limactl" "$DEST/bin/limactl"
chmod +x "$DEST/bin/limactl"

# Copy guest agent (required for Lima to provision the VM)
GUEST_AGENT="$LIMA_PREFIX/share/lima/lima-guestagent.Linux-aarch64.gz"
if [ -f "$GUEST_AGENT" ]; then
  cp "$GUEST_AGENT" "$DEST/share/lima/"
  echo "Copied guest agent"
else
  echo "WARNING: Guest agent not found at $GUEST_AGENT"
fi

# Summary
echo ""
echo "Staged Lima files:"
find "$DEST" -type f -exec ls -lh {} \;
echo ""
du -sh "$DEST"
echo "Done. Run 'npm run electron:build' to package the app."
