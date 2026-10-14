# Bug 183 — a wear date in "last week" or "last month" reads "last last week"

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, the v5 port's dogfood walk of the wardrobe programme against a copy of `Friday` (Friday's wardrobe dialog showed `Worn 8× · last last week`) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | Low — wording only; the date is right. It shows on every wardrobe row, wear-history line and `wardrobe_read` answer whose last wear is 7–13 or 30–59 days old |
| **Who it bites** | anyone reading a wardrobe row or an item's wear history, and every character whose `wardrobe_read` reports a wear 7–13 or 30–59 days old (the doubled word reaches the model) |
| **Provenance** | Original to v4 (the wear ledger, `3ee3b1342` / `7c8572869`). `formatRelativeDays` (`lib/format-time.ts`) was written for memory-recall labels, where "last week" stands alone; the wear lines put the word "last" in front of it |
| **Defect site** | `lib/wardrobe/wear-display.ts:57` (`` `${count} · last ${when}` ``); `lib/tools/handlers/wardrobe-read-handler.ts:179-183` (`` `last ${last}` `` where `last` starts with the relative date); `components/wardrobe/wardrobe-item-editor/WardrobeWearHistorySection.tsx:142` (`` {w.wearCount}×, last {relative(w.lastWornAt)} ``) |
| **Fix site** | `lib/wardrobe/wear-display.ts` (`formatWornRelative`, used by `formatWornWhen`), `lib/tools/handlers/wardrobe-read-handler.ts`, `lib/tools/handlers/wardrobe-list-handler.ts` |
| **v5 status** | Faithful — v5 renders the same strings (`apps/web/src/app/wardrobe/wear-display.ts`, `apps/web/src/app/wardrobe/item-editor/wear-history-section.ts`, `crates/quilltap-core/src/tools/wardrobe_read.rs`); it will follow v4's fix |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** The second option below. New `formatWornRelative` (`lib/wardrobe/wear-display.ts`)
wraps `formatRelativeDays` and maps its two "last" rungs to `a week ago` / `a month ago`, so a wear
line reads `Worn 8× · last a week ago`. `formatWornWhen` (the row line and the item editor's wear
history) and both wardrobe tools go through it; the memory-recall labels that share the ladder are
untouched.

## Symptom

A wardrobe row whose last wear was 7–13 days ago reads `Worn 8× · last last week`; 30–59 days ago,
`Worn 3× · last last month`. The item editor's **Wear history** lists each wearer the same way
(`Laura  8×, last last week`), and `wardrobe_read` tells the character `Worn 9 times, first 14 Mar 2026,
last last week by you.` Other ages read correctly: `last today`, `last yesterday`, `last 3 days ago`,
`last 2 weeks ago`, `last 4 months ago`.

## Root cause

`formatRelativeDays` (`lib/format-time.ts:184-196`) answers a self-contained phrase. Two of its rungs
already begin with "last":

```ts
if (daysOld < 14) return 'last week'
…
if (daysOld < 60) return 'last month'
```

The three wear renderers prefix the phrase with the word `last` (the row line `Worn N× · last …`, the
tool's `…, last … by you.`, the editor's `N×, last …`), so those two rungs come out doubled.
`formatWardrobeListWearNote` (`lib/tools/handlers/wardrobe-list-handler.ts:211`) is unaffected because
it writes `last worn …`, which reads naturally before either phrase.

## Why it survived

The tests pin ages that avoid the two rungs (`today`, `3 days ago`, `2 weeks ago`, `3 weeks ago` —
`__tests__/unit/lib/wardrobe/wear-display.test.ts`, `__tests__/unit/lib/tools/handlers/wardrobe-wear-readout.test.ts`),
as does the doc comment's example (`wear-display.ts:40-41`), and the memory-recall callers that share `formatRelativeDays` never put a
word in front of it.

## Fix

`formatWornRelative(ts, nowMs)` in `lib/wardrobe/wear-display.ts` is the one place a wear date that
follows the word "last" is phrased: it calls `formatRelativeDays` and rewrites exactly `last week` →
`a week ago` and `last month` → `a month ago`. `formatWornWhen` (the Wardrobe dialog's row line and
`WardrobeWearHistorySection`) delegates to it, as do `relativeWearDate` in the read handler and the
list handler's note (which bug 184 rewrote to `worn by you N×, last …`). Option 1 (`last worn …`)
was not taken because the row line and the editor would read `Worn 8× · last worn last week`, which
still doubles the word.

## Verify

- `__tests__/unit/lib/wardrobe/wear-display.test.ts`: `formatWearLine` at 9, 13, 30 and 59 days, and
  `formatWornRelative` across the ladder.
- `__tests__/unit/lib/tools/handlers/wardrobe-wear-readout.test.ts`: the list note and the read
  paragraph at 9 and 40 days.
