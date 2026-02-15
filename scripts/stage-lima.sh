#!/bin/bash
# Stage Lima binaries into electron/resources/lima/ for Electron bundling.
# Downloads Lima from GitHub Releases (cached locally) instead of requiring
# a Homebrew installation. Only needs curl (always available on macOS).
#
# Usage: ./scripts/stage-lima.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEST="$PROJECT_ROOT/electron/resources/lima"

# Read LIMA_VERSION from electron/constants.ts
LIMA_VERSION=$(grep "LIMA_VERSION = " "$PROJECT_ROOT/electron/constants.ts" | sed "s/.*= '//;s/'.*//" )
if [ -z "$LIMA_VERSION" ]; then
  echo "ERROR: Could not read LIMA_VERSION from electron/constants.ts"
  exit 1
fi
echo "Lima version: $LIMA_VERSION"

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  LIMA_ARCH="aarch64" ;;
  x86_64) LIMA_ARCH="x86_64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac
echo "Architecture: $LIMA_ARCH"

# Cache directory and tarball path
CACHE_DIR="$HOME/Library/Caches/Quilltap/lima-binaries"
TARBALL_NAME="lima-${LIMA_VERSION}-Darwin-${LIMA_ARCH}.tar.gz"
TARBALL_PATH="$CACHE_DIR/$TARBALL_NAME"
DOWNLOAD_URL="https://github.com/lima-vm/lima/releases/download/v${LIMA_VERSION}/${TARBALL_NAME}"

# Download if not cached
mkdir -p "$CACHE_DIR"
if [ -f "$TARBALL_PATH" ]; then
  echo "Using cached tarball: $TARBALL_PATH"
else
  echo "Downloading Lima $LIMA_VERSION from GitHub Releases..."
  echo "URL: $DOWNLOAD_URL"
  curl -fSL --progress-bar -o "$TARBALL_PATH.tmp" "$DOWNLOAD_URL"
  mv "$TARBALL_PATH.tmp" "$TARBALL_PATH"
  echo "Downloaded to: $TARBALL_PATH"
fi

# Clean and create destination directory structure
rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/share/lima"

# Extract only the files we need:
#   bin/limactl
#   share/lima/lima-guestagent.Linux-*.gz
echo "Extracting Lima binaries..."

# Extract limactl
tar -xzf "$TARBALL_PATH" -C "$DEST" bin/limactl
chmod +x "$DEST/bin/limactl"

# Extract all guest agents (supports both aarch64 and x86_64 guests)
tar -xzf "$TARBALL_PATH" -C "$DEST" --include='share/lima/lima-guestagent.Linux-*.gz' 2>/dev/null || \
  tar -xzf "$TARBALL_PATH" -C "$DEST" share/lima/lima-guestagent.Linux-aarch64.gz share/lima/lima-guestagent.Linux-x86_64.gz 2>/dev/null || \
  echo "WARNING: Could not extract guest agents — VM provisioning may fail"

# Summary
echo ""
echo "Staged Lima files:"
find "$DEST" -type f -exec ls -lh {} \;
echo ""
du -sh "$DEST"
echo "Done. Run 'npm run electron:build' to package the app."
