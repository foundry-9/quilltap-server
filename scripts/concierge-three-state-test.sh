#!/usr/bin/env bash
#
# concierge-three-state-test.sh
# ---------------------------------------------------------------------------
# Acceptance checks for the Concierge per-chat danger-status three-state:
#
#   CT-1  Sidebar three-state control    (Moderated / Unmoderated / Locked)
#   CT-2  Locked and Unmoderated stay    (no auto-override out of Locked or
#         put                            Unmoderated; retired values rejected)
#   CT-3  State chosen at creation       (New Chat form's Concierge picker →
#                                        POST /api/v1/chats conciergeState)
#   CT-4  A refused picture is rerouted  (Concierge overhaul phase 1; opt-in —
#                                        needs a profile + prompt that a real
#                                        provider actually refuses)
#
# How it works (and why):
#   * State changes go through the HTTP PUT API — the exact code path the
#     Chat Sidebar uses (applyConciergeFlip). The Next.js server is the sole
#     DB writer, so we never write to the encrypted DB directly.
#   * Assertions are READ-ONLY quilltap CLI queries (`db --json`).
#   * The pill in the Salon header is a pure derivation of `conciergeMode`
#     (NULL reads as 'moderated') — verifying that column, plus its
#     provenance pair `conciergeModeSetBy` / `conciergeModeReason`, verifies
#     what the pill will render. `isDangerousChat` is classifier telemetry
#     only now — it is asserted just once, where the Moderated transition
#     clears it, and never used to derive state.
#   * CT-2's "scheduled-danger-scan skips it" is an absence-over-time fact, so
#     it's checked with --arm (stamp a baseline) / --recheck (after a real
#     ~10-min scan tick). CT-2's "chat-danger-classification bails at handler
#     entry" can't be forced from the CLI without writing to the live DB, so
#     it's covered by the existing jest guard suites (deterministic).
#
# Requires: a running dev server (npm run dev), jq, and the quilltap CLI.
#
# WARNING: each full run appends ~9 synthetic Concierge bubbles to the target
#          chat's history (they're honest "mode changed" announcements, but
#          they accumulate). Point this at a THROWAWAY / test chat, not a
#          conversation you care about. The chat's effective state is restored
#          at the end unless --keep is given.
#
# Usage:
#   scripts/concierge-three-state-test.sh --chat <chatId> [options]
#
#   --chat <id>        Target chat UUID (required; or set $CHAT, or pass first arg)
#   --instance <name>  Quilltap instance (default: Friday)
#   --base-url <url>   Server base URL (default: http://localhost:3000)
#   --dry-run          Preflight + show current state + planned transitions; no writes
#   --arm              CT-2 scan-skip: set an operator state, stamp a baseline, exit
#   --recheck          CT-2 scan-skip: verify no scan-enqueued job since the baseline
#   --no-jest          Skip the CT-2 jest guard suites
#   --no-ct3           Skip CT-3 (which creates and then deletes throwaway chats)
#   --keep             Don't restore the chat's original state at the end
#   --ct4-profile <id> CT-4: an image-capable CONNECTION profile whose provider
#                      refuses --ct4-prompt (the legacy image route draws from
#                      connection profiles). Needs Auto-Route and an
#                      "Uncensored-compatible" image-capable profile to reroute to.
#   --ct4-prompt <txt> CT-4: a prompt that profile's provider refuses
#   -h, --help         This help
# ---------------------------------------------------------------------------

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_JS="$ROOT/packages/quilltap/bin/quilltap.js"

INSTANCE="Friday"
BASE_URL="http://localhost:3000"
CHAT="${CHAT:-}"
MODE="run"          # run | dry | arm | recheck
RUN_JEST=1
RUN_CT3=1
CT4_PROFILE=""
CT4_PROMPT=""
RESTORE=1
DELAY="0.3"         # small settle after each PUT before reading via the CLI connection

# ----- arg parsing ---------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --chat)      CHAT="$2"; shift 2 ;;
    --instance)  INSTANCE="$2"; shift 2 ;;
    --base-url)  BASE_URL="$2"; shift 2 ;;
    --dry-run)   MODE="dry"; shift ;;
    --arm)       MODE="arm"; shift ;;
    --recheck)   MODE="recheck"; shift ;;
    --no-jest)   RUN_JEST=0; shift ;;
    --no-ct3)    RUN_CT3=0; shift ;;
    --keep)      RESTORE=0; shift ;;
    --ct4-profile) CT4_PROFILE="$2"; shift 2 ;;
    --ct4-prompt)  CT4_PROMPT="$2"; shift 2 ;;
    -h|--help)   sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)          echo "Unknown option: $1" >&2; exit 2 ;;
    *)           CHAT="$1"; shift ;;
  esac
