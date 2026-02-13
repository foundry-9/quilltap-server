#!/usr/bin/env bash
set -euo pipefail

# Get version from package.json
NEWRELEASE=$(node -e "console.log(require('./package.json').version)")

# Determine branch and channel tag
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "release" ]; then
  CHANNEL="latest"
elif [ "$BRANCH" = "main" ]; then
  CHANNEL="dev"
else
  # Use the part after the last slash, or the whole name if no slashes
  CHANNEL="${BRANCH##*/}"
fi

echo "Version: $NEWRELEASE"
echo "Branch:  $BRANCH"
echo "Channel: $CHANNEL"

BUILDPLATFORM=$(node -e "console.log(process.arch)")

docker login

if [ "$BUILDPLATFORM" = "x64" ]; then
  NATIVE="amd64"
  FOREIGN="arm64"
elif [ "$BUILDPLATFORM" = "arm64" ]; then
  NATIVE="arm64"
  FOREIGN="amd64"
else
  echo "Unknown platform: $BUILDPLATFORM"
  exit 1
fi

# Build native image with regular docker (fast)
docker build -t csebold/quilltap:$NEWRELEASE-$NATIVE -t csebold/quilltap:$CHANNEL-$NATIVE .
docker push csebold/quilltap:$NEWRELEASE-$NATIVE
docker push csebold/quilltap:$CHANNEL-$NATIVE

# Build foreign image with buildx (emulated, slower)
docker buildx build --platform linux/$FOREIGN --tag csebold/quilltap:$NEWRELEASE-$FOREIGN --tag csebold/quilltap:$CHANNEL-$FOREIGN --push .

# Create multi-platform manifests
docker buildx imagetools create --tag csebold/quilltap:$NEWRELEASE csebold/quilltap:$NEWRELEASE-amd64 csebold/quilltap:$NEWRELEASE-arm64
docker buildx imagetools create --tag csebold/quilltap:$CHANNEL csebold/quilltap:$CHANNEL-amd64 csebold/quilltap:$CHANNEL-arm64
