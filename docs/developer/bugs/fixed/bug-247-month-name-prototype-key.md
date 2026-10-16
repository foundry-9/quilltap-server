# Bug 247 — a `when` phrase naming "constructor" as its month throws, and fails the whole extraction job

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-13, the v5 port's differential harness (P4.D289, the `memory_time` family at the `83334b9a5` pin); reproduced 2026-10-14 at `8489d08b9` |
| **Fixed** | 2026-10-16 |
| **Severity** | Low — needs a model to emit a `when` of exactly the named-date shape with `constructor` as the month word (`"constructor 5"`, `"5 constructor"`, `"on constructor 5"`, `"constructor 5th"`, `"constructor 5, 2026"`). When it does, the job fails rather than the one draft |
| **Who it bites** | memory extraction on any chat: a SELF/OTHER turn job, the fold passes, Carina, the dry run — every path that resolves a draft's `when` through `resolveEpisodicAnchors` |
| **Provenance** | Original to v4. The named-date branch has looked month words up in a plain object literal since the episodic-spine `resolveWhenPhrase` (`8bf3cb5f`); the memory refactor moved it unchanged into `lib/memory/time/clock.ts` (`e0ac7493a`) |
| **Fix site** | `lib/memory/time/clock.ts` (`lookupWord`, own keys only, for `MONTH_NAMES` / `WORD_NUMBERS` / `UNIT_DAYS`); `lib/memory/time/anchors.ts` (`resolveEpisodicAnchors` never throws) |
| **Defect site** | `lib/memory/time/clock.ts:94-97` (`MONTH_NAMES` is a `Record<string, number>` object literal, so it inherits `Object.prototype`) and `:160-165` (`MONTH_NAMES[monthFirst[1]] !== undefined` / `MONTH_NAMES[dayFirst[2]] !== undefined` accept an inherited key); the throw escapes `lib/memory/extraction/run.ts:308` (`resolveEpisodicAnchors` sits outside `admitDraft`'s `try`, which guards only `admitCandidate`) |
| **v5 status** | v5's port uses a closed month table, so the phrase resolves to no event time; the divergence is pinned both ways as `PROTOTYPE_KEY_MONTH_THROWS` in the `memory_time` family (P4.D289). Converged by this fix — the v5 pin can be retired |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-16).** The three word tables are read only through `lookupWord`, which answers
`Object.hasOwn` keys, so `constructor 5` and its four sibling shapes resolve to
`{ occurredAt: null, window: null }` like any other unknown phrase. Separately, `resolveEpisodicAnchors`
now catches a parser throw and keeps the fallback, so one malformed `when` costs that draft its event time
and never the job. Pinned by rows in `lib/memory/time/__tests__/rule-table.test.ts` and two cases in
`anchors.test.ts` (one substitutes a throwing parser).

## Symptom

A model's extraction draft carries `when: "constructor 5"` (or `"5 constructor"`, `"on constructor 5"`,
`"constructor 5th"`, `"constructor 5, 2026"`). Resolving it throws `RangeError: Invalid time value`.
For a turn job the throw leaves `runTurnExtraction` and fails the job: the queue retries it (up to
three attempts by default, `queue-service.ts:522`), re-spending the cheap-LLM call each time. The drafts after the bad one, the OTHER pass and the turn cursor's advance never
happen, and a draft admitted before it in the same pass has already been written.

Reproduced at `8489d08b9` under `TZ=UTC`:

```
resolveEventTime('constructor 5', Date.parse('2026-07-14T09:30:00.000Z'), { timeZone: 'UTC' })
  → RangeError: Invalid time value
resolveEventTime('July 5', …)         → { occurredAt: '2026-07-05T00:00:00.000Z', window: null }
resolveEventTime('tostring 5', …)     → { occurredAt: null, window: null }
resolveEpisodicAnchors({ when: 'constructor 5', … })  → RangeError: Invalid time value
```

## Root cause

`MONTH_NAMES` is an object literal, and the named-date branch tests membership with
`MONTH_NAMES[word] !== undefined`. The phrase is lower-cased and the month word must match `[a-z]+`,
so the only `Object.prototype` key that can reach the lookup is `constructor` (measured: it is the one
all-lowercase own property of `Object.prototype`). `MONTH_NAMES['constructor']` is the `Object`
function, so the branch takes it as a month: `zonedTimeToUtcMs(year, Object, day, 0, tz)` passes it to
`Date.UTC`, which coerces it to `NaN`, so the first-pass guess is `NaN` and `offsetMs` → `zonedParts`
hands `new Date(NaN)` to `Intl.DateTimeFormat#formatToParts`, which throws
(`clock.ts:167` → `calendar.ts:152` → `:134` → `:120`, measured at `8489d08b9`).

`resolveEpisodicAnchors` → `resolveWhenPhrase` → `resolveEventTime` has no catch, and
`extraction/run.ts:308` calls `resolveEpisodicAnchors` before the `try` that protects one candidate's
admission. `applyEpisodicFallbackAnchors` (`admission/prepare.ts:72-106`) is the one caller that is
safe: its `catch` returns the row unchanged.

The other word tables (`WORD_NUMBERS`, `UNIT_DAYS`) are read the same way but are harmless:
`WORD_NUMBERS['constructor']` is a function, and `0 < n` is false for it, so no stamp is made; the
unit word is constrained by its regex to `days?|weeks?|months?|years?`.

## Why it survived

The rule-table and day-reference tests feed real month names and real phrases; nothing feeds a word
that names an inherited property, and the throw only shows in a job's failure log.

## Fix

Look month words up as own keys: build `MONTH_NAMES` with `Object.create(null)` (or as a `Map`), or
test `Object.hasOwn(MONTH_NAMES, word)`. Doing the same for `WORD_NUMBERS` and `UNIT_DAYS` keeps the
pattern from recurring. Separately, moving the `resolveEpisodicAnchors` call inside `admitDraft`'s
per-candidate guard — or giving `resolveEventTime` a never-throws contract like
`applyEpisodicFallbackAnchors` — would make one malformed `when` cost that draft only, as the guard's
comment intends.

## Verification

`resolveEventTime('constructor 5', …)` and the other four shapes answer `{ occurredAt: null, window: null }`;
a rule-table test row pins them. An extraction pass whose model answer carries `when: "constructor 5"`
admits the draft with the fallback `occurredAt` and finishes the pass.