done

# ----- pretty output -------------------------------------------------------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_DIM=$'\033[2m'; C_HDR=$'\033[1;36m'; C_RST=$'\033[0m'
else
  C_OK=""; C_BAD=""; C_DIM=""; C_HDR=""; C_RST=""
fi
PASS=0; FAIL=0
ok()      { PASS=$((PASS+1)); printf "  %s✓%s %s\n" "$C_OK" "$C_RST" "$1"; }
bad()     { FAIL=$((FAIL+1)); printf "  %s✗%s %s\n" "$C_BAD" "$C_RST" "$1"; }
info()    { printf "  %s· %s%s\n" "$C_DIM" "$1" "$C_RST"; }
section() { printf "\n%s== %s ==%s\n" "$C_HDR" "$1" "$C_RST"; }
die()     { printf "%sERROR:%s %s\n" "$C_BAD" "$C_RST" "$1" >&2; exit 1; }

# ----- CLI / query helpers (read-only) -------------------------------------
q()  { node "$CLI_JS" db --instance "$INSTANCE" --json "$1" 2>/dev/null; }
# scalar query: every query must alias its single column as `v`
qv() { local out; out="$(q "$1" | jq -r '.[0].v // "null"')"; [ "$out" = "null" ] && out="null"; printf '%s' "$out"; }

mode_of()  { local v; v="$(qv "SELECT conciergeMode AS v FROM chats WHERE id='$CHAT'")"; [ "$v" = "null" ] && v="moderated"; printf '%s' "$v"; }
setby_of() { qv "SELECT conciergeModeSetBy AS v FROM chats WHERE id='$CHAT'"; }
reason_of(){ qv "SELECT conciergeModeReason AS v FROM chats WHERE id='$CHAT'"; }
dg_of()    { qv "SELECT isDangerousChat AS v FROM chats WHERE id='$CHAT'"; }
ann_marker() { qv "SELECT COALESCE(MAX(createdAt),'') AS v FROM chat_messages WHERE chatId='$CHAT' AND systemSender='concierge'"; }

derived_pill() { # mode -> pill label (Moderated renders no pill)
  case "$1" in
    unmoderated) echo "Unmoderated" ;;
    locked)      echo "Locked" ;;
    *)           echo "(none)" ;;
  esac
}

# The columns the operator PUT/POST write are the same regardless of the
# state transitioned *from* — moderated always clears provenance, the other
# two always stamp (operator, manual).
expected_setby()  { case "$1" in moderated) echo null ;; *) echo operator ;; esac; }
expected_reason() { case "$1" in moderated) echo null ;; *) echo manual ;; esac; }

# ----- API driver (the only writer; server-mediated) -----------------------
api_set_state() { # state
  local state="$1" code
  if [ "$MODE" = "dry" ]; then info "[dry] would PUT conciergeState=$state"; return 0; fi
  code="$(curl -s -o /tmp/ct_resp.json -w '%{http_code}' \
            -X PUT "$BASE_URL/api/v1/chats/$CHAT" \
            -H 'Content-Type: application/json' \
            -d "{\"conciergeState\":\"$state\"}")"
  [ "$code" = "200" ] || { bad "PUT conciergeState=$state -> HTTP $code"; return 1; }
  sleep "$DELAY"
  return 0
}

# ----- assertions ----------------------------------------------------------
check_triplet() { # expected_mode expected_setby expected_reason label
  local mode setby reason pill
  mode="$(mode_of)"; setby="$(setby_of)"; reason="$(reason_of)"; pill="$(derived_pill "$mode")"
  if [ "$mode" = "$1" ] && [ "$setby" = "$2" ] && [ "$reason" = "$3" ]; then
    ok "$4 — (conciergeMode=$mode, setBy=$setby, reason=$reason) → pill: $pill"
  else
    bad "$4 — expected (mode=$1, setBy=$2, reason=$3), got (mode=$mode, setBy=$setby, reason=$reason)"
  fi
}

