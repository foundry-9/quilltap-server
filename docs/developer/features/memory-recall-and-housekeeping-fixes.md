# Memory Recall and Housekeeping Fixes — The Small Repairs

**Status:** Implemented 2026-10-08 (F1–F9). Two items still wait on live data: the F2 decision
(run the probe, then decide whether the gate compares anchor-free text) and the F7 before/after
replay on Friday probes. See [Implementation notes](#implementation-notes).
**Owner:** Charlie
**Drafted:** 2026-10-08
**Companion:** [memory-consolidation-and-tiers.md](./memory-consolidation-and-tiers.md)
(the structural fix; read its §1 for the Friday measurements these come from)

Independent, low-risk fixes found while auditing the Commonplace Book end to end
on 2026-10-08 (code at `f5e953a3f`). Each is its own small change with its own
test; none needs a migration. Ship these before the consolidation work — F1, F4,
F5, and F6 change the baseline that work will be measured against.

---

## F1. A near-duplicate re-observation should count as reinforcement

**Where:** `lib/memory/memory-service.ts` `createMemoryWithGate`, case
`SKIP_NEAR_DUPLICATE`; `lib/memory/memory-gate.ts`.

**Problem:** cosine ≥ `NEAR_DUPLICATE_THRESHOLD` (0.90) returns the existing
memory and writes nothing. The 0.85–0.90 band reinforces. So the facts restated
most faithfully are the ones that never accrue `reinforcementCount` — the very
signal protection and ranking rely on. Friday: 96% of rows at count 1.

**Fix:** on `SKIP_NEAR_DUPLICATE`, increment `reinforcementCount`, set
`lastReinforcedAt`, recompute `reinforcedImportance`
(`calculateReinforcedImportance`). **No** footnotes, **no** re-embed (the text is
already there). Keep the date guard ahead of it, unchanged. Return action stays
`SKIP_NEAR_DUPLICATE` (callers/logs distinguish "absorbed" from "reinforced with
novel detail"). Respect `existingMemory.characterId` scoping via
`updateForCharacter`.

**Test:** gate unit test — a ≥ 0.90 candidate bumps count and
`reinforcedImportance`, leaves `content` and `embedding` untouched.

## F2. Measure whether the anchor line is suppressing reinforcement

**Where:** `buildMemoryEmbeddingText` (`lib/memory/episodic.ts`), the gate.

**Hypothesis (unverified):** since the episodic spine (2026-07), gate and stored
embeddings include an anchor line (dates, entities). Two tellings of one fact on
different days with different entity sets may now embed below 0.85, pushing
restatements into `INSERT_RELATED`/`INSERT`.

**Task (measurement only):** a CLI/dev script that takes a character's last N
`INSERT`/`INSERT_RELATED` rows, re-embeds each with and without the anchor line,
searches the store both ways, and reports how many would have crossed 0.85 /
0.90 without anchors. Decide from the numbers: if material, compare on the
anchor-free text (requires storing a second, anchor-free vector or re-embedding
on the fly for the top-K only — choose then). Don't change the gate blind.

## F3. Cap reinforcement footnotes

**Where:** `reinforceMemory` (`memory-gate.ts`).

**Problem:** every reinforcement with novel details appends `[+] <detail>` lines
without bound and re-embeds; heavily reinforced rows drift toward a bag of proper
nouns.

**Fix:** cap at 8 `[+]` lines per memory (constant). Past the cap, still bump
count/importance and union `entities` (already bounded at 12), but don't append
content or re-embed. Consolidation (companion spec C4) is what rewrites these
cleanly later.

## F4. Make the archive pool rank on the right key, with a tiebreak

**Where:** `MemoriesRepository.findMostImportant`
(`lib/database/repositories/memories.repository.ts`), used by
`frozen-archive-cache.ts`.

**Problem:** `sort: { importance: -1 }` with no secondary key. With ~1,600 of
Friday's rows near 0.9, the 100-row pool (then the 25-row archive) is effectively
whatever order SQLite returns ties in. Raw `importance` also ignores
reinforcement.

**Fix:** sort by `reinforcedImportance DESC`, then
`COALESCE(lastReinforcedAt, createdAt) DESC`, then `id`. An index on
`reinforcedImportance` already exists. Check other callers of
`findMostImportant` (the Memories API, Almanack) and keep their semantics or
give the archive its own method.

## F5. Frozen archive cache: key on the chat, invalidate on sweeps

**Where:** `lib/memory/frozen-archive-cache.ts`.

**Problem:** keyed by `characterId` with the chat's `compactionGeneration` as the
freshness check. Every new chat starts at generation 0, so a new chat reuses
whatever generation-0 archive any earlier chat cached — until a restart.
`invalidateFrozenArchive` exists but has **no callers**.

**Fix:**

- Key by `(characterId, chatId)`; keep `compactionGeneration` as the
  within-chat freshness check (preserves byte-stability within a generation —
  the prefix-cache reason this cache exists). Bound the map (LRU, e.g. 64
  entries).
- Call `invalidateFrozenArchive(characterId)` (all chats for that character)
  after housekeeping deletes/demotes and after consolidation. Do **not**
  invalidate on ordinary per-turn writes — that would defeat the cache.
- Mind the process boundary: housekeeping runs in the job child; the archive
  cache lives in the parent. Invalidate from the parent's job-completion hook
  (the dispatcher already invalidates vector stores there — add archive keys
  beside it in `lib/background-jobs/host/job-dispatcher.ts`).

## F6. Only mark memories as accessed when they were actually used

**Where:** `bumpAccessTimes` in `searchMemoriesSemantic` / the text fallback
(`memory-service.ts`).

**Problem:** every search bumps `lastAccessedAt` on everything it returns —
the dynamic head fetches `limit × 3` (15) to fill 5 slots, so ~3× as many rows
are marked "accessed" as are ever shown. 83% of Friday's rows carry an access
stamp; the recent-access protection bonus (+0.10) no longer discriminates.

**Fix:** remove the bump from `searchMemoriesSemantic`; bump at the consumers:

- the injector, for the IDs that cleared the token budget
  (`whisperedMemoryIds` in `context-manager.ts`, plus archive and inter-char
  entries actually formatted);
- the `search` tool handler, for results returned to the model;
- the Memories API route (already bumps its own).

## F7. Size the dynamic head from the memory budget

**Where:** `DYNAMIC_HEAD_TOKEN_BUDGET` / `DYNAMIC_HEAD_DEFAULT_SIZE`
(`lib/chat/context/memory-injector.ts`), budget split in `context-manager.ts`.

**Problem:** the memory budget is `max(2000, 4% of context)` (~8k tokens on a
200k model), but the per-turn relevance head is fixed at 200 tokens / 5 entries
and the archive at 25 entries — most of the budget goes unspent while the
character misses relevant memories.

**Fix:** head budget = `clamp(15% of memoryBudget, 200, 1200)` tokens, entries
= `clamp(round(headBudget / 40), 5, 15)`; retrospective turns keep 2× (bounded
by memoryBudget). Archive size likewise scales: `clamp(round(archiveBudget /
60), 25, 60)`. Keep the archive's id-sorted byte-stability. Gate behind the
recall-replay harness: compare whisper composition and token spend on Friday
probes before and after.

## F8. Housekeeping reports `deleted: null`

**Where:** `runHousekeeping` → `deleteMemoriesWithUnlinkBatch` →
`MemoriesRepository.bulkDelete`; handler `memory-housekeeping.ts`.

**Evidence:** Friday's 2026-10-08 04:35 sweep logged `"deleted": null` with
`totalBefore 5013, totalAfter 5000` from `jobs:processor-host` /
`childLog: true`.

**Likely cause:** the sweep runs in the forked job child, where writes are
buffered and the repository's `deleteMany` doesn't return a real
`deletedCount`; `0 + undefined` → `NaN` → serialized `null`. That `NaN` also
flows into `recordHousekeepingOutcome`, where `NaN < minEffective` is false, so
the "ineffective sweep" backoff never trips.

**Fix:**

1. In the child, take the count from the requested-and-resolved id list (the
   batch already resolves ids per character) rather than the buffered return
   value; coerce non-finite to the resolved count and log at debug which path
   was used.
2. **Verify** the buffered deletes actually apply on the parent: after a sweep,
   `SELECT count(*)` for the character should equal the logged `totalAfter`.
   If not, that is a separate (serious) bug — file it in the bug catalogue.
3. Confirm which process owns `housekeeping-outcome-cache.ts`'s map at
   read time (`maybeEnqueueHousekeeping` runs inside the extraction job; the
   handler records inside the housekeeping job). If they can be different
   processes, move the outcome record to the parent's job-completion hook.

## F9. Make `mergeSimilar` an actual merge (until consolidation replaces it)

**Where:** `runHousekeeping` pass 2 (`lib/memory/housekeeping.ts`).

**Problem:** the "merged" row is just deleted — its `[+]` details,
`reinforcementCount`, links, and `occurredAt` are lost.

**Fix:** reuse the survivor-merge logic in `lib/tools/memory-dedup.ts` (it
already folds novel details from discarded rows into the survivor): before
deleting the loser, union its novel details into the survivor (respecting F3's
cap), add its `reinforcementCount`, union `relatedMemoryIds` (minus the pair),
keep the earlier non-null `occurredAt`, recompute `reinforcedImportance`,
re-embed if content changed. Factor the shared merge into
`lib/memory/memory-gate.ts` (or a new `memory-merge.ts`) so dedup and
housekeeping call one function. Once the consolidation spec's tiers land,
pass 2 is retired.

---

## Implementation notes

What shipped, and where it differs from or sharpens the text above.

- **F1** — `absorbNearDuplicate` (`memory-gate.ts`), called from the `SKIP_NEAR_DUPLICATE` case of
  `createMemoryWithGate`. Writes through `updateForCharacter` with the existing row's
  `characterId`. Test: `__tests__/unit/lib/memory/memory-recall-housekeeping-fixes.test.ts`.
- **Job-child writes.** In the forked child, `updateForCharacter` is a buffered write and returns
  `undefined`; `reinforceMemory` read that as "update failed" and returned before re-embedding, so a
  reinforcement with novel details never re-embedded when it ran in the extraction job. `patchMemory`
  now tells `null` (row missing) from `undefined` (buffered) and returns the locally patched row.
- **F2** — measurement tool only: `runAnchorGateProbe` (`lib/memory/anchor-gate-probe.ts`),
  `POST /api/v1/memories?action=anchor-gate-probe`, `quilltap anchor-probe <characterId>`. It
  samples the character's most recent rows (every row there survived the gate as a new row), scores
  each against OLDER rows anchored and anchor-free, and reports crossings and
  `crossedOnlyWithoutAnchors`. The gate is unchanged pending the numbers.
- **F3** — `MAX_REINFORCEMENT_FOOTNOTES = 8`, `appendCappedFootnotes`. A row already at the cap is
  not re-embedded at all, even if an anchor (occurredAt / narrativeTime) fills in; the anchors are
  still written to the row.
- **F4** — `findMostImportant` drops to `rawQuery` for the `COALESCE` tiebreak (shared row hydration
  with `findByCharacterAboutCharacters`). The archive is its only caller, so no other semantics move.
- **F5** — key `(characterId, chatId)`, archive size in the freshness check (the size now scales
  with the budget), LRU at 64. Invalidation: `runHousekeeping` and deduplication call
  `invalidateFrozenArchive` directly (effective in the parent; a no-op in the child), and the
  dispatcher's completion hook `invalidateFrozenArchivesForCompletedJob` handles
  `MEMORY_HOUSEKEEPING` jobs (one character, or all for a user-wide sweep; dry runs skipped). Test:
  `lib/background-jobs/host/__tests__/job-dispatcher-frozen-archive.test.ts`.
- **F6** — `markMemoriesAccessed` (exported from `memory-service.ts`). Beyond the three consumers
  listed, Carina recall, the first-message context and the voice-rewrite recall also deliver memories
  to a model, so they stamp what they format. The Memories API search action and the recall-replay
  harness stamp nothing.
- **F7** — `sizeMemoryPools` (`memory-injector.ts`). Retrospective head = max(old retro floor,
  2× ordinary), so no budget gets a smaller retro head than before. Archive size comes from the
  ordinary split even on retrospective turns, so membership is stable within a generation. The
  proactive pre-search pulls `DYNAMIC_HEAD_MAX_SIZE × 4` and keeps `× 3`. **Not yet validated** on
  Friday probes: run `quilltap recall-replay <chatId> --memory-budget <tokens>` on the usual probe
  turns and compare `oldHeadSize`/`newHeadSize` selections and token spend.
- **F8** — (1) `deleteMemoriesWithUnlinkBatch` counts resolved ids when `bulkDelete` returns a
  non-number, with a debug `countSource`; the handler and `recordHousekeepingOutcome` also refuse
  NaN. (2) The buffered `memories.bulkDelete` is applied by the dispatcher's generic repository
  apply with the same `(characterId, ids)` args — pinned by
  `__tests__/unit/lib/background-jobs/child-proxy-memory-housekeeping.test.ts`. The live check
  remains manual: after a sweep, `npx quilltap db memories --character <name>` (or a count query
  through the CLI) should match the logged `totalAfter`. (3) Writer and reader of the outcome cache
  are both in the job child, and the host keeps a single child, so the map is shared; no move to the
  parent was needed. Documented in `housekeeping-outcome-cache.ts`.
- **F9** — `lib/memory/memory-merge.ts` (`planMemoryMerge` pure, `applyMemoryMerge` writes and
  re-embeds). Both housekeeping pass 2 and `deduplicateCharacterMemories` call it. Losers are
  deleted before survivors are patched: in the child the delete's neighbour scrub is computed from
  the pre-merge row, so patching first would let the scrub overwrite the unioned links.
  `lastReinforcedAt` takes the latest of the group. Test:
  `__tests__/unit/lib/memory/housekeeping-merge-fold.test.ts`.

## Not in scope here

- Anything needing a schema change (tiers, digests, extraction watermarks) — see
  the companion spec.
- Retuning `RECALL_MULTIPLIERS` — do it with the replay harness after F4–F7.

## Chores

`docs/CHANGELOG.md` entry per fix (plain voice). F7 changes user-visible whisper
size — note it in `help/` (Commonplace Book / memory settings page). Unit tests
per fix; F5 and F8 need a parent/child-boundary test or a documented manual check.
