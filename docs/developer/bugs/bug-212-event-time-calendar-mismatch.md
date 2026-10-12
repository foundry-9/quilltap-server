# Bug 212 — A memory written as "last night" misses the recall window for "last night"

| | |
|---|---|
| **Status** | Open — closed by Phase A of the [memory system refactor](../features/memory-system-refactor.md) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix C) |
| **Fixed** | — |
| **Severity** | Medium — retrospective recall ("what did we do last night?") excludes or fails to boost exactly the memories it was built to find; how often depends on the phrase and the server's timezone |
| **Who it bites** | realtime-timeline chats whose memories carry an `occurredAt` resolved from a relative phrase, then asked about with a day reference; "last night" fails in every timezone, "yesterday" and "last week" in timezones west of UTC |
| **Provenance** | Original to v4. The write side came in with the episodic recall overhaul (`resolveWhenPhrase`); the read side's local-calendar windows came later with `day-references.ts`, whose header comment explains why it rejected UTC — the write side was not brought along |
| **Defect site** | `lib/memory/episodic.ts:106-109` (`isoDateFromMs`, midnight UTC), `:126-217` (`resolveWhenPhrase`; "yesterday / last night" at `:172-174`); `lib/memory/day-references.ts:90-98`, `:129-163` (local windows); `lib/memory/cheap-llm-tasks/memory-tasks.ts:1557-1559` (date-only `timeRange` as UTC days) |
| **Fix site** | Phase A of the refactor — `time/` (`MemoryClock`, one `DAY_REFERENCE_TABLE` for `resolveEventTime` and `resolveReferenceWindow`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

At 14:00 on 2026-10-12 (America/Chicago, UTC−5) a character says "Last night we walked to the
lighthouse." Extraction stores `occurredAt: 2026-10-11T00:00:00.000Z` — 19:00 on October 10,
local. Later that afternoon the user asks "Do you remember last night?" The day-reference scan
resolves "last night" to 2026-10-11 18:00 → 2026-10-12 06:00 local
(`2026-10-11T23:00Z` → `2026-10-12T11:00Z`). The memory's event time is outside the window, so the
`window↑` multiplier does not fire and, when the window is applied as a hard filter, the memory is
dropped.

The same mismatch on "last night" holds at UTC and at every positive offset, because the write
side stamps midnight and the read side's window starts at 18:00.

## Root cause

Three calendars answer one question:

- **Write side, UTC point dates.** `resolveWhenPhrase` (`episodic.ts:126`) returns
  `isoDateFromMs(anchorMs − 1 day)` for "yesterday" and "last night" (`:172-174`), and
  `isoDateFromMs` stamps midnight UTC of that UTC date (`:106-109`). "Last week" is anchor − 7 days
  at midnight UTC (`:194`), "last <weekday>" uses `getUTCDay` (`:204`). Callers:
  `memory-processor.ts:266` and `fold-episode-pass.ts:122` via `resolveEpisodicAnchors`
  (`episodic-anchors.ts:52`), and `applyEpisodicFallbackAnchors` (`memory-service.ts:209`).
- **Read side, server-local windows.** `day-references.ts` deliberately uses local-time accessors
  (header, `:12-16`): "last night" is previous day 18:00 to today 06:00 local (`:129-134`),
  "yesterday" the previous local day (`:137-143`), "last week" the previous Monday-anchored local
  week (`:157-163`).
- **Classifier, UTC days.** When the keyword-distillation model returns a date-only `timeRange`,
  it is widened to `T00:00:00.000Z` → `T23:59:59.999Z` (`memory-tasks.ts:1557-1559`), a UTC day.
  A deterministic day reference, when found, overrides it (`mergeDayReference`), so this third
  calendar applies only to phrases the scan does not know.

The window is compared against `occurredAt ?? createdAt` (`recall-tags.ts:437-453`), and is either
a hard filter or a ×1.3 boost depending on how many hits fall inside it (`searchMemoriesSemantic`).

## Why it survived

Each side has its own tests, each correct against its own calendar. The day-reference module was
written to fix the classifier's UTC problem on the read side; the write side was out of its scope.
The dev instance runs in a US timezone where "yesterday" also misses, but a missed boost looks like
ordinary ranking.

## Fix

Phase A adds `time/` with one `MemoryClock` per instance (instance `timezone` →
`QUILLTAP_TIMEZONE` → system; the per-chat timezone stays display-only) and one rule table that
drives both directions. On write, "last night" stamps `occurredAt` at the start of the same local
window the read side asks for; "last week" is the previous local calendar week on both sides. The
classifier's date-only ranges become local days. Existing rows keep their UTC-point values (no
backfill); the help page documents the one-day skew.

## Verify

With the clock's timezone fixed to America/Chicago, a table test resolves each phrase in the rule
table on write and on read from the same anchor, and asserts the written `occurredAt` falls inside
the read window. Live: say "last night we …", then ask about "last night" in the same chat; the
debug memory log shows `window↑` on that memory.