check_ann() { # phrase since_iso label
  local n; n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$CHAT' AND systemSender='concierge' AND qt_text(content) LIKE '%$1%' AND createdAt > '$2'")"
  [ "$n" = "null" ] && n=0
  if [ "$n" -ge 1 ] 2>/dev/null; then
    ok "$3 — Concierge announcement posted (\"…$1…\")"
  else
    bad "$3 — no Concierge announcement matching \"$1\""
  fi
}

transition() { # state phrase label
  local state="$1" phrase="$2" label="$3" m exp_setby exp_reason
  exp_setby="$(expected_setby "$state")"; exp_reason="$(expected_reason "$state")"
  m="$(ann_marker)"
  api_set_state "$state" || return
  check_triplet "$state" "$exp_setby" "$exp_reason" "$label: DB state"
  if [ "$state" = "moderated" ]; then
    local dg; dg="$(dg_of)"
    if [ "$dg" = "0" ] || [ "$dg" = "null" ]; then
      ok "$label: isDangerousChat cleared"
    else
      bad "$label: isDangerousChat not cleared (got $dg)"
    fi
  fi
  [ -n "$phrase" ] && check_ann "$phrase" "$m" "$label: announcement"
}

# ----- live check: retired values are rejected -----------------------------
check_retired_rejected() { # value
  local value="$1" code
  if [ "$MODE" = "dry" ]; then info "[dry] would PUT conciergeState=$value and expect HTTP 400"; return; fi
  code="$(curl -s -o /tmp/ct_resp.json -w '%{http_code}' \
            -X PUT "$BASE_URL/api/v1/chats/$CHAT" \
            -H 'Content-Type: application/json' \
            -d "{\"conciergeState\":\"$value\"}")"
  if [ "$code" = "400" ]; then
    ok "PUT conciergeState=$value (retired) -> HTTP 400 as expected"
  else
    bad "PUT conciergeState=$value (retired) -> HTTP $code, expected 400"
  fi
}

# ----- preflight -----------------------------------------------------------
preflight() {
  command -v jq  >/dev/null || die "jq not found"
  [ -f "$CLI_JS" ] || die "quilltap CLI not found at $CLI_JS"
  [ -n "$CHAT" ]   || die "no --chat given. Find one: node packages/quilltap/bin/quilltap.js db --instance $INSTANCE find chat \"<name>\""
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/health")"
  [ "$code" = "200" ] || die "server not reachable at $BASE_URL (HTTP $code). Is 'npm run dev' running?"
  local title; title="$(qv "SELECT title AS v FROM chats WHERE id='$CHAT'")"
  [ "$title" = "null" ] && die "chat '$CHAT' not found in instance '$INSTANCE'"
  printf "%sConcierge three-state test%s\n" "$C_HDR" "$C_RST"
  info "instance=$INSTANCE  base=$BASE_URL"
  info "chat=$CHAT  (\"$title\")"
}

# ----- CT-2 scan-skip baseline modes --------------------------------------
BASELINE_FILE="${TMPDIR:-/tmp}/ct-scan-baseline-$CHAT.json"

arm_scan() {
  preflight
  section "CT-2 scan-skip: arm baseline (Locked — the Concierge may only move a Moderated chat)"
  api_set_state locked || die "could not set chat Locked"
  check_triplet "locked" "operator" "manual" "Locked confirmed"
  local maxj now
  maxj="$(qv "SELECT COALESCE(MAX(createdAt),'') AS v FROM background_jobs WHERE type='CHAT_DANGER_CLASSIFICATION' AND payload LIKE '%$CHAT%'")"
  now="$(qv "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS v")"
  printf '{"chat":"%s","maxJob":"%s","armedAt":"%s"}\n' "$CHAT" "$maxj" "$now" > "$BASELINE_FILE"
  ok "baseline stamped → $BASELINE_FILE"
  info "Leave the server running ≥10 min (the scan ticks every 10 min), then: $0 --chat $CHAT --recheck"
}

