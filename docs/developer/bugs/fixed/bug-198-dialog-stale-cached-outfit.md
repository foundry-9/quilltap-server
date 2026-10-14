# Bug 198 — The wardrobe dialog shows a cached outfit from before an LLM's wardrobe change

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-10)** |
| **Found** | 2026-10-10, live on `Friday` ("The Master Bedroom Tour"): Laura took off her top, bottom and footwear with `wardrobe_take_off`, Aurora announced it, and the wardrobe opened from the participants sidebar still showed them worn |
| **Fixed** | 2026-10-10, v4.10-dev |
| **Severity** | Medium — the stored outfit was right, but the dialog showed the wrong one, and any edit plus Done would have committed the stale outfit back with a `set_all` (re-dressing the character, a fresh Aurora announcement and avatar regen) |
| **Who it bites** | anyone who opens the wardrobe dialog in a chat, then lets a character change clothes by tool call, then opens the dialog again within the query cache's lifetime (5 minutes) |
| **Provenance** | Original to v4. Came in with the TanStack Query migration of the outfit read (`useChatOutfit`) and the ref-gated staging of bug 61 |
| **Defect site** | `lib/hooks/use-outfit.ts` (`slotsFor` answered from cached data); `components/wardrobe/hooks/useStagedLiveOutfits.ts` and `useFittingRoom.ts` (seed once, ignore later refetches); `lib/realtime/topic-map.ts` (`chats` did not invalidate `wardrobe.outfit(chatId)`) |
| **Fix site** | `lib/hooks/use-outfit.ts`, `lib/realtime/topic-map.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-10).** `useChatOutfit` now refetches on every mount (`refetchOnMount: 'always'`)
and `slotsFor` answers undefined until `isFetchedAfterMount`, so a cached snapshot can never seed the
Live tab or the Outfit Builder. The `chats` realtime topic, which every message insert publishes
(the tool rows and Aurora's announcement included), now also invalidates `queryKeys.wardrobe.outfit(id)`.
Tests: `__tests__/unit/hooks/useChatOutfit.test.tsx`, `__tests__/unit/realtime/topic-map.test.ts`.

## Symptom

In chat `680002e2-…` on `Friday`: at 03:47:15Z the operator opened the wardrobe and dressed Charlie
(`set_all`). At 03:49:22Z Laura's two `wardrobe_take_off` calls cleared top, bottom and footwear; the
`chats.equippedOutfit` row was correct and Aurora announced "naked, barefoot". At 03:50:01Z the
operator opened the wardrobe again from the participants sidebar and Laura's clothes were still shown
as worn. The 03:50:18Z `set_all` for Laura is the operator correcting it by hand.

## Root cause

`useChatOutfit` (`lib/hooks/use-outfit.ts`) is a TanStack Query read keyed
`queryKeys.wardrobe.outfit(chatId)`. The first dialog visit cached the chat's whole outfit, Laura
dressed. On the second visit the query returned that cached snapshot synchronously (stale, but within
`gcTime`) and started a background refetch. `useStagedLiveOutfits` and `useFittingRoom` seed exactly
once per character from the first `wornSlots` they see (ref-gated so a refetch cannot wipe in-progress
edits, bug 61), so they seeded from the stale snapshot and ignored the fresh one when it landed.

Nothing invalidated the key in between: the tool path writes the outfit and posts messages, which
publish the `chats` realtime topic, but `queryKeysForTopic('chats', id)` did not include
`wardrobe.outfit(id)`. Only the dialog's own commits invalidate `wardrobe.all`.

## Why it survived

Every test and walkthrough changed outfits through the dialog itself, which invalidates the cache on
Done. The stale path needs an outfit change from outside the dialog between two visits.

## Fix

Both halves: the snapshot that seeds staging must be fetched since the dialog mounted, and the cached
copy follows realtime hints. An outfit change *while* the dialog is open still does not re-seed
staging; that is the bug 61 contract (in-progress edits win) and is unchanged.

## Verify

Open a chat's wardrobe and close it. Have a character take something off by tool call. Reopen the
wardrobe within five minutes: the Live tab shows the item gone.
