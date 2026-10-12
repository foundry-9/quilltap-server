# Bug 212 — A memory written as "last night" misses the recall window for "last night"

| | |
|---|---|
| **Status** | Fixed 2026-10-12 (targeted fix ahead of Phase A) |
| **Found** | 2026-10-12, code audit for the memory system refactor (appendix C) |
| **Fixed** | 2026-10-12 |
| **Severity** | Medium — retrospective recall ("what did we do last night?") excludes or fails to boost exactly the memories it was built to find; how often depends on the phrase and the server's timezone |
| **Who it bites** | realtime-timeline chats whose memories carry an `occurredAt` resolved from a relative phrase, then asked about with a day reference; "last night" fails in every timezone, "yesterday" and "last week" in timezones west of UTC |
| **Provenance** | Original to v4. The write side came in with the episodic recall overhaul (`resolveWhenPhrase`); the read side's local-calendar windows came later with `day-references.ts`, whose header comment explains why it rejected UTC — the write side was not brought along |
| **Defect site** | `lib/memory/episodic.ts:106-109` (`isoDateFromMs`, midnight UTC), `:126-217` (`resolveWhenPhrase`; "yesterday / last night" at `:172-174`); `lib/memory/day-references.ts:90-98`, `:129-163` (local windows); `lib/memory/cheap-llm-tasks/memory-tasks.ts:1557-1559` (date-only `timeRange` as UTC days) |
| **Fix site** | `lib/memory/memory-calendar.ts` (new: one calendar, instance timezone → `QUILLTAP_TIMEZONE` → system), `lib/memory/memory-calendar-refresh.ts` (new), `lib/memory/episodic.ts` (`resolveWhenPhrase`, `buildMemoryAnchorLine`), `lib/memory/day-references.ts`, `lib/memory/cheap-llm-tasks/memory-tasks.ts` (date-only `timeRange`, TODAY/CLOCK lines), `lib/memory/memory-processor.ts`, `lib/memory/fold-episode-pass.ts`; `help/episodic-memory.md`, `help/chat-settings.md` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** Targeted fix ahead of Phase A. New `lib/memory/memory-calendar.ts` holds one calendar per instance (locked decision 10): the Salon-level `ChatSettings.timezone` → `QUILLTAP_TIMEZONE` → the system zone; the per-chat timestamp timezone is not consulted. It is pure `Intl` math (`zonedParts`, `zonedTimeToUtcMs`, `startOfZonedDayMs`, `startOfZonedWeekMs`, `zonedDayBoundsIso`); the instance setting is read asynchronously by `refreshMemoryTimeZone` (`memory-calendar-refresh.ts`, 5-minute cache, never throws) at the extraction, episode-pass and per-turn distillation entry points. `resolveWhenPhrase` now stamps each phrase the read side also knows at the **start of the read window** on that calendar: "last night" → 18:00 local the day before, "yesterday" / "day before yesterday" / "N days ago" → local midnight, "last week" → Monday 00:00 of the previous local week, "this week" → the anchor; ISO dates and named dates are local midnights, "last <weekday>" uses the local weekday. `resolveDayReference` takes the same calendar instead of bare `Date` local accessors. The distillation's date-only `timeRange` is widened to local days, and its TODAY line and the extraction CLOCK block render the local date. The embedding anchor line renders `occurredAt` as a local date. No backfill: older rows keep their UTC-midnight `occurredAt`; `help/episodic-memory.md` documents the one-day skew. Tests: `lib/memory/__tests__/memory-calendar.test.ts` (America/Chicago table test: 13 shared phrases × 5 anchors including a DST change, written `occurredAt` inside the read window; local-day bounds; zone precedence), `memory-calendar-refresh.test.ts`, new cases in `memory-search-day-reference.test.ts`; `episodic.test.ts` updated for the new "last week" / "last night" stamps. **Amended after the owner's review of PR 90:** the no-backfill choice is reversed. Migration `rezone-legacy-memory-occurred-at-v1` re-stamps each legacy UTC-midnight `occurredAt` at local midnight of the same date in the instance zone (no `createdAt` cutoff: the migration runs before the new resolver writes anything, so every UTC-midnight row on an ordinary upgrade is legacy; only a development instance that ran this code before the migration, in a UTC−6 zone, can hold a post-fix "last night" that is also a UTC midnight), and the help page no longer documents a skew. Every embedding-text builder and extraction prompt now resolves the zone first (`refreshMemoryTimeZone`, carried on `ExtractionClock.timeZone` to the `when` resolver), so a cold job child cannot render a different date than the parent. Tests: `__tests__/unit/lib/database/migration/rezone-legacy-memory-occurred-at-v1.test.ts`, `__tests__/unit/lib/memory/memory-anchor-zone.test.ts`, `__tests__/unit/lib/memory/memory-processor-zone.test.ts`, `lib/memory/cheap-llm-tasks/__tests__/memory-extraction-clock-zone.test.ts`.

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
