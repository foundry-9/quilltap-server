#!/usr/bin/env bash
# Reads the version from package.json, tags the current commit, and pushes the tag.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=$(node -p "require('$REPO_DIR/package.json').version")
TAG="${VERSION}"

if git -C "$REPO_DIR" rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists." >&2
  exit 1
fi

if [ -n "$(git -C "$REPO_DIR" status --porcelain)" ]; then
  echo "Error: Working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

git -C "$REPO_DIR" tag -a "$TAG" -m "Release $TAG"
echo "Created tag $TAG"

git -C "$REPO_DIR" push origin "$TAG"
echo "Pushed tag $TAG to origin"
