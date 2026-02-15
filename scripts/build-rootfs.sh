#!/usr/bin/env bash
# build-rootfs.sh — Export the Quilltap Docker image as a rootfs tarball
#
# The resulting tarball contains /app/ from the Docker production/wsl2 stage:
# standalone Next.js output, node_modules, and plugins.
#
# Usage:
#   ./scripts/build-rootfs.sh                         # build for host arch (arm64 on macOS)
#   ./scripts/build-rootfs.sh --platform linux/amd64  # build amd64 rootfs (for Windows/WSL2)
#   ./scripts/build-rootfs.sh --no-rebuild            # skip build if Docker image already exists
#   ./scripts/build-rootfs.sh --image TAG             # export from a specific existing image
#
# Output:
#   <cache-dir>/quilltap-linux-<arch>.tar.gz  (used by VM)
#   quilltap-linux-<arch>.tar.gz              (local copy)
#
# Prerequisites:
#   - Docker (with buildx for multi-platform builds)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read version from package.json
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")

# Defaults — detect host architecture
SKIP_REBUILD=false
CUSTOM_IMAGE=""

# Detect default platform from host
case "$(uname -m)" in
  arm64|aarch64) DEFAULT_PLATFORM="linux/arm64" ;;
  x86_64|amd64)  DEFAULT_PLATFORM="linux/amd64" ;;
  *)             DEFAULT_PLATFORM="linux/amd64" ;;
esac
PLATFORM="$DEFAULT_PLATFORM"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-rebuild)
      SKIP_REBUILD=true
      shift
      ;;
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --image)
      CUSTOM_IMAGE="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--no-rebuild] [--platform linux/amd64|linux/arm64] [--image TAG]"
      echo ""
      echo "  --no-rebuild       Skip Docker build if image already exists"
      echo "  --platform PLAT    Target platform (default: auto-detected from host)"
      echo "  --image TAG        Export from an existing Docker image instead of building"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Derive arch label and Docker target from platform
case "$PLATFORM" in
  linux/arm64)
    ARCH_LABEL="arm64"
    DOCKER_TARGET="production"
    ;;
  linux/amd64)
    ARCH_LABEL="amd64"
    DOCKER_TARGET="wsl2"
    ;;
  *)
    echo "Unsupported platform: $PLATFORM" >&2
    exit 1
    ;;
esac

IMAGE_TAG="${CUSTOM_IMAGE:-quilltap-rootfs-${ARCH_LABEL}:${VERSION}}"
CONTAINER_NAME="quilltap-rootfs-export-$$"
OUTPUT_FILENAME="quilltap-linux-${ARCH_LABEL}.tar.gz"
OUTPUT_FILE="$PROJECT_ROOT/$OUTPUT_FILENAME"

# Determine cache directory based on OS
if [[ "$(uname -s)" == "Darwin" ]]; then
  IMAGES_DIR="$HOME/Library/Caches/Quilltap/lima-images"
elif [[ -n "${LOCALAPPDATA:-}" ]]; then
  # Windows (Git Bash / MSYS2)
  IMAGES_DIR="$LOCALAPPDATA/Quilttap/vm-images"
else
  # Linux / fallback
  IMAGES_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/quilltap/vm-images"
fi

echo "==> Building Quilltap rootfs tarball"
echo "    Version:  $VERSION"
echo "    Platform: $PLATFORM"
echo "    Target:   $DOCKER_TARGET"
echo "    Image:    $IMAGE_TAG"
echo "    Output:   $OUTPUT_FILE"
echo ""

# Step 1: Build the Docker image (if needed)
if [ -z "$CUSTOM_IMAGE" ]; then
  if docker image inspect "$IMAGE_TAG" > /dev/null 2>&1 && [ "$SKIP_REBUILD" = true ]; then
    echo "==> Step 1/5: Docker image '$IMAGE_TAG' already exists, skipping build (--no-rebuild)"
  else
    echo "==> Step 1/5: Building Docker ${DOCKER_TARGET} image..."
    docker build \
      --platform "$PLATFORM" \
      --target "$DOCKER_TARGET" \
      -t "$IMAGE_TAG" \
      "$PROJECT_ROOT"
  fi
else
  echo "==> Step 1/5: Using existing image '$IMAGE_TAG'"
fi

# Step 2: Create a temporary container (not started)
echo "==> Step 2/5: Creating temporary container..."
CONTAINER_ID=$(docker create --platform "$PLATFORM" --name "$CONTAINER_NAME" "$IMAGE_TAG")

# Step 3: Export the filesystem and add VERSION file
echo "==> Step 3/5: Exporting filesystem..."
docker export "$CONTAINER_ID" | gzip > "$OUTPUT_FILE.tmp"

# Add VERSION file into the tarball
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/app"
echo "$VERSION" > "$TMPDIR/app/VERSION"

# Decompress, append VERSION, recompress
gunzip -c "$OUTPUT_FILE.tmp" > "$OUTPUT_FILE.tar.tmp"
tar -rf "$OUTPUT_FILE.tar.tmp" -C "$TMPDIR" app/VERSION
gzip -c "$OUTPUT_FILE.tar.tmp" > "$OUTPUT_FILE"
rm -f "$OUTPUT_FILE.tmp" "$OUTPUT_FILE.tar.tmp"
rm -rf "$TMPDIR"

# Step 4: Copy to cache directory and write build ID sidecar
echo "==> Step 4/5: Copying to cache directory..."
mkdir -p "$IMAGES_DIR"
cp "$OUTPUT_FILE" "$IMAGES_DIR/$OUTPUT_FILENAME"

# Write build ID sidecar so Electron can detect tarball updates
BUILD_ID="${VERSION}+$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BUILD_ID_FILE="$IMAGES_DIR/${OUTPUT_FILENAME}.build-id"
echo "$BUILD_ID" > "$BUILD_ID_FILE"
echo "    Build ID: $BUILD_ID"

# Step 5: Clean up Docker container
echo "==> Step 5/5: Cleaning up..."
docker rm "$CONTAINER_ID" > /dev/null

echo ""
echo "==> Done! Rootfs tarball ready."
echo "    Local copy: $OUTPUT_FILE"
echo "    Cache:      $IMAGES_DIR/$OUTPUT_FILENAME"
echo "    Build ID:   $BUILD_ID_FILE"
echo "    Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo "    Version: $VERSION"
