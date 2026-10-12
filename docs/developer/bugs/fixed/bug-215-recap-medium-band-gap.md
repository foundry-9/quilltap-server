# Bug 215 — The recap's medium band drops rows whose reinforced importance crossed 0.7

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase A) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix C) |
| **Fixed** | 2026-10-12 |
| **Severity** | Low — a reinforced mid-importance memory is left out of the chat-start recap; nothing is lost from storage or from per-turn recall |
| **Who it bites** | any character whose memories are recapped at chat start or on joining a chat, once a row with raw importance in [0.3, 0.7) has been reinforced to 0.7 or more |
| **Provenance** | Original to v4 |
| **Defect site** | `lib/database/repositories/memories.repository.ts:430-483` (`findRecentByImportanceTier`; medium bucket at `:452-465`) |
| **Fix site** | `lib/database/repositories/memories.repository.ts` (`findRecentByImportanceTier`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Targeted fix ahead of Phase A. `findRecentByImportanceTier` now builds every band from one predicate on `reinforcedImportance` — high `>= 0.7`, medium `>= 0.3 AND < 0.7`, low `< 0.3` — so each hot row falls in exactly one band, and each band's limit is in the query (the medium band no longer loads every hot row ≥ 0.3 and slices in JS). The doc comment now says what the code does. Every row's `reinforcedImportance` is populated (bug 216's migration rewrites any NULL), so there is no fallback to raw `importance`. Tests: `__tests__/unit/lib/database/repositories/memories-recap-bands.test.ts` (the 0.65 → 0.73 row lands in high only; rows on both sides of each boundary; limits pushed into the query).

## Symptom

A memory with `importance` 0.65 that has been reinforced to `reinforcedImportance` 0.73 never
appears in the memory recap (`## What You Remember`). It is in neither the high nor the medium band.

## Root cause

`findRecentByImportanceTier` (`memories.repository.ts:430`) builds three buckets for
`generateMemoryRecap` (`lib/memory/memory-recap.ts:301`):

- high: SQL `importance >= 0.7` (`:441`), raw importance;
- medium: SQL `importance >= 0.3` (`:455`), then a JS filter
  `(m.reinforcedImportance ?? m.importance) < 0.7` (`:460`), reinforced importance;
- low: SQL `importance < 0.3` (`:470`), raw importance.

The high band and the medium band's ceiling read different columns. A row with raw importance
below 0.7 fails the high query, and once its reinforced importance reaches 0.7 the medium filter
throws it out too. Because `reinforcedImportance >= importance` always, the low band is not
affected; only rows in [0.3, 0.7) raw can fall through.

The method's doc comment (`:420-424`) says it "uses reinforcedImportance when available, otherwise
importance" for all three tiers. Only the medium ceiling does.

Secondary: the medium query has no SQL `LIMIT` and loads every hot row with importance ≥ 0.3 for
the character before slicing to 10 in JS.

## Why it survived

The rows that fall through are exactly the reinforced ones, and the recap is a cheap-LLM narrative
over whatever it is given. A missing row reads as the narrative's choice, not as a gap. No test
covers a row whose two importance columns sit on opposite sides of 0.7.

## Fix

Phase A makes `reinforcedImportance` the one importance every filter compares (spec §3.4) and
reduces the band split to one helper, `importanceBand()`, applied to one column. The recap's band
query becomes one `reinforcedImportance` predicate per band, with the SQL doing the limit. The
doc comment is corrected to match.

## Verify

Create a hot AUTO memory with `importance` 0.65, reinforce it until `reinforcedImportance` ≥ 0.7,
and call `findRecentByImportanceTier` for the character: the row appears in exactly one bucket
(high). Add a unit test with rows on both sides of each boundary and both columns.