recheck_scan() {
  preflight
  section "CT-2 scan-skip: recheck"
  [ -f "$BASELINE_FILE" ] || die "no baseline ($BASELINE_FILE). Run --arm first."
  local maxj armedAt n mode
  maxj="$(jq -r .maxJob "$BASELINE_FILE")"; armedAt="$(jq -r .armedAt "$BASELINE_FILE")"
  mode="$(mode_of)"
  if [ "$mode" = "locked" ]; then
    ok "still Locked (conciergeMode=$mode) — the scan may only touch a Moderated chat"
  else
    bad "no longer Locked (conciergeMode=$mode) — something flipped it!"
  fi
  n="$(qv "SELECT COUNT(*) AS v FROM background_jobs WHERE type='CHAT_DANGER_CLASSIFICATION' AND payload LIKE '%$CHAT%' AND createdAt > '$maxj'")"
  [ "$n" = "null" ] && n=0
  if [ "$n" -eq 0 ] 2>/dev/null; then
    ok "scheduled scan enqueued NO classification job for this Locked chat since $armedAt"
  else
    bad "scan enqueued $n classification job(s) for a Locked chat — scan-skip FAILED"
  fi
  info "(If the server hasn't been up ≥10 min since arming, the scan may not have ticked yet — re-run later.)"
}

# ----- CT-3: the state chosen on the New Chat form ------------------------
#
# The Concierge picker moved onto the creation form, so `POST /api/v1/chats`
# now takes a `conciergeState`. The route applies it through the same
# `applyConciergeFlip` chokepoint the sidebar uses, between the SYSTEM prompt
# message and everything else — so the created chat must carry the right
# stored triplet AND exactly one Concierge bubble (none for Moderated),
# sitting after the prompt and before the opening line. Every assertion is a
# read-only CLI query; the throwaway chats are deleted through the API
# afterwards.

ct3_create_chat() { # characterId profileId state ("" for "omit the field") -> new chat id
  local body id
  body="$(printf '{"title":"CT-3 throwaway","participants":[{"type":"CHARACTER","characterId":"%s","connectionProfileId":"%s","controlledBy":"llm"}]%s}' \
            "$1" "$2" "$( [ -n "$3" ] && printf ',"conciergeState":"%s"' "$3" )")"
  id="$(curl -s -X POST "$BASE_URL/api/v1/chats" \
          -H 'Content-Type: application/json' -d "$body" | jq -r '.chat.id // empty')"
  printf '%s' "$id"
}

ct3_delete_chat() { # chatId
  curl -s -o /dev/null -X DELETE "$BASE_URL/api/v1/chats/$1"
}

ct3_case() { # state characterId profileId
  local state="$1" charId="$2" profId="$3" newId mode setby reason n sys_rid con_rid
  newId="$(ct3_create_chat "$charId" "$profId" "$state")"
  if [ -z "$newId" ]; then
    bad "CT-3 $state: POST /api/v1/chats returned no chat"
    return
  fi

  mode="$(qv "SELECT COALESCE(conciergeMode,'moderated') AS v FROM chats WHERE id='$newId'")"
  setby="$(qv "SELECT conciergeModeSetBy AS v FROM chats WHERE id='$newId'")"
  reason="$(qv "SELECT conciergeModeReason AS v FROM chats WHERE id='$newId'")"
  if [ "$mode" = "$state" ] && [ "$setby" = "operator" ] && [ "$reason" = "manual" ]; then
    ok "CT-3 $state: created with (conciergeMode=$mode, setBy=$setby, reason=$reason) → pill: $(derived_pill "$mode")"
  else
    bad "CT-3 $state: expected (mode=$state, setBy=operator, reason=manual), got (mode=$mode, setBy=$setby, reason=$reason)"
  fi

  n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$newId' AND systemSender='concierge'")"
  [ "$n" = "null" ] && n=0
  if [ "$n" = "1" ]; then
    ok "CT-3 $state: exactly one Concierge bubble in the fresh history"
  else
    bad "CT-3 $state: expected 1 Concierge bubble, found $n"
  fi

  # rowid is insertion order on a SQLite rowid table — the SYSTEM prompt is
  # written first, the Concierge's note second, the scene after that.
  sys_rid="$(qv "SELECT MIN(rowid) AS v FROM chat_messages WHERE chatId='$newId' AND role='SYSTEM'")"
  con_rid="$(qv "SELECT MIN(rowid) AS v FROM chat_messages WHERE chatId='$newId' AND systemSender='concierge'")"
  if [ "$sys_rid" != "null" ] && [ "$con_rid" != "null" ] && [ "$con_rid" -gt "$sys_rid" ] 2>/dev/null; then
    ok "CT-3 $state: the Concierge's note follows the system prompt"
  else
    bad "CT-3 $state: bubble placement wrong (system rowid=$sys_rid, concierge rowid=$con_rid)"
  fi

  ct3_delete_chat "$newId"
  info "CT-3 $state: throwaway chat $newId deleted"
}

