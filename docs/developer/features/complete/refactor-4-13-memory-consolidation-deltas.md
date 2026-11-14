# Refactor 4.13 — Consolidation writes as deltas, and one date stamp and transcript renderer for memory prompts

**Status:** Complete (2026-11-11). Phases 1–6 done; phase 7 struck (decision 1: no column — see §9); decision 3 answered with a startup migration. Originally proposed 2026-11-10, written against `HEAD` = 167d06503. Part of the [4.13 refactor set](../refactor-4-13.md). Fixes #187. Finishes what the [memory-system refactor](memory-system-refactor.md) recorded as left for its Phase F.

Line numbers are from the audit and will drift. Re-locate each site by name before editing.

**Almost everything in §4.2 is a traced mechanism, not a reproduced bug.** This spec's first phase is to write the interleaving and boundary tests; an item whose test passes on `HEAD` is struck from the spec.

## 1. The problem

CLAUDE.md states the rule for memory writes: "wherever one memory takes in others the plan is `foldInto` and the writes `applyFold` (parent only): counts, footnotes and links as deltas, never an absolute count", admission is "serialised per character", and "never write a memory row, count or link around them."

Consolidation is the last path that does not follow it. `lib/memory/consolidation.ts` (926 lines) with `consolidation-plan.ts` reads the corpus once at the start of a maintenance run (`lib/memory/maintenance/run.ts:254-256`), plans, and then writes **absolute** `reinforcementCount`, `relatedMemoryIds` and `consolidatedFrom` values computed from that snapshot (`consolidation.ts:497-506`, `:520-522`; `consolidation-plan.ts:319-323`, `:345`, `:375-392`, `:446-453`). It takes no admission lock. Whatever admission wrote to those rows between the read and the write is overwritten.

A second, smaller family lives in the prompts the memory system builds:

- Five sites print a date to a model by slicing an ISO timestamp's first ten characters (`lib/memory/recall/conversations.ts:258`, `recall/tags.ts:795`, `commonplace-file.ts:77`, `cheap-llm-tasks/consolidation-tasks.ts:354`, `cheap-llm-tasks/chat-tasks.ts:659`). That is the UTC day, not the instance calendar's (#187). CLAUDE.md: event time and reference windows "go through one `MemoryClock` on the instance calendar".
- Transcripts for cheap-LLM passes are rendered by hand in several places. Three formatters in `cheap-llm-tasks/chat-tasks.ts` (`:147`, `:421`, `:581`) emit `${role.toUpperCase()}: ${content}`; `image-scene-tasks.ts:651`, `:727`, `:969` and `recall/query.ts:205` use `User` / `Character` ternaries. CLAUDE.md: "a transcript sent to a cheap LLM is labelled by speaker, never by role" and "a new cheap-LLM pass over conversation turns calls the resolver; it does not re-derive one." The title passes (`titleChat` at `chat-tasks.ts:319-329`, `considerTitleUpdateWithPrompt` at `:420-422`) are verified to label by role; only a title is at stake there, but it is the same violation that produced bug 161.

## 2. Goal

- `executePlan` issues deltas through the same writers admission uses, under the per-character admission lock, and filters ids that no longer exist at write time.
- One `memoryDateStamp(iso)` on the `MemoryClock`; no `.slice(0, 10)` on a timestamp under `lib/memory/`.
- One `renderLabelledTranscript(messages, speakerNames)` over `speakerLabel`; no role-labelled transcript under `lib/memory/` or `lib/image-gen/`.

## 3. Non-goals

- The consolidation planner's decisions (what to merge, what contradicts what), except the marker in §5.2.
- Admission, recall assembly and delivery, scoring. Audited and sound: the admission lock and idempotency ledger, `decideAdmission`'s band edges, fold deltas, `retireMemories`' cascade, the maintenance budget split, the calendar and DST rules.
- Tuning any constant.

## 4. Known state

### 4.1 Verified by reading (2026-11-10)

`conversations.ts:258` and `commonplace-file.ts:77` slice the timestamp; `titleChat` and `considerTitleUpdateWithPrompt` render by role.

### 4.2 Traced by the audit, not independently re-verified

- **A9. Consolidation overwrites concurrent admission writes.** As §1. Outcomes claimed: one-way links, a rewound `reinforcementCount` / `lastReinforcedAt`, retired ids written back into `relatedMemoryIds` / `consolidatedFrom`. The memory-refactor spec records the absolute count as staying "with the planner until Phase F", so this is known debt.
- **A7. A restated fact marked "contradicted" is absorbed into the row that says the opposite.** `consolidation-plan.ts:278-285`, `:432-441` send the older row cold with `supersededById` naming the carrier of the newer fact. `admission/neighbours.ts:170-188` (`resolveDigest`) follows any `supersededById` without checking that the target is a CONSOLIDATED row listing the member; `admission/decide.ts:130-133` then absorbs. Sequence: "prefers coffee" is superseded by a digest saying "prefers tea now"; extraction later produces "prefers coffee" again; the reverted fact is never stored and the now-false digest gains a count and a fresh `lastReinforcedAt`.
- **A13. A reinforcement from a regenerate or backfill is stamped wall-clock now** (`admission/admit.ts:571`, `:579-584`), while inserts from the same job are dated to their source message (`admission/apply.ts:64-66`). After `MEMORY_REGENERATE_CHAT` over an old chat, restated memories read as zero days old for salience.
- **A14. The anti-repetition ring is one three-slot list per chat shared by every character** (`recall/history.ts:18`, `:79-85`; `recall/deliver.ts:149-158`; reader `recall/tags.ts:765`). In a room of four or more, by a character's next turn the ring holds only the others' heads, so `recentlyWhispered` never fires for them.
- **A20.** `time/clock.ts:238-251`: "latest match wins" includes future phrases, so "yesterday … and tomorrow" loses the past reference. `:155-159` / `:276-277` parse a zone-less ISO string from a model in the server's system zone rather than the instance calendar's.
- **Dead on the way:** `summarizeChat` (`chat-tasks.ts:139`) and `updateContextSummary` (`:573`) have no callers outside the index re-export (`cheap-llm-tasks/index.ts:78`, `:88`); about 90 lines with their prompts. Confirm with `rg -w` before deleting.

## 5. Design

### 5.1 The plan emits deltas

```ts
interface ConsolidationWrite {
  memoryId: string
  addLinks?: string[]; removeLinks?: string[]
  countDelta?: number
  addMembers?: string[]            // consolidatedFrom
  reinforcedAt?: string            // max() with the row's current value, never an overwrite
}
```

`executePlan` runs in the parent, takes the per-character admission lock for the write section, re-reads the rows it is about to touch, drops any id that no longer exists (and any write whose target is gone), and applies through `linkBothWays`, the reinforcement increment and `applyFold`'s member writer. Digest inserts stay a sanctioned direct insert, as CLAUDE.md lists.

Holding the admission lock for a whole consolidation would stall a turn's memory writes. Take it per write batch (one digest and its members), not per run.

### 5.2 Contradiction gets its own marker

`supersededById` means "folded into this digest". A contradiction is a different relation. Either a new nullable column (`contradictedById`) or a kind tag beside the existing one; the column is the simpler read. `resolveDigest` redirects only when the superseder is CONSOLIDATED **and** its `consolidatedFrom` includes the member, which is correct regardless of the marker and is the first fix to land.

A new column means: a migration (pretty label, `reportProgress` if it loops), `DDL.md`, the `.qtap` export and import and `qtap-export.schema.json`, backup and restore, and the id-field table from the [import/restore spec](refactor-4-13-import-restore-insert-and-remap.md).

### 5.3 Reinforcement time

`admit.ts` stamps a reinforcement with `row.sourceMessageTimestamp ?? now`, matching the fold path.

### 5.4 The ring per character

Key the ring by character (a map of three-slot lists) or keep one list and filter by character on read with a larger cap. The stored shape changes; the ring is delivery-side state written only by `deliverRecall`, so the change is contained. Check whether it is in export and backup.

### 5.5 Date stamp and transcript

- `memoryDateStamp(iso, clock)` → `zonedDateStamp(Date.parse(iso), clock.timeZone)` (`lib/memory/time/calendar.ts`). The five sites call it. Extend the existing scoring/time grep-test to forbid `.slice(0, 10)` under `lib/memory/`.
- `renderLabelledTranscript(messages, speakerNames, opts?)` in `lib/chat/speaker-names.ts` beside `speakerLabel`. Every hand formatter listed in §1 calls it, with names from `resolveSpeakerNames`. A grep-test forbids `role.toUpperCase()` and the `'User' : 'Character'` ternaries in prompt-building code.

## 6. Phases

1. **Tests that decide the scope.** An interleaving test for A9 (admission writes between consolidation's read and write); a sequence test for A7; boundary tests for A13, A14, A20. Strike what passes.
2. **#187**: `memoryDateStamp` at the five sites, test with a 03:44Z timestamp on an America/Chicago calendar.
3. **`renderLabelledTranscript`**; the title passes first; delete the two caller-less functions.
4. **`resolveDigest`'s guard** (A7, no schema change).
5. **Consolidation deltas** (A9).
6. **Reinforcement time, the ring, the clock items**, as confirmed.
7. **The contradiction marker**, if decision 1 says yes.

## 7. Tests and gates

- The pure planner tests exist; the new tests are for `executePlan` against real rows.
- Replay on a copy of a real corpus with `quilltap recall-replay` before and after phases 5 and 6; recall output should differ only where a defect was fixed.
- Expected size: medium; about 150 lines removed, most of the work is the write path. Medium–high risk: this is memory data. Run it on V4test, never Friday, and back up first.
- CHANGELOG cites `#187` and any issue filed from §4.2. `help/` only if recall behaviour visibly changes.

## 8. Decisions for the human

1. A separate contradiction marker with a new column (proposed), or keep `supersededById` and rely on the `resolveDigest` guard alone?
2. The anti-repetition ring: three slots per character (proposed), or keep it per chat and widen it?
3. Existing rows whose counts or links were damaged by A9, if it reproduces: leave them, or add a repair arm to `?action=repair` beside `scrubDanglingMemoryLinks`?

## 9. Outcome (2026-11-11)

Phase 1's tests decided the scope; every item in §4.2 reproduced, none was struck.

| Item | Test | Fix |
|---|---|---|
| A9 | `__tests__/unit/lib/memory/consolidation-writes.test.ts` (admission reinforces the digest, links to it, links to a member, and retires a link target between the read and the write) | `applyConsolidationPlan` (`lib/memory/admission/consolidation-writes.ts`), parent only, host-RPC `applyConsolidation` from the child. One lock per cluster. Count by `incrementReinforcement(by)` capped at write time, members by `addConsolidatedMembers`, links by `linkBothWays` / `removeRelatedMemoryIds`, inbound links re-aimed from `findIdsLinkingTo` at write time. |
| A7 | `lib/memory/__tests__/admission-neighbours.test.ts` ("a contradicted row is not a member") | `resolveDigest` follows a hop only to a `CONSOLIDATED` row whose `consolidatedFrom` lists the member. No schema change. |
| A13 | `__tests__/unit/lib/memory/admission-admit.test.ts` ("dated to its source message") | `row.sourceMessageTimestamp ?? now` for both reinforcement paths. |
| A14 | `__tests__/unit/lib/memory/ranking-blend.test.ts` ("in a room of four"), `recall-replay.test.ts` | Ring keyed by character (decision 2 as proposed). Not in export or backup (`ndjson-writer.ts` strips it; a restore carries the column as an opaque JSON value). |
| A20 | `lib/memory/time/__tests__/day-references.test.ts`, `memory-date-stamp.test.ts` | Latest *past* match wins; `parseInstantOnCalendar` for zone-less ISO strings. The old test that pinned "future suppresses past" was the defect, and was flipped. |
| #187 | `memory-date-stamp.test.ts` (03:44Z on America/Chicago) | `memoryDateStamp` at every site; grep-test in `scoring-chokepoint.test.ts`. |
| Transcripts | `__tests__/unit/lib/chat/labelled-transcript.test.ts` (with grep-test) | `renderLabelledTranscript`. |

**One deliberate deviation from §5.1.** The spec says the writer "drops any id that no longer exists". It does that for link targets, tier moves and re-aims, but a digest whose *member* is gone (or whose existing text changed since the read — a footnote landed) is not written at all: the model's text summarises that member, and writing it would put a fact the operator deleted back into the book. The cluster is reported `changed` and stays unconsidered, so the next run re-plans it from the rows as they are.

**Decision 1 — no new column (2026-11-11).** An audit of every reader of `supersededById` found none that mistreats a contradicted row once the `resolveDigest` guard is in:

- Digest liveness in `retireMemories` asks `consolidatedFrom` first, so a contradicted row never keeps a digest alive.
- Deleting the row that carries the newer fact clears the contradicted row's `supersededById` (the orphan scrub), and it re-enters consolidation as a demoted row. That is the right outcome: the evidence against it is gone.
- Retention retires a contradicted cold row on the same clock as a folded member.
- Graph repair and the CLI's `memories validate` flag only a superseder that no longer exists.
- Labels were the only casualty: the memory card's "Superseded by a digest" now reads "Superseded by a newer memory", and the Brahma SQL prompt describes both meanings.

**Decision 3 — a startup migration, not a repair arm.** Rewound counts left by A9 cannot be recovered (nothing records what they should have been), and links to retired ids are already `scrubDanglingMemoryLinks`' work. One-way links can be found and fixed exactly, so `symmetrize-memory-links-v1` adds the missing reverse side between two existing rows of the same holder, once, at startup. It removes nothing and leaves cross-holder links alone.

**Not done:** phase 7 (struck by decision 1). The `recall-replay` before/after comparison on a real corpus (§7) is for the human to run on V4test.

