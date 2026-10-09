# Bug 183 — a wear date in "last week" or "last month" reads "last last week"

| | |
|---|---|
| **Status** | OPEN |
| **Found** | 2026-10-09, the v5 port's dogfood walk of the wardrobe programme against a copy of `Friday` (Friday's wardrobe dialog showed `Worn 8× · last last week`) |
| **Severity** | Low — wording only; the date is right. It shows on every wardrobe row, wear-history line and `wardrobe_read` answer whose last wear is 7–13 or 30–59 days old |
| **Who it bites** | anyone reading a wardrobe row or an item's wear history, and every character whose `wardrobe_read` reports a wear 7–13 or 30–59 days old (the doubled word reaches the model) |
| **Provenance** | Original to v4 (the wear ledger, `3ee3b1342` / `7c8572869`). `formatRelativeDays` (`lib/format-time.ts`) was written for memory-recall labels, where "last week" stands alone; the wear lines put the word "last" in front of it |
| **Defect site** | `lib/wardrobe/wear-display.ts:57` (`` `${count} · last ${when}` ``); `lib/tools/handlers/wardrobe-read-handler.ts:179-183` (`` `last ${last}` `` where `last` starts with the relative date); `components/wardrobe/wardrobe-item-editor/WardrobeWearHistorySection.tsx:142` (`` {w.wearCount}×, last {relative(w.lastWornAt)} ``) |
| **v5 status** | Faithful — v5 renders the same strings (`apps/web/src/app/wardrobe/wear-display.ts`, `apps/web/src/app/wardrobe/item-editor/wear-history-section.ts`, `crates/quilltap-core/src/tools/wardrobe_read.rs`); it will follow v4's fix |
| **Index** | [bugs.md](../bugs.md) |

---

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

Not done. Options:

- Have the three renderers say `last worn …` instead of `last …` (`Worn 8× · last worn last week`,
  `…, last worn last week by you.`, `8×, last worn last week`). One word at each site; the ladder is
  untouched.
- Or map the two rungs at the wear call sites (`last week` → `a week ago`, `last month` → `a month ago`)
  through a small wrapper over `formatRelativeDays`, leaving the memory-recall labels as they are.

Either way, add the 7–13 and 30–59 day cases to the `formatWearLine` and `formatWardrobeWearParagraph`
tests.
