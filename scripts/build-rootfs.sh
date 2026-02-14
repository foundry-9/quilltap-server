#!/usr/bin/env bash
# build-rootfs.sh — Export the Quilltap Docker production image as a rootfs tarball
#
# The resulting tarball contains /app/ from the Docker production stage:
# standalone Next.js output, node_modules, and plugins. The Lima VM provision
# script extracts /app/ from this tarball and installs Node.js separately via apk,
# so the VM retains full package management (apk add) for installing tools on the fly.
#
# Usage:
#   ./scripts/build-rootfs.sh              # build image + export (or reuse existing image)
#   ./scripts/build-rootfs.sh --rebuild    # force rebuild even if image exists
#   ./scripts/build-rootfs.sh --image TAG  # export from a specific existing image
#
# Output:
#   ~/Library/Caches/Quilltap/lima-images/quilltap-linux-arm64.tar.gz  (used by Lima VM)
#   quilltap-linux-arm64.tar.gz                                        (local copy)
#
# Prerequisites:
#   - Docker (with buildx for multi-platform builds)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Read version from package.json
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")
PLATFORM="linux/arm64"
IMAGE_TAG="quilltap-rootfs:${VERSION}"
CONTAINER_NAME="quilltap-rootfs-export-$$"
IMAGES_DIR="$HOME/Library/Caches/Quilltap/lima-images"
OUTPUT_FILE="$PROJECT_ROOT/quilltap-linux-arm64.tar.gz"
FORCE_REBUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild)
      FORCE_REBUILD=true
      shift
      ;;
    --image)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--rebuild] [--image TAG]"
      echo ""
      echo "  --rebuild    Force rebuild even if Docker image already exists"
      echo "  --image TAG  Export from an existing Docker image instead of building"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

echo "==> Building Quilltap rootfs tarball"
echo "    Version:  $VERSION"
echo "    Platform: $PLATFORM"
echo "    Image:    $IMAGE_TAG"
echo "    Output:   $OUTPUT_FILE"
echo ""

# Step 1: Build the Docker production image (if needed)
if docker image inspect "$IMAGE_TAG" > /dev/null 2>&1 && [ "$FORCE_REBUILD" = false ]; then
  echo "==> Step 1/5: Docker image '$IMAGE_TAG' already exists, skipping build"
  echo "    (use --rebuild to force a fresh build)"
else
  echo "==> Step 1/5: Building Docker production image..."
  docker build \
    --platform "$PLATFORM" \
    --target production \
    -t "$IMAGE_TAG" \
    "$PROJECT_ROOT"
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

# Step 4: Copy to Lima images directory
echo "==> Step 4/5: Copying to Lima images directory..."
mkdir -p "$IMAGES_DIR"
cp "$OUTPUT_FILE" "$IMAGES_DIR/quilltap-linux-arm64.tar.gz"

# Step 5: Clean up Docker container
echo "==> Step 5/5: Cleaning up..."
docker rm "$CONTAINER_ID" > /dev/null

echo ""
echo "==> Done! Rootfs tarball ready."
echo "    Local copy: $OUTPUT_FILE"
echo "    Lima mount: $IMAGES_DIR/quilltap-linux-arm64.tar.gz"
echo "    Size: $(du -h "$OUTPUT_FILE" | cut -f1)"
echo "    Version: $VERSION"