run_ct3() {
  section "CT-3: the state chosen on the New Chat form (creation-time)"
  local charId profId newId n mode setby reason
  charId="$(qv "SELECT id AS v FROM characters WHERE controlledBy='llm' AND archivedAt IS NULL ORDER BY createdAt LIMIT 1")"
  profId="$(qv "SELECT id AS v FROM connection_profiles ORDER BY createdAt LIMIT 1")"
  if [ "$charId" = "null" ] || [ "$profId" = "null" ]; then
    info "skipped — instance '$INSTANCE' has no LLM character and/or connection profile to build a chat from"
    return
  fi
  info "cast: character=$charId profile=$profId (chats are created and then deleted)"

  # Absence is the default: a plain create must stay exactly what it was.
  newId="$(ct3_create_chat "$charId" "$profId" "")"
  if [ -z "$newId" ]; then
    bad "CT-3 omitted: POST /api/v1/chats returned no chat"
  else
    n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$newId' AND systemSender='concierge'")"
    [ "$n" = "null" ] && n=0
    mode="$(qv "SELECT COALESCE(conciergeMode,'moderated') AS v FROM chats WHERE id='$newId'")"
    setby="$(qv "SELECT conciergeModeSetBy AS v FROM chats WHERE id='$newId'")"
    reason="$(qv "SELECT conciergeModeReason AS v FROM chats WHERE id='$newId'")"
    if [ "$mode" = "moderated" ] && [ "$setby" = "null" ] && [ "$reason" = "null" ] && [ "$n" = "0" ]; then
      ok "CT-3 omitted: created Moderated, no Concierge bubble"
    else
      bad "CT-3 omitted: expected Moderated with no bubble, got (mode=$mode, setBy=$setby, reason=$reason, bubbles=$n)"
    fi
    ct3_delete_chat "$newId"
  fi

  ct3_case unmoderated "$charId" "$profId"
  ct3_case locked      "$charId" "$profId"
}

# ----- CT-4: a refused picture on a Moderated chat is rerouted -------------
# Drives the legacy image route (POST /api/v1/images?action=generate), which
# now runs through generateImageWithConciergeFailover. Opt-in, because it needs
# a real provider that actually refuses the prompt — there is no way to force a
# refusal from outside. The deterministic half is the jest suites below.
run_ct4() {
  section "CT-4: a refused picture on a Moderated chat is rerouted (live)"
  api_set_state moderated >/dev/null 2>&1 || true
  local m code n
  m="$(qv "SELECT COALESCE(MAX(createdAt),'') AS v FROM chat_messages WHERE chatId='$CHAT'")"
  code="$(curl -s -o /tmp/ct4_resp.json -w '%{http_code}' \
            -X POST "$BASE_URL/api/v1/images?action=generate" \
            -H 'Content-Type: application/json' \
            -d "$(jq -nc --arg p "$CT4_PROMPT" --arg id "$CT4_PROFILE" --arg c "$CHAT" '{prompt:$p, profileId:$id, chatId:$c}')")"
  sleep "$DELAY"
  n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$CHAT' AND systemSender='concierge' AND systemKind='refusal' AND createdAt > '$m'")"
  [ "$n" = "null" ] && n=0
  if [ "$n" -ge 1 ] 2>/dev/null; then
    ok "CT-4: the Concierge posted a refusal note (HTTP $code)"
  else
    bad "CT-4: no Concierge refusal note (HTTP $code) — did the provider actually refuse? see /tmp/ct4_resp.json"
    return
  fi
  n="$(qv "SELECT COUNT(*) AS v FROM chat_messages WHERE chatId='$CHAT' AND systemSender='concierge' AND systemKind='refusal' AND qt_text(content) LIKE '%across the street%' AND createdAt > '$m'")"
  if [ "$code" = "200" ] && [ "$n" -ge 1 ] 2>/dev/null; then
    ok "CT-4: rerouted — the picture was drawn by the uncensored understudy"
  else
    bad "CT-4: refused but not rerouted (HTTP $code) — check Auto-Route and an \"Uncensored-compatible\" image-capable profile"
  fi
}

