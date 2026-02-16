#!/bin/sh
# wsl-init.sh — Entry point for Quilltap inside WSL2
#
# This script is baked into the WSL2 rootfs and launched by the Electron
# WSLManager. It sets up the environment and starts the Next.js server.
set -eu

export LIMA_CONTAINER=true
export NODE_ENV=production
export PORT=5050
export HOSTNAME=0.0.0.0
export NODE_OPTIONS="--max-old-space-size=2048"

# Resolve data directory: Electron passes the Windows path via env var,
# which we convert to a WSL mount path with wslpath.
if [ -n "${QUILLTAP_WIN_DATADIR:-}" ]; then
  QUILTTAP_DATA_DIR=$(wslpath "$QUILLTAP_WIN_DATADIR")
else
  QUILTTAP_DATA_DIR=/data/quilltap
fi
export QUILTTAP_DATA_DIR

mkdir -p "$QUILTTAP_DATA_DIR/data" \
         "$QUILTTAP_DATA_DIR/files" \
         "$QUILTTAP_DATA_DIR/logs" \
         "$QUILTTAP_DATA_DIR/plugins/npm"

# Remove Docker marker so app doesn't think it's in Docker
rm -f /.dockerenv

exec /usr/local/bin/node /app/server.js
