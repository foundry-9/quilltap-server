# Bug 189 — a tool-queued wardrobe picture ignores the chat's Concierge state

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/complete/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | High — a **Locked** chat's picture can be rerouted to the uncensored desk after a refusal, which Locked exists to forbid; and an Unmoderated chat's `routeDirect`, the refusal ledger and the Concierge's announcement are all skipped |
| **Who it bites** | any chat where a character creates or redraws a garment through `wardrobe_create` / `wardrobe_update` with image generation on |
| **Provenance** | Original to v4. Wardrobe item pictures were specified as "chatless" (`item-image-generation.ts:9`) before the job started carrying the chat id |
| **Defect site** | `lib/wardrobe/item-image-generation.ts:216-217` (`resolveConciergeSettings(chatSettings, null)`) and `:267` (`chatId: null` in the failover context); `lib/background-jobs/handlers/wardrobe-item-image.ts:42` has `payload.chatId` and does not pass it |
| **Fix site** | `lib/wardrobe/item-image-generation.ts` (`generateWardrobeItemImage` takes `chatId`, loads the chat, resolves the Concierge with it, routes an Unmoderated chat direct, and passes `{ chatId, chat, primaryVia }` to the failover); `lib/background-jobs/handlers/wardrobe-item-image.ts` passes `payload.chatId` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** `generateWardrobeItemImage` takes an optional `chatId`. When given, it
loads the chat (a read failure logs and leaves the snapshot null; the failover re-reads the state by id
at refusal time anyway), resolves the Concierge policy with it, and passes `chatId` and `chat` to
`generateImageWithConciergeFailover`, so a Locked chat's refusal stays refused and is ledgered and
announced. An Unmoderated chat (`routeDirect`) goes straight to the uncensored desk through
`resolveImageProviderForDangerousContent`, as the avatar job does, with `primaryVia: 'concierge'`. The job
handler passes `payload.chatId`; the editor's images route still passes none. The optional pre-screen on
this path was not added. Tests in `item-image-generation.test.ts` and `wardrobe-item-image.test.ts`.

## Symptom

In a chat the operator has set to **Locked**, a character's `wardrobe_create`
queues a picture of an intimate garment. The moderated provider refuses. The
failover chokepoint reads the chat as Moderated (it was given no chat) and
reroutes to the uncensored understudy. The chat's refusal ledger is not
incremented and no Concierge announcement is posted.

## Root cause

`generateWardrobeItemImage` resolves the Concierge policy with a null chat and
calls `generateImageWithConciergeFailover` with `chatId: null`. Inside the
chokepoint, `readCurrentConciergeState(null, …)` answers Moderated, so
`mayFailOver` is true. The job payload queued by `maybeQueueWardrobeToolImage`
(`lib/wardrobe/tool-image-generation.ts:100-104`) carries the chat id; the job
handler reads it for its log line and never forwards it.

The REST images route (`app/api/v1/wardrobe/[itemId]/images/route.ts`) is
genuinely chatless, which is where the null came from.

## Why it survived

Wardrobe pictures are a recent feature; refusals on them are rare; and the
reroute produces a picture, which looks like success.

## Fix (as proposed at filing)

Add `chatId?: string | null` to `generateWardrobeItemImage`. When present,
load the chat and pass it to `resolveConciergeSettings(chatSettings, chat)`
and to the failover context as `{ chatId, chat }`. The job handler passes
`payload.chatId`; the images route keeps passing null. Consider also running
the pre-screen (`preScreen.*`) on this path once the chat is known.

## How to verify

Lock a V4test chat, have a character create an item the moderated provider
refuses, and check the LLM log: the attempt must stop at the refusal, the
ledger must not move, and no understudy call must appear.
