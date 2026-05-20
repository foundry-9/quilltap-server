# Feature: Repair Memory-Graph Integrity (dangling `relatedMemoryIds`)

**Status:** Proposal / Not Implemented
**Owner:** Memory subsystem (`lib/memory/`), plus a migration and one new CLI verb.
**Surfaced by:** `quilltap memories status` (Tier 1.5). Friday smoke test reported **9,390 dangling related-memory edges** across all holders.

## Why

`memories.relatedMemoryIds` is a JSON array, not a foreign-key relationship. SQLite enforces nothing. The creation path (`linkRelatedMemories` in `lib/memory/memory-gate.ts`) writes bidirectional edges when a memory is born — but there appears to be no symmetric unwind path on deletion, so every deleted memory leaves dangling references in its former neighbours' rows. The 9,390 count on Friday is the accumulated drift from however many memories have been deleted, merged, or restored over the instance's lifetime.

This brief fixes the problem at the source, repairs the existing state, and adds an ongoing-health verb so future drift is visible the moment it appears.

## Outcome we're aiming for

- Every memory deletion path scrubs the deleted ID from neighbours' `relatedMemoryIds` atomically with the delete, via a single chokepoint helper.
- A one-time repair migration brings existing data to zero dangling edges.
- `quilltap memories validate` exists as a read-only health check; it should return zero forever once the leak is plugged.
- On Friday: `memories status` reports `dangling edges: 0` after the next startup.

## Phase 1 — Investigation (do this first)

**Do not start fixing without doing the investigation.** Multiple paths can delete from the `memories` table; we need to know which of them leak, so the fix routes through a chokepoint rather than patching one path and missing another.

### What the agent should produce

A short report (under one page) listing every code path that removes rows from `memories`, with three columns:

1. The call site (file + line + a one-line description of when it runs).
2. Whether it currently scans neighbours' `relatedMemoryIds` to remove the deleted ID.
3. Estimated volume — high (housekeeping, character/chat cascade), medium (manual delete via API), low (rare admin paths).

### Where to look

Grep for direct deletion of `memories` rows and for the repository's delete methods:

- `lib/database/repositories/memories.repository.ts` — the canonical CRUD surface; find every method that issues a `DELETE FROM memories` or routes there.
- `lib/memory/housekeeping.ts` — likely high-volume. If housekeeping merges duplicates by deleting the loser, that's a major leak source.
- `lib/memory/memory-gate.ts`, `lib/memory/memory-service.ts`, `lib/memory/memory-processor.ts` — additional memory-management surface.
- `lib/services/ai-import.service.ts` — surfaced in earlier greps; check what it does on import.
- `lib/backup/restore-service.ts` — if restore reissues UUIDs without reconciling the JSON arrays, a single restore could create a large chunk of dangling edges.
- `app/api/v1/memories/[id]/route.ts` — the manual-delete API surface.
- Character-cascade and chat-cascade paths: grep for `DELETE FROM memories WHERE characterId` and `WHERE chatId`. These are likely candidates and are likely the largest contributors to Friday's count.

### What the report should answer

- Which paths leak? (List them.)
- Which path is the largest contributor by volume? (Best guess based on what Friday has done historically — Charlie has deleted characters and chats over time.)
- Are there any non-obvious deletion paths (triggers, `ON DELETE CASCADE` from a foreign-key relationship in another table) we should know about?

Hand the report back before writing the fix. The fix specification below assumes the report has been read.

## Phase 2 — Fix at the source

### The chokepoint

Add a new helper in `lib/memory/memory-gate.ts`:

```ts
/**
 * Delete a memory and remove the deleted ID from every neighbour's
 * relatedMemoryIds. Runs as a single transaction so the graph never
 * appears partially updated to a concurrent reader.
 */
export async function deleteMemoryWithUnlink(memoryId: string): Promise<void>
```

It is the **single chokepoint for memory deletion going forward.** Every leaking path identified in Phase 1 is rerouted through it. Match the spirit of `createMemoryWithGate` (the existing single chokepoint for writes) — if there's currently no single chokepoint for deletions, `deleteMemoryWithUnlink` becomes that.

### What it does

Inside one transaction:

1. Load the row being deleted to confirm it exists (early return if it doesn't — idempotent).
2. Find every memory whose `relatedMemoryIds` contains the target ID. A LIKE pre-filter on the JSON column is cheap enough for the in-transaction scan: `WHERE relatedMemoryIds LIKE '%"<id>"%'`. (Quote the ID inside the LIKE pattern so partial-UUID collisions don't false-positive.)
3. For each match, parse the JSON, remove the target ID, write back via `repos.memories.updateForCharacter(neighbour.characterId, neighbour.id, { relatedMemoryIds: filtered })`. This mirrors how `linkRelatedMemories` already writes — same repository method, same JSON-serialisation guarantees.
4. Delete the target memory row.
5. Debug-log the operation: target ID, neighbour count, characters affected. Warn-log if neighbour count exceeds 20 (anomalous; indicates either an unusually dense node or a bug).

### Reroute the leaking paths

For every path identified in Phase 1 that currently issues a raw `DELETE FROM memories`:

- If it's deleting a single memory by ID: call `deleteMemoryWithUnlink(id)` instead.
- If it's batch-deleting many memories (e.g., character cascade: "delete all memories where `characterId = ?`"): the helper needs a batch variant — `deleteMemoriesWithUnlinkBatch(memoryIds: string[])` — that loads the full set of about-to-be-deleted IDs first, then scans neighbours **once** filtering against the whole set, then deletes the batch. Doing this in one pass is much faster than calling the single-ID helper in a loop, and it correctly handles the case where two deleted memories were linked to each other (no need to scrub IDs that are themselves being deleted).
- If the batch deletion is via a SQL JOIN (e.g., `DELETE FROM memories WHERE characterId IN (SELECT id FROM characters WHERE …)`), do the SELECT to materialise the doomed IDs first, then hand them to the batch helper, then issue the DELETE.

### Non-goals for this phase

- Don't try to detect or repair existing dangling edges as a side effect. That's the migration's job (Phase 3). Keep the runtime helper focused on "deletions don't create new drift."
- Don't add a CLI side-channel for repair. `memories validate` stays read-only (Phase 4).

### Logging and observability

- Every call to `deleteMemoryWithUnlink` and `deleteMemoriesWithUnlinkBatch` emits a debug log: target IDs, neighbour count, duration, character IDs affected.
- Warn-level log when a single deletion touches more than 20 neighbours, or a batch deletion touches more than 200. These are anomalous and worth surfacing.
- No new metrics or instance-settings flags. Keep the surface small.

## Phase 3 — Repair migration

### Migration name

`repair-dangling-related-memory-edges-v1`

### What it does

A one-time, idempotent scan that brings the existing data to zero dangling edges.

1. `shouldRun()` short-circuits when no row has a non-empty `relatedMemoryIds` containing an ID not present in `memories.id`. The cheap version of this check: `SELECT 1 FROM memories WHERE relatedMemoryIds IS NOT NULL AND relatedMemoryIds != '[]' LIMIT 1` — i.e., run unless every memory's links are already empty. The more accurate but more expensive check is to do the full scan and bail if it finds nothing. Pick the cheap pre-check for `shouldRun()`; the migration body does the accurate work.
2. `SELECT id FROM memories` into a Set of valid IDs (memory in RAM is fine — Friday has tens of thousands, not millions).
3. Stream `SELECT id, characterId, relatedMemoryIds FROM memories WHERE relatedMemoryIds IS NOT NULL AND relatedMemoryIds != '[]'`. For each row:
   - Parse the JSON.
   - Filter out IDs not in the valid set.
   - If the filtered array differs from the original, UPDATE the row.
   - Count rows touched and edges removed.
4. Log a summary at the end: total memories scanned, total rows updated, total dangling edges removed. The summary is what we expect to see in the startup log on Friday confirming the repair.

### Migration rules (from CLAUDE.md)

Two things this migration must satisfy:

- **Pretty-label entry in `lib/startup/prettify.ts`** under `PRETTY_LABELS`. Use the steampunk-Wodehouse voice — something like "Mending broken threads in the memory tapestry…" or "Pruning phantom links from the memory graph…" (Charlie's call on phrasing; the goal is "describes what's happening to the user's data in a voice that fits the rest of the UI"). Without this entry the startup loading screen falls back to a hyphen-split humanization of the migration ID, which leaks an internal name to users.
- **`reportProgress(...)` inside the loop.** Pre-count via `SELECT COUNT(*) FROM memories WHERE relatedMemoryIds IS NOT NULL AND relatedMemoryIds != '[]'` and pass the running count against it. The helper is throttled to one emit per ~250ms so it's safe to call every iteration.

The migration is registered in `migrations/scripts/index.ts` per the standard pattern.

### Performance

Friday's count (9,390 dangling edges across however many memories) is small enough that the migration completes in well under a minute. Don't optimise further unless the smoke test shows it's actually slow. The progress bar is the user-visible reassurance that something is happening; the underlying work is fast.

## Phase 4 — Promote `memories validate` to ship-now

The Tier 1.5 spec flagged this as a Tier 2 candidate. Friday's finding promotes it.

### CLI surface

```text
quilltap memories validate [--character <name|id>] [--list] [--json]
```

- `--character <name|id|all>` — restrict to one holder. Default: `all`.
- `--list` — print the offending source memory IDs (those whose `relatedMemoryIds` contains a dangling reference) plus the dangling targets. Default: just print the count.
- `--json` — structured output.

### Behaviour

Read-only. Opens the main encrypted DB directly via the same helper `memories status` uses. Performs the same dangling-edge scan that's already in `status` (factor that logic out of `status` into a shared helper). Exit code 0 if clean; exit code 1 if any dangling edges are found.

After the migration runs, `memories validate` should exit 0 forever. If it doesn't, a new leak has appeared — which is itself a useful signal.

### What it intentionally does not do

- **No `--fix` flag.** Repair goes through the migration system so it's recorded, idempotent, and ordered with everything else. A CLI side-channel for data mutation bypasses that ordering and creates a second source of truth. If a new leak ever appears, the response is: identify it, fix it at source, write a new migration. Not: bolt on another CLI repair flag.
- No semantic checks beyond dangling edges. Self-symmetry checks (does every A→B have a matching B→A?) are interesting but out of scope here; flag as a future verb if asymmetry shows up.

### Help text

- Update the `memories` namespace help in `lib/memories-commands.js` to list `validate`.
- Add a "Validating memory-graph health" section to `help/cli-memories.md` in the steampunk voice with an `help_navigate` block.

## Project hygiene

For the whole batch (Phases 2–4 ship together; Phase 1 ships first as a written investigation):

1. **Version bump:** `packages/quilltap/package.json` patch number. One bump for the batch is fine.
2. **Type check:** `npx tsc` is clean.
3. **CHANGELOG:** one entry under `4.5-dev` in terse American English. Mention the chokepoint helper, the migration, the validate verb, and the Friday-confirmed dangling count being repaired.
4. **CLAUDE.md:** add a one-line note in the memory section explaining that `deleteMemoryWithUnlink` is the single chokepoint for memory deletion, paralleling the existing `createMemoryWithGate` chokepoint. This is the kind of convention that's easy to lose if it isn't written down.
5. **Help file:** `help/cli-memories.md` gains a "Validating memory-graph health" section.
6. **DDL doc:** no schema changes. No DDL update needed unless the migration adds an index (it doesn't need one — the scan is one-shot).
7. **Tests:**
   - Unit test for `deleteMemoryWithUnlink`: create a small graph (A↔B↔C), delete B, verify A's and C's `relatedMemoryIds` no longer contain B and B's row is gone.
   - Unit test for the batch variant: graph A↔B↔C↔D, delete {B, C} together, verify A's and D's arrays are clean and the inter-deleted-pair link (B↔C) is handled without churn.
   - Unit test for the migration: load a fixture with deliberate dangling edges (memories whose `relatedMemoryIds` includes UUIDs not present in the table), run the migration, verify count drops to zero. Run a second time, verify it short-circuits.
   - Reroute tests: for each leaking path identified in Phase 1, a test that exercises the path and confirms it no longer leaves dangling edges.

## Verification on Friday

The success criteria are observable, not just internal:

1. Before deploying: run `quilltap memories status --instance Friday` and capture the dangling-edges count (currently 9,390).
2. Deploy the code; restart Friday; let the migration run. The startup banner will show the pretty-label progress entry.
3. Run `quilltap memories status --instance Friday` again. Dangling-edges should be 0.
4. Run `quilltap memories validate --instance Friday`. Exit 0.
5. Optional but recommended: delete a memory through the UI (one you don't care about — perhaps a `MANUAL` test entry), then re-run `memories validate`. Should still be 0. This confirms the chokepoint is actually in the path.
6. Several days later, re-run `memories validate` periodically. If it stays at 0, the fix is sound. If it climbs, a deletion path was missed in Phase 1.

## Rollout order

The four phases ship in the obvious order, but a few of them can overlap:

1. **Phase 1 (investigation)** — single Haiku agent, written report. Hand the report back before starting Phase 2. Maybe 20–30 minutes.
2. **Phase 2 (chokepoint + reroutes)** — one PR. Cannot start until Phase 1 is done.
3. **Phase 3 (migration)** — can be written in parallel with Phase 2 since the migration doesn't depend on the helper. Lands in the same PR or the next one.
4. **Phase 4 (`memories validate`)** — small, self-contained, can land independently. Easiest to bundle with Phase 3 so all the new memory-integrity work ships together.

If Claude Code prefers, Phases 2–4 can be a single PR with a clear commit per phase. The fix and the migration must deploy together (deploying the fix without the migration leaves the historical drift; deploying the migration without the fix means it'll have to be re-run as new drift accumulates).

## Out of scope

- Self-symmetry checks: does every A→B have a matching B→A? Likely yes given the bidirectional creation path, but worth checking later. Don't conflate with this work.
- Graph integrity beyond `relatedMemoryIds`: no other table has been flagged. If `memories status` ever surfaces other inconsistencies, address them in their own brief.
- Re-running `linkRelatedMemories` to refresh the graph after deletion. The graph is shaped by the data that was there at the time each memory was created; reshaping it now would be a different kind of intervention (re-embedding semantics) and is out of scope.
- A general-purpose CLI flag that runs repairs ad hoc. Repairs go through migrations.

## A note on the underlying signal

9,390 dangling edges is meaningful, but interpret it in context. The first thing the Phase 2 implementer should know is the total edge count on Friday (`nodes with links × avg degree` from `memories status`). If the ratio is 3–5%, this is steady-state drift from years of normal use. If it's 20%+, something more aggressive (a particular bulk operation, a restore, a botched migration in the past) likely happened, and the Phase 1 investigation might surface a single culprit responsible for most of the count. Either way, the fix is the same; the context just tells you whether to be mildly annoyed or properly curious about how Friday got here.
