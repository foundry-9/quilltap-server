# Bug 179 — in an autonomous turn, a second wardrobe operation overwrites the first

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-07)** |
| **Found** | 2026-10-07, while specifying the wardrobe wear ledger ([wardrobe-wear-ledger.md §3.5](../../features/complete/wardrobe-wear-ledger.md)) |
| **Fixed** | 2026-10-07, v4.10-dev |
| **Severity** | Low. Only the job child is affected, only when one tool call (or one turn) changes the same character's outfit more than once, and the loss is a garment that silently fails to go on (or come off); nothing is corrupted and the next change reads the true state |
| **Who it bites** | autonomous rooms (`AUTONOMOUS_ROOM_TURN` runs in the forked job child) whose character calls `wardrobe_wear` with several `operations`, or `wardrobe_wear` then `wardrobe_take_off` / `wardrobe_create` with `equip_now` in the same turn |
| **Provenance** | Predates the ledger. Arrived when tool execution for autonomous turns moved into the job child, whose repository reads are a readonly snapshot and whose writes are buffered |
| **Defect site** | `lib/wardrobe/outfit-displacement.ts` — each primitive (`equipItem`, `replaceItem`, `addToSlot`, `removeFromSlot`) reads the prior slots with `loadSlots` → `chats.getEquippedOutfitForCharacter`, which in the child does not see the job's own earlier buffered write; `lib/tools/handlers/wardrobe-wear-handler.ts` loops over `operations` calling one primitive per op |
| **Fix site** | `lib/background-jobs/child/child-repositories-proxy.ts`: a per-job `equippedOutfits` overlay on the job scope, filled by each buffered `wardrobeWear.commitEquippedOutfit` and read first by `chats.getEquippedOutfitForCharacter` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-07).** Neither fix proposed below: the job child's repository
proxy now gives equipped outfits read-your-writes. When it buffers a
`wardrobeWear.commitEquippedOutfit`, it records the call's `nextSlots` in a per-job overlay
keyed `chatId:characterId`; `chats.getEquippedOutfitForCharacter` answers from the overlay
(a copy) before falling through to the snapshot. Every primitive, and every other reader in
the job — `finalizeWardrobeMutation`'s resulting state, `wardrobe_list`, `wardrobe_create`
with `equip_now`, a later tool in the same turn — now sees the job's own outfit changes, so
the second op computes from the first's slots and the parent's in-order replay lands both.
The overlay lives on the job scope and dies with it. The chokepoint is the only slot writer
(the equip-chokepoint fence enforces it), so it is the only write the overlay follows.
Pinned by `__tests__/unit/lib/background-jobs/child-proxy-wardrobe-wear.test.ts` (two wears
in one job replay to both garments; a take-off after a put-on sees the put-on; characters and
jobs stay apart; the overlay hands out copies).

## Symptom

An autonomous character asks to put on a shirt and a coat in one `wardrobe_wear`
call. The tool reports both as applied. Afterwards the character is wearing the
coat and not the shirt.

## Root cause

In the job child, `getRepositories()` is a proxy: reads hit a readonly snapshot,
writes are buffered and replayed by the parent after the job ends. Each displacement
primitive computes the next slots from `loadSlots`, so op 2 computes from the same
baseline as op 1 — the snapshot cannot see op 1's buffered write. Both buffered
writes are whole-slot replacements (`wardrobeWear.commitEquippedOutfit` →
`chats.setEquippedOutfit`), so when the parent replays them in order, op 2's slots
(baseline + coat) replace op 1's (baseline + shirt).

The wear ledger is **not** affected: each replayed `commitEquippedOutfit` diffs
against the true prior state at replay time, so the shirt is credited once (op 1
put it on) and the coat once (op 2). Only the slots lose op 1.

## Why it survived

The HTTP path runs in the parent with read-your-writes, and most tool calls carry
one operation. The tool reports success per op from the slots it computed, which
look right in isolation.

## The fix

Either thread the slots through the op loop — each primitive takes the prior
slots from the previous op's result within a tool call (and the handlers carry
them across tools within a turn) — or collapse the whole op list into one
computed `nextSlots` and one `commitEquippedOutfit`. The second is smaller and
keeps the chokepoint's diff meaningful (one transition per call).

## Verify

A job-child test that runs `executeWardrobeWearTool` with two `wear` operations
under `runWithJobScope`, replays the buffered writes against an in-memory chats
store, and asserts both garments are in the final slots.
