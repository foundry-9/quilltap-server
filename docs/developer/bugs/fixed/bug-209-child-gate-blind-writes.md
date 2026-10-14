# Bug 209 — In a background job the memory gate cannot see its own earlier writes

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase C) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix B) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — one extraction job can insert the same fact twice, drop a related-memory link, or drop a reinforcement's footnotes; each is small, and they recur on every multi-candidate turn |
| **Who it bites** | every memory write that runs in the forked job child: per-turn extraction, Carina extraction, the fold passes and catch-up, regeneration — whenever one job produces two candidates that touch the same memory |
| **Provenance** | Original to v4. Came in when memory extraction moved into the forked job child (parent-only DB writes with a buffered child proxy); the gate was written for a process that could read its own writes |
| **Defect site** | `lib/memory/memory-gate.ts:310-325` (top-K search then `findByIds`), `:352`, `:366`, `:393-395` (branches that need the hydrated row); `:694-725` (`linkRelatedMemories`, absolute link-list write at `:709`); `:589-685` (`reinforceMemory`: snapshot content at `:597`, count at `:655`, patch at `:666`); `lib/memory/memory-service.ts:593-625` (`createMemoryDirectWithEmbedding`); line numbers at `4a38222` |
| **Fix site** | `lib/background-jobs/child/child-repositories-proxy.ts` (per-job memory read-your-writes overlay: `recordBufferedMemoryWrite`, `applyMemoryOverlay`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The job child's repository proxy now keeps a per-job memory overlay, the way bug 179 added one for outfit commits. Every buffered `memories` write (`create`, `update` / `updateForCharacter`, `incrementReinforcement` with its delta, `updateTierBulk`, `delete` / `deleteForCharacter` / `bulkDelete`) is recorded by id, and `findById`, `findByIdForCharacter`, `findByIds` and `findByCharacterAndSourceMessageIds` answer through it — returning rows this job created, with patches, counts and deletes applied; other `memories` reads have the rows they return patched. So the second candidate in a job hydrates the first's row (near-duplicate → one row, count 2), builds its absolute `relatedMemoryIds` from a list that already holds the first link, and appends footnotes to content that already carries the first reinforcement's — and the parent's in-order replay keeps both. The fold episode pass's fragment lookup sees fragments inserted earlier in the job. The replay itself and the gate are unchanged; Phase C's move of admission into the parent remains the structural fix. Tests: `__tests__/unit/lib/background-jobs/child-proxy-memory-gate-overlay.test.ts` (runs `createMemoryWithGate` through the real proxy and replays the batch; all five fail without the overlay).

**Memory refactor Phase C (2026-10-13) — the structural fix.** Admission no longer runs in the job child: the child extracts and embeds, and `admitPrepared` runs in the parent over the `admitMemory` host-RPC, against the real rows, so a second candidate in one job sees the first's row directly. The overlay stays for the writers still in the child (consolidation, housekeeping, the fold passes, `retireMemories`). Tests: `__tests__/unit/lib/background-jobs/admission-host-rpc.test.ts` (child → host-RPC → parent; one row with count 2) and the overlay tests, renamed `child-proxy-memory-overlay.test.ts`.

## Symptom

Three effects, all inside a single job:

1. **Duplicate insert.** A turn in which two characters' SELF passes, or a SELF and an OTHER pass,
   produce two near-identical tellings of one fact yields two rows instead of one row with a
   reinforcement count of 2.
2. **Lost link.** Two candidates in one job that both land in the 0.70–0.85 band against the same
   existing memory each add themselves to its `relatedMemoryIds`; after commit the neighbour lists
   only the second.
3. **Lost footnotes.** Two candidates that both REINFORCE the same row each append `[+]` footnotes;
   after commit the row carries only the second candidate's footnotes. The reinforcement count is
   still correct (it is an atomic increment, bug 182).

## Root cause

In the job child the repositories are a proxy: reads go to a read-only connection, writes are
buffered and replayed by the parent after the handler returns
(`lib/background-jobs/child/child-repositories-proxy.ts`). A read never sees a write buffered
earlier in the same job. The gate assumes it does.

**(1)** `createMemoryDirectWithEmbedding` (`memory-service.ts:593`) buffers `memories.create` and
the embedding update, then adds the vector to the child's own in-memory vector store
(`:615-619`). The next candidate's gate search (`memory-gate.ts:310`) finds that vector at rank 1,
but `repos.memories.findByIds` (`:320`) reads the committed table and returns nothing for it, so
`bestMemory` (`:325`) is undefined. The date guard, near-duplicate (`:352`) and reinforce (`:366`)
branches all require `bestMemory`; the band filter drops entries with no row (`:395`). The
candidate falls through to INSERT.

Note on the working tree: the uncommitted Phase 0 fix for bug 200 now filters top-K hits with no row
before deciding. That does not fix this case — the same-job row is still invisible, is now logged
as an "orphan vector", and the candidate still inserts.

**(2)** `linkRelatedMemories` (`:694`) writes each neighbour's list as
`[...existingRelated, newMemoryId]` (`:709`), where `existingRelated` comes from the row
`findByIds` returned at decision time. Two buffered writes built from the same snapshot replay in
order, and the second overwrites the first.

**(3)** `reinforceMemory` (`:589`) builds the new content from `existingMemory.content` (`:597`),
the pre-job snapshot, and writes it as an absolute patch through `patchMemory` (`:666`). The second
reinforcement in the job rebuilds from the same snapshot and its patch replaces the first's.
`countReinforcement` (`:655`) uses the atomic `incrementReinforcement`, so only the count survives
correctly.

The fold episode pass has the same blindness for links: fragments inserted earlier in the job are
not returned by `findByCharacterAndSourceMessageIds` (`lib/memory/fold-episode-pass.ts:167-170`).

## Why it survived

The gate's tests run in one process against a real database, where reads see writes. The child's
read-your-writes detector only warns, and the outcomes look like ordinary extraction noise: an
extra row, a missing link, a shorter footnote list.

## Fix

Phase C moves admission into the parent. The child still extracts and embeds; for each candidate
it calls host-RPC `admitMemory`, and the parent runs top-K search, hydration, the pure
`decideAdmission`, the write and the index update against its read-write connection. Combining two
rows goes through one `foldInto`, with `reinforcementCount` applied as a delta. The second
candidate in a job then sees the first's row, links and footnotes. `patchMemory`'s buffered-write
fallback and `countReinforcement`'s local view are deleted.

## Verify

In-job test (Phase C): one extraction job yielding two near-identical candidates produces one row
with `reinforcementCount: 2`. Two band candidates against one neighbour leave both ids in its
`relatedMemoryIds`. Two reinforcements of one row leave both candidates' footnotes (subject to the
footnote cap).
