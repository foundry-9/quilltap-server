#!/usr/bin/env bash
set -euo pipefail

# Quilltap Docker startup script
# Detects platform, sets sensible defaults, and starts the container.
#
# Usage:
#   ./scripts/start-quilltap.sh [options]
#
# Options:
#   -d, --data-dir DIR          Data directory on host (default: platform-specific)
#   -p, --port PORT             Host port (default: 3000)
#   -n, --name NAME             Container name (default: quilltap)
#   -t, --tag TAG               Image tag (default: latest)
#   -r, --redirect-ports PORTS  Comma-separated ports to forward to host (e.g., 11434,3030)
#   --no-auto-detect            Skip auto-detection of local services (Ollama, etc.)
#   -e, --env KEY=VALUE         Extra environment variable (repeatable)
#   --restart POLICY            Restart policy (default: unless-stopped)
#   --dry-run                   Print the docker command without running it
#   -h, --help                  Show this help message
#
# Environment variables (override defaults):
#   QUILLTAP_DATA_DIR           Data directory
#   QUILLTAP_PORT               Host port
#   QUILLTAP_CONTAINER_NAME     Container name
#   QUILLTAP_IMAGE_TAG          Image tag
#   HOST_REDIRECT_PORTS         Ports to forward to host

IMAGE="csebold/quilltap"

# Detect platform and set default data directory
detect_defaults() {
  case "$(uname -s)" in
    Darwin)
      PLATFORM="macos"
      DEFAULT_DATA_DIR="$HOME/Library/Application Support/Quilltap"
      ;;
    Linux)
      PLATFORM="linux"
      DEFAULT_DATA_DIR="$HOME/.quilltap"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      PLATFORM="windows"
      DEFAULT_DATA_DIR="${APPDATA:-$HOME/AppData/Roaming}/Quilltap"
      ;;
    *)
      PLATFORM="linux"
      DEFAULT_DATA_DIR="$HOME/.quilltap"
      ;;
  esac
}

detect_defaults

# Defaults (env vars override platform defaults)
DATA_DIR="${QUILLTAP_DATA_DIR:-$DEFAULT_DATA_DIR}"
PORT="${QUILLTAP_PORT:-3000}"
CONTAINER_NAME="${QUILLTAP_CONTAINER_NAME:-quilltap}"
IMAGE_TAG="${QUILLTAP_IMAGE_TAG:-latest}"
REDIRECT_PORTS="${HOST_REDIRECT_PORTS:-}"
RESTART_POLICY="unless-stopped"
DRY_RUN=false
AUTO_DETECT=true
EXTRA_ENVS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d|--data-dir)
      DATA_DIR="$2"; shift 2 ;;
    -p|--port)
      PORT="$2"; shift 2 ;;
    -n|--name)
      CONTAINER_NAME="$2"; shift 2 ;;
    -t|--tag)
      IMAGE_TAG="$2"; shift 2 ;;
    -r|--redirect-ports)
      REDIRECT_PORTS="$2"; shift 2 ;;
    --no-auto-detect)
      AUTO_DETECT=false; shift ;;
    -e|--env)
      EXTRA_ENVS+=("$2"); shift 2 ;;
    --restart)
      RESTART_POLICY="$2"; shift 2 ;;
    --dry-run)
      DRY_RUN=true; shift ;;
    -h|--help)
      sed -n '2,/^$/{ s/^# \?//; p }' "$0"
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1 ;;
  esac
done

# Auto-detect local services
if [ "$AUTO_DETECT" = true ]; then
  DETECTED_PORTS=()

  # Check for Ollama on port 11434
  if nc -z localhost 11434 2>/dev/null; then
    echo "Detected Ollama on port 11434"
    DETECTED_PORTS+=(11434)
  fi

  # Merge detected ports with any explicitly specified
  if [ ${#DETECTED_PORTS[@]} -gt 0 ]; then
    DETECTED_CSV=$(IFS=,; echo "${DETECTED_PORTS[*]}")
    if [ -n "$REDIRECT_PORTS" ]; then
      REDIRECT_PORTS="${REDIRECT_PORTS},${DETECTED_CSV}"
    else
      REDIRECT_PORTS="$DETECTED_CSV"
    fi
    # Deduplicate
    REDIRECT_PORTS=$(echo "$REDIRECT_PORTS" | tr ',' '\n' | sort -u | paste -sd ',' -)
  fi
fi

# Create data directory if it doesn't exist
if [ "$DRY_RUN" = false ]; then
  mkdir -p "$DATA_DIR"
fi

# Build docker run command
CMD=(docker run -d
  --name "$CONTAINER_NAME"
  --restart "$RESTART_POLICY"
  -p "${PORT}:3000"
  -v "$DATA_DIR:/app/quilltap"
)

# Add host port forwarding if requested
if [ -n "$REDIRECT_PORTS" ]; then
  CMD+=(-e "HOST_REDIRECT_PORTS=$REDIRECT_PORTS")
  # Linux needs explicit host.docker.internal mapping
  if [ "$PLATFORM" = "linux" ]; then
    CMD+=(--add-host=host.docker.internal:host-gateway)
  fi
fi

# Add extra environment variables
if [ ${#EXTRA_ENVS[@]} -gt 0 ]; then
  for env in "${EXTRA_ENVS[@]}"; do
    CMD+=(-e "$env")
  done
fi

# Image
CMD+=("${IMAGE}:${IMAGE_TAG}")

# Run or print
echo "Platform:  $PLATFORM"
echo "Data dir:  $DATA_DIR"
echo "Port:      $PORT"
echo "Container: $CONTAINER_NAME"
echo "Image:     ${IMAGE}:${IMAGE_TAG}"
if [ -n "$REDIRECT_PORTS" ]; then
  echo "Forwarding: $REDIRECT_PORTS"
fi
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "Dry run — would execute:"
  echo "  ${CMD[*]}"
else
  # Check if container already exists
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    echo "Container '$CONTAINER_NAME' already exists."
    if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
      echo "It's already running. Use 'docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME' to recreate."
    else
      echo "Starting existing container..."
      docker start "$CONTAINER_NAME"
    fi
    exit 0
  fi

  echo "Starting Quilltap..."
  "${CMD[@]}"
  echo ""
  echo "Quilltap is running at http://localhost:${PORT}"
fi
