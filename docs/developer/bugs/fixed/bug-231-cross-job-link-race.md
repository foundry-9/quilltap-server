# Bug 231 — Two overlapping extraction jobs can overwrite each other's memory links and footnotes

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase C of the [memory system refactor](../../features/complete/memory-system-refactor.md); admission in the parent remains the structural work) |
| **Found** | 2026-10-12, while fixing bug 209 |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — needs two jobs touching the same existing memory at once; the loss is one link or one reinforcement's footnotes, never a row or a count |
| **Who it bites** | busy chats and multi-character rooms where two extraction jobs (per-turn, fold, Carina, catch-up) run at the same time for the same character |
| **Provenance** | Original to v4. The cross-job half of bug 209; bug 209's fix closed only the same-job half |
| **Defect site** | `lib/memory/memory-gate.ts:733-739` (`linkRelatedMemories` writes `[...existingRelated, newMemoryId]` as an absolute list); `reinforceMemory` (absolute content patch built from the snapshot it read); the job runner's global cap of 4 concurrent jobs (`lib/background-jobs/processor.ts`) |
| **Fix site** | `lib/database/repositories/memories.repository.ts` (new `addRelatedMemoryIds`, `removeRelatedMemoryIds`, `appendReinforcementFootnotes`), `lib/memory/reinforcement-footnotes.ts` (new), `lib/memory/memory-gate.ts` (`linkRelatedMemories`, `reinforceMemory`), `lib/memory/fold-episode-pass.ts`, `lib/memory/memory-edit.ts`, `lib/background-jobs/child/child-repositories-proxy.ts` (overlay deltas) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Related links and reinforcement footnotes are written as deltas

**Memory refactor Phase C (2026-10-13).** Admission's links, footnotes and counts are written in the parent (`lib/memory/admission/apply.ts`), still as deltas. The two-job cases moved to `__tests__/unit/lib/background-jobs/admission-host-rpc.test.ts`; the overlay test file is now `child-proxy-memory-overlay.test.ts`.
against the row as it stands at write time, never as whole values built from a job's snapshot.
`MemoriesRepository.addRelatedMemoryIds` / `removeRelatedMemoryIds` read and rewrite one row's
`relatedMemoryIds` inside a single SQLite transaction, and `appendReinforcementFootnotes` re-reads the
content there and applies the `[+]` cap and an "already there" check against it (the footnote helpers
moved to the pure `lib/memory/reinforcement-footnotes.ts` so the repository can share them). The
gate's `linkRelatedMemories`, `reinforceMemory`'s footnotes, the fold episode pass's fragment links
and the memory editor's neighbour links all write through them. In the job child they are buffered
like any write and replayed by the parent against the live row, so two jobs touching one memory
both land; the per-job overlay applies the same deltas to later reads in the job. Tests:
`__tests__/unit/lib/database/repositories/memories-link-deltas.test.ts` (real SQL) and the bug 231
block in `__tests__/unit/lib/background-jobs/child-proxy-memory-gate-overlay.test.ts` (two jobs over
one snapshot, replayed in turn).

## Symptom

Two extraction jobs running at once each add a related link to the same neighbour memory; after
both commit, the neighbour lists only one of them. Likewise two jobs that each reinforce the same
memory leave only one job's `[+]` footnotes. The reinforcement count is correct, since it is an
atomic increment (bugs 182, 226).

## Root cause

Each job reads the neighbour in its own child snapshot and writes the whole `relatedMemoryIds` list,
or the whole new content, as an absolute value. The parent commits each job's batch in turn, and the
later batch replaces what the earlier one wrote. Bug 209's per-job overlay makes a job see its *own*
buffered writes; it cannot see another job's.

## Why it survived

It needs two jobs to overlap on one memory, and the loss looks like ordinary extraction noise. Bug
209's in-job tests cover a single job only.

## Fix

Phase C moves admission into the parent, where each candidate reads and writes the live row
in turn, and combines rows through one `foldInto`. A targeted alternative is an atomic
repository operation that unions an id into `relatedMemoryIds`, plus a re-read of the content
inside the write transaction for footnotes.

## Verify

Two extraction jobs, interleaved so both read a neighbour before either commits, each adding a
band candidate against it. After both commit the neighbour lists both new ids. The same setup with
two reinforcements leaves both footnotes (subject to the footnote cap).
