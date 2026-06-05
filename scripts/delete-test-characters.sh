#!/usr/bin/env bash
#
# delete-test-characters.sh
#
# Deletes Quilltap test-fixture characters. The kill list is sourced from the
# CLI (`db characters status --json`), which sees rows owned by ALL users --
# including the ephemeral test-user ids the fixtures live under. The API list
# endpoint only returns the single-user's characters, so it cannot see them;
# but DELETE /api/v1/characters/[id] works by id regardless of owner.
#
# Selection is by EXACT name allowlist. "Vault Test Harness" is intentionally
# excluded, with a hard abort if it ever appears in the kill list.
#
# Safe by default: DRY RUN unless CONFIRM=1.
#
# Usage:
#   ./delete-test-characters.sh <instance>            # dry run -- lists what would go
#   CONFIRM=1 ./delete-test-characters.sh <instance>  # actually delete
#
# <instance> is REQUIRED -- the registered quilltap instance name (quilltap --instance).
#
# Env overrides:
#   BASE_URL        default http://localhost:3000
#   QT_NODE         default node
#   QT_CLI          default ~/source/quilltap-server/packages/quilltap/bin/quilltap.js
#   CONFIRM         0 (dry run) | 1 (delete)
#   CASCADE_CHATS   true | false  (delete chats exclusive to each character)
#   CASCADE_IMAGES  true | false  (delete images exclusive to each character)
#
set -euo pipefail

INSTANCE="${1:-}"
if [[ -z "$INSTANCE" ]]; then
  echo "Usage: $0 <instance>   (e.g. $0 Friday)" >&2
  echo "  <instance> is the registered quilltap instance name." >&2
  exit 2
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
QT_NODE="${QT_NODE:-node}"
QT_CLI="${QT_CLI:-$HOME/source/quilltap-server/packages/quilltap/bin/quilltap.js}"
CONFIRM="${CONFIRM:-0}"
CASCADE_CHATS="${CASCADE_CHATS:-true}"
CASCADE_IMAGES="${CASCADE_IMAGES:-true}"

# Exact names treated as deletable test fixtures.
# NOTE: "Vault Test Harness" is intentionally NOT here.
TEST_NAMES='[
  "API Created Chat Character",
  "App Smoke Character",
  "App Smoke Persona",
  "E2E Test Character",
  "File Attach Test Character"
]'

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required." >&2; exit 1; }
[[ -f "$QT_CLI" ]] || { echo "ERROR: quilltap CLI not found at $QT_CLI (set QT_CLI=)." >&2; exit 1; }

echo "Enumerating characters via CLI (instance=${INSTANCE}) ..."
CLI_JSON="$("$QT_NODE" "$QT_CLI" db characters status --json --instance "$INSTANCE")"

# Kill list: "id<TAB>name" for every character whose name is allowlisted.
KILL_LIST="$(jq -r --argjson names "$TEST_NAMES" '
  .characters[]
  | select(.name as $n | $names | index($n) != null)
  | "\(.id)\t\(.name)"
' <<<"$CLI_JSON")"

if [[ -z "$KILL_LIST" ]]; then
  echo "No matching test characters found. Nothing to do."
  exit 0
fi

# Hard safety net: never, ever touch Vault Test Harness.
if printf '%s\n' "$KILL_LIST" | grep -q 'Vault Test Harness'; then
  echo "ABORT: 'Vault Test Harness' appeared in the kill list. Refusing to proceed." >&2
  exit 1
fi

COUNT="$(printf '%s\n' "$KILL_LIST" | grep -c .)"
echo
echo "Matched ${COUNT} test character(s) for deletion (Vault Test Harness excluded by design):"
printf '%s\n' "$KILL_LIST" | sed 's/^/  - /'
echo

if [[ "$CONFIRM" != "1" ]]; then
  echo "DRY RUN -- nothing deleted."
  echo "Cascade settings if you proceed: chats=${CASCADE_CHATS}, images=${CASCADE_IMAGES}"
  echo "To actually delete, re-run:  CONFIRM=1 $0 $INSTANCE"
  exit 0
fi

echo "Deleting via API (cascadeChats=${CASCADE_CHATS}, cascadeImages=${CASCADE_IMAGES}) ..."
fail=0
while IFS=$'\t' read -r id name; do
  [[ -z "$id" ]] && continue
  printf '  %-30s %s ... ' "$name" "$id"
  if resp="$(curl -sS -X DELETE \
      "${BASE_URL}/api/v1/characters/${id}?cascadeChats=${CASCADE_CHATS}&cascadeImages=${CASCADE_IMAGES}")"; then
    echo "$resp"
  else
    echo "REQUEST FAILED"
    fail=1
  fi
done <<<"$KILL_LIST"

echo
if [[ "$fail" == "1" ]]; then
  echo "Done with at least one failure -- review output above."
else
  echo "Done. Re-run 'db characters status' to confirm (expect 22 characters)."
fi
