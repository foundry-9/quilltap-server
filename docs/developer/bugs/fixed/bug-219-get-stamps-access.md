# Bug 219 — `GET /memories/[id]` stamps `lastAccessedAt`

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase G) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix D) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — reading a memory through the API earns it the +0.10 recent-access protection bonus and resets housekeeping's inactivity clock, so an operator's inspection can keep a row from demotion |
| **Who it bites** | API and script callers that read single memories; in the app today only the "view digest" button, whose targets are digests and already always protected |
| **Provenance** | Original to v4 |
| **Defect site** | `app/api/v1/memories/[id]/route.ts:57-63` |
| **Fix site** | `app/api/v1/memories/[id]/route.ts` (GET) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The GET handler no longer calls `repos.memories.updateAccessTime`; it logs a debug line instead. Reading a memory through the API no longer earns the recent-access bonus or resets housekeeping's inactivity clock. `updateAccessTime` has no caller under `app/api/`. Test: `__tests__/unit/api/memories-manual-create.test.ts` (GET block).

## Symptom

Fetching one memory by id marks it as accessed. `lastAccessedAt` is meant to record that a model
was shown the memory; here it records that a person or script looked at it.

## Root cause

The GET handler (`route.ts:32`) calls
`repos.memories.updateAccessTime(memory.characterId, memoryId)` fire-and-forget (`:57-63`) before
returning the row. `lastAccessedAt` feeds:

- `calculateProtectionScore`'s recent-access term, +0.10 when accessed within 90 days
  (`lib/memory/memory-weighting.ts:285-290`), which can lift a row over the 0.5 protection
  threshold;
- housekeeping pass 1's inactivity test (`lib/memory/housekeeping.ts:155-168`).

The spec says "viewing a memory in the browser earns it the bonus". That is overstated for the
current UI: the memory list loads rows through the collection endpoint, and the only in-app caller
of the item GET is `handleViewDigest` (`components/memory/memory-list.tsx:197`). Digests
(`source: 'CONSOLIDATED'`) are always protected and excluded from pass 1, so the stamp has no
effect there. The defect is real for any other client of the endpoint and for any future UI that
opens a single row.

## Why it survived

The in-app path that reaches it only touches rows the stamp cannot affect.

## Fix

Locked decision 7: viewing a memory is not an access. The GET stops calling `updateAccessTime`.
From Phase E, `deliver` is the only writer of "what was shown"; the Memories API search stamps
nothing either.

## Verify

Note a row's `lastAccessedAt`, `GET /api/v1/memories/<id>`, and read it again: unchanged. Grep:
`updateAccessTime` has no caller under `app/api/`.
