# Bug 184 — the wardrobe tools give a character the household's wear count as if it were her own

| | |
|---|---|
| **Status** | OPEN |
| **Found** | 2026-10-09, the v5 port's dogfood walk of the wardrobe programme against a copy of `Friday`. Asked how often she had worn the shared Levi's, Friday answered "one hundred and fifteen times"; her own count was 12. Laura had worn them 25 times, Charlie 14, and twelve others the rest |
| **Severity** | Medium — the model is told a number that is not about the character reading it, and nothing in the tool output says so. A character takes another's favourite as her own staple, or an item she has never worn as one she wore yesterday |
| **Who it bites** | every character that reads shared items (Quilltap General archetypes, group and project wardrobes) through `wardrobe_list` or `wardrobe_read`; own items are rarely affected because usually only their owner wears them |
| **Provenance** | Original to v4 (the wear ledger, `3ee3b1342`). The ledger is per (item, wearer); the tool reads aggregate it per item |
| **Defect site** | `lib/tools/handlers/wardrobe-list-handler.ts:119-146` — `wear_count` / `last_worn_at` come from `repos.wardrobeWear.findSummaries` (`lib/database/repositories/wardrobe-wear.repository.ts:408-425`), which sums every wearer's rows per item; `formatWardrobeListWearNote` (`:205-212`) turns that into ` · last worn …` / ` · never worn`. `lib/tools/handlers/wardrobe-read-handler.ts:170-188` (`formatWardrobeWearParagraph`) — the head gives the household total and names the most recent wearer, but never the reading character's own count |
| **v5 status** | Faithful — v5 ports the same aggregation (`crates/quilltap-core/src/tools/wardrobe_list.rs`, `crates/quilltap-core/src/tools/wardrobe_read.rs`); it will follow v4's fix |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

`wardrobe_list` reports each item's wear as one number with no owner:

```
  [bottom] Levi's blue jeans [shared — read-only] | casual, work, outdoors - … · last worn yesterday
```

with `"wear_count": 115, "last_worn_at": "…"` in the structured result. For the character calling the
tool, nothing marks 115 as everyone's total, and `last worn yesterday` was someone else's wear. An
item she has never worn reads `last worn yesterday` if anyone else wore it, and ` · never worn` only
when no one has.

`wardrobe_read` is closer but still never says how often the reader wore it:

```
wear: Worn 116 times, first 13 Jun 2026, last today by you. Also worn by Laura (25 times),
Gary (7 times), …, Riya (7 times) and Sunny (once).
```

The reader's own count (13) appears nowhere. It can only be worked out by subtracting everyone else's
from the total. When the reader is not the most recent wearer she is listed under *Also worn by*
with her count. When she is, the head names her (`by you`) and drops her count. Asked to look again,
the model on the walk did the subtraction correctly, but only because the user had already told it
the first answer was the household's.

## Root cause

`wardrobe_wear_stats` keeps one row per (item, wearer). `findSummaries` collapses those rows to one
per item (`summarize(rows)`), which suits the wardrobe UI's row line and **Most worn** sort. The
character-facing list reuses the same summary, so the calling character's own rows are summed in with
everyone else's. The read path does keep wearers apart (`buildWearHistoryPayload`), but
`formatWardrobeWearParagraph` composes its head from the total and the latest wearer only.

## Why it survived

The tests use items with one or two wearers
(`__tests__/unit/lib/tools/handlers/wardrobe-wear-readout.test.ts`), where the total and the reader's
own count are close or equal. Real households share General and group items across many characters,
which the fixtures do not.

## Fix

Not done. The character tools should answer from the reader's point of view and keep the total as
context. For example:

- `wardrobe_list`: carry the caller's own `worn_by_you` / `last_worn_by_you_at` beside the household
  `wear_count` / `last_worn_at`, and write the note from the caller's side, e.g.
  ` · worn by you 12×, last yesterday (115× in the household)` or
  ` · never worn by you (115× in the household)`. The per-wearer rows are already in the ledger
  (`findRowsForItems`), so the summary can be computed for one wearer alongside the total.
- `wardrobe_read`: lead with the reader's own record, then the household, e.g.
  `You have worn it 13 times, first 25 Jun 2026, last today. Worn 116 times in all; also by Laura (25 times), …`,
  never folding the reader into an unnumbered `by you`.

The wardrobe UI's row line and sort can keep the household total; there it is labelled by context.