# ----- jest guard suites (CT-2 bail + derivation) --------------------------
run_jest() {
  section "CT-2 guard suites (read-only, deterministic)"
  local suites=(
    "__tests__/unit/lib/services/dangerous-content/manual-flip.test.ts"
    "__tests__/unit/lib/services/dangerous-content/chat-override.test.ts"
    "__tests__/unit/lib/services/dangerous-content/resolver.test.ts"
    "__tests__/unit/background-jobs/chat-danger-classification.test.ts"
    "__tests__/unit/lib/services/dangerous-content/refusal.test.ts"
    "__tests__/unit/lib/services/dangerous-content/understudy.test.ts"
    "__tests__/unit/lib/services/dangerous-content/image-failover.test.ts"
    "__tests__/unit/lib/tools/image-generation-concierge-failover.test.ts"
    "__tests__/unit/migrations/add-chat-concierge-mode.test.ts"
    "__tests__/unit/lib/services/dangerous-content/concierge-state-presentation.test.ts"
    "__tests__/unit/lib/services/chat-message/provider-failover-refusal.test.ts"
  )
  if (cd "$ROOT" && npx jest "${suites[@]}" --silent >/tmp/ct_jest.log 2>&1); then
    ok "manual-flip + chat-override + resolver + chat-danger-classification + migration + presentation + refusal-failover suites passed"
    info "covers: three-state → (conciergeMode, setBy, reason) writes & announcements, predicates, resolver overrides, handler bail, the four→three-state migration, presentation labels, refusal classification + image failover (the bikini case)"
  else
    bad "guard suites failed — see /tmp/ct_jest.log (if native ABI mismatch: npm rebuild better-sqlite3)"
  fi
}

# ----- main runs -----------------------------------------------------------
case "$MODE" in
  arm)     arm_scan; exit 0 ;;
  recheck) recheck_scan; exit 0 ;;
esac

preflight

ORIG_MODE="$(mode_of)"
info "original state: $ORIG_MODE"

if [ "$MODE" = "dry" ]; then
  section "DRY RUN — plumbing check, no writes"
  ok "server reachable, CLI queryable, chat found"
  check_triplet "$ORIG_MODE" "$(setby_of)" "$(reason_of)" "current state readable"
  info "planned CT-1 walk: moderated → unmoderated → moderated → locked → moderated → unmoderated → locked → unmoderated"
  info "planned CT-2: PUT conciergeState=flagged (retired) → expect HTTP 400, then jest guards"
  info "planned CT-3: create+delete three throwaway chats (omitted, unmoderated, locked)"
  printf "\n%sDry run OK.%s Re-run without --dry-run to execute (mutates the chat).\n" "$C_OK" "$C_RST"
  exit 0
fi

printf "\n%s⚠ This appends synthetic Concierge bubbles to chat %s. Ctrl-C within 3s to abort.%s\n" "$C_BAD" "$CHAT" "$C_RST"
sleep 3

# normalize to a known starting point (unasserted setup)
api_set_state moderated >/dev/null 2>&1 || true

section "CT-1: sidebar three-state control"
#          state        phrase                            label
transition unmoderated  "uncensored door stands open"      "Moderated→Unmoderated"
transition moderated    "Moderated once more"              "Unmoderated→Moderated"
transition locked       "locked the present company"       "Moderated→Locked"
transition moderated    "Moderated once more"              "Locked→Moderated"
transition unmoderated  "uncensored door stands open"       "Moderated→Unmoderated (again)"
transition locked       "locked the present company"       "Unmoderated→Locked"
transition unmoderated  "uncensored door stands open"       "Locked→Unmoderated"

section "CT-2: Locked and Unmoderated stay put (live, deterministic parts)"
check_retired_rejected "flagged"
info "scan-skip over a live 10-min tick: run '$0 --chat $CHAT --arm' then '--recheck' later"

[ "$RUN_CT3" -eq 1 ] && run_ct3
if [ -n "$CT4_PROFILE" ] && [ -n "$CT4_PROMPT" ]; then run_ct4; else info "CT-4 skipped (pass --ct4-profile and --ct4-prompt to run it)"; fi
[ "$RUN_JEST" -eq 1 ] && run_jest

# restore
if [ "$RESTORE" -eq 1 ]; then
  section "restore"
  api_set_state "$ORIG_MODE" >/dev/null 2>&1 && info "restored effective state → $ORIG_MODE" \
    || info "could not restore (left as-is)"
fi

# ----- summary -------------------------------------------------------------
printf "\n%s──────── %d passed, %d failed ────────%s\n" \
  "$([ "$FAIL" -eq 0 ] && echo "$C_OK" || echo "$C_BAD")" "$PASS" "$FAIL" "$C_RST"
[ "$FAIL" -eq 0 ]
