#!/bin/bash
#
# upgrade-dependencies.sh
#
# Upgrades npm dependencies for all packages and plugins.
# Runs `npm upgrade` in each package under packages/ and plugins/dist/
#

set -e

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Upgrading npm dependencies ===${NC}"
echo ""

# Function to upgrade a directory
upgrade_dir() {
    local dir="$1"
    local name="$(basename "$dir")"

    # Skip if no package.json
    if [[ ! -f "$dir/package.json" ]]; then
        echo -e "${YELLOW}Skipping $name (no package.json)${NC}"
        return
    fi

    echo -e "${GREEN}Upgrading: $name${NC}"
    cd "$dir"
    npm upgrade
    echo ""
}

# Upgrade packages
echo -e "${BLUE}--- Packages ---${NC}"
for dir in "$ROOT_DIR/packages"/*; do
    if [[ -d "$dir" ]]; then
        upgrade_dir "$dir"
    fi
done

# Upgrade plugins
echo -e "${BLUE}--- Plugins ---${NC}"
for dir in "$ROOT_DIR/plugins/dist"/*; do
    if [[ -d "$dir" ]]; then
        upgrade_dir "$dir"
    fi
done

echo -e "${BLUE}=== Done ===${NC}"
