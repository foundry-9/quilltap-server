# Bug 238 — Fold OTHER memories are dated after the line they came from

| | |
|---|---|
| **Status** | Fixed 2026-10-13 |
| **Found** | 2026-10-13, on `V4test`, reading the extraction dry run while dogfooding the memory refactor |
| **Fixed** | 2026-10-13 |
| **Severity** | Low — cosmetic in most chats; in a long stretch an undated observation is placed at the stretch's end, which can push it out of a day window it belongs in |
| **Who it bites** | chats whose OTHER pass runs at fold grain (`hybrid` / `fold`) |
| **Provenance** | Phase D (`ac6348c5f`): the fold OTHER pass stamps `createdAt` with the observer's last line in the stretch but kept the stretch end as the `occurredAt` fallback |
| **Defect site** | `lib/memory/extraction/passes/other-fold.ts` (`anchors.fallbackIso: window.nowIso`) |
| **Fix site** | `lib/memory/extraction/passes/other-fold.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-13).** An undated fold OTHER draft falls back to the observer's last line in
the stretch — the same time its row is stamped with and the message it cites — so `occurredAt`
never follows `createdAt`. Test: `__tests__/unit/lib/memory/extraction/other-fold-pass.test.ts`
("dates an undated draft at its source line").

## Symptom

Dry-run candidates from one fold carried `sourceMessageId` of the observer's last line (13:55:48,
13:56:21) but every `occurredAt` was 13:56:44, the stretch's last message.

## Root cause

`resolveEpisodicAnchors` uses `fallbackIso` when a draft has no `when`. The pass passed
`window.nowIso`, while the per-turn passes pass the source time.

## Why it survived

The pass's tests used one timestamp for every message.

## Fix

`fallbackIso: sourceTime ?? window.nowIso`.

## Verify

A fold over messages at distinct times: each observer's undated rows carry `occurredAt` equal to
their last line's time.
