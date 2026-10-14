# Bug 193 — `wardrobe_create` with `equip` never announces the outfit change

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/complete/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | Medium — the one wardrobe mutation that changes what a character is wearing without Aurora telling the room |
| **Who it bites** | any chat where a character creates and immediately wears a garment |
| **Provenance** | Original to v4. The per-turn announcement set was threaded into four of the seven wardrobe tool branches when it was introduced; create was left out |
| **Defect site** | `lib/chat/tool-executor.ts:797-803` (the `wardrobe_create` branch builds its context without `pendingWardrobeAnnouncements`; the wear, take-off and archive branches at `:851`, `:876`, `:901` forward it); `lib/tools/handlers/wardrobe-create-handler.ts:284-289` (calls `triggerAvatarGenerationIfEnabled` directly and never `notifyWardrobeChanged`) |
| **Fix site** | `lib/tools/handlers/wardrobe-create-handler.ts` (equip goes through `wearItem` and `notifyWardrobeChanged`); `lib/tools/handlers/wardrobe-tool-table.ts` + `lib/chat/tool-executor.ts` (one table, one context that always carries the announcement set); `lib/wardrobe/outfit-change-effects.ts` (the shared notifier) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** Phase C moved the outfit-change effects into
`lib/wardrobe/outfit-change-effects.ts`, and the executor's seven `wardrobe_*` branches became one table
(`lib/tools/handlers/wardrobe-tool-table.ts`) fed one `WardrobeToolContext`, which always carries the
turn's `pendingWardrobeAnnouncements`. `wardrobe_create` with `equip_now` now wears the item through the
same `wearItem` gesture as `wardrobe_wear` and calls `notifyWardrobeChanged`, so the avatar refresh and the
Aurora announcement both follow. Regression test in `__tests__/unit/lib/tools/handlers/wardrobe-handlers.test.ts`.

## Symptom

A character calls `wardrobe_create` for a new gown with `equip: true`. The
gown goes on and the avatar regenerates, but Aurora posts no "now wearing"
announcement, which every other put-on gesture (tool wear, dialog wear,
chat-start outfit) produces.

## Root cause

`notifyWardrobeChanged` (`wardrobe-handler-shared.ts`) is the pair of side
effects every equipped-state change must fire: avatar refresh plus
`recordPendingWardrobeAnnouncement`. The create handler fires only the first,
by hand. Even if it called the second, its context has no
`pendingWardrobeAnnouncements` set to record into, because the executor
branch for create omits it.

## Why it survived

The avatar changes, so the operator sees *something* happen.

## Fix (proposed)

Move the notifier out of the tools folder into
`lib/wardrobe/outfit-change-effects.ts`, have the create handler call it, and
collapse the executor's seven near-identical `if (toolCall.name ===
'wardrobe_*')` blocks into a table-driven dispatch that builds one context
shape, so a future tool cannot be left out either.

## How to verify

Create-and-equip through the tool on V4test: an Aurora announcement must
follow at end of turn, once, as it does for `wardrobe_wear`.
