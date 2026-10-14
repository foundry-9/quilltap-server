# Bug 130 — an image generated through `POST /api/v1/images?action=generate` can never be told which chat asked for it

| | |
|---|---|
| **Status** | **Fixed in v4** (2026-09-08) |
| **Found** | 2026-09-08 |
| **Fixed** | 2026-09-08 |
| **Severity** | Low — a latent gap rather than a live loss. The route has no caller in the app today, so nothing is currently orphaned; but it is one of the two image-generation entry points, and the one that cannot record a chat at all |
| **Who it bites** | any future caller of the collection route (a plugin, a script, the CLI, a UI that reaches for the obvious endpoint), whose images would land in the library attached to nothing and be invisible to every chat-scoped listing — the chat gallery included |
| **Provenance** | Found by source reading while planning the Salon chat gallery ([salon-chat-gallery.md](../../features/complete/salon-chat-gallery.md)), whose enumerator's first pass is `files.findByLinkedTo(chatId)`. The spec's source table lists this as source #3 |
| **Defect site** | `app/api/v1/images/route.ts` — `generateImageSchema` (~:44) has no `chatId`, and `const linkedTo = tags?.map(t => t.tagId) \|\| []` (~:299) is the whole link set |
| **Fix site** | the same two places: accept an optional `chatId` and fold it into `linkedTo` |
| **v5 status** | **Not yet assessed.** If the port carries a second image-generation entry point, it should carry the same link contract as the first |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-08).** `generateImageSchema` now carries an optional
`chatId`, and `linkedTo` is built from the tag ids and that chat together,
through a `Set` so a caller passing both a `CHAT` tag and `chatId` links it
once rather than twice. Four tests in
`__tests__/unit/images-generate.test.ts` pin the four shapes: chat alone, chat
plus a duplicate CHAT tag, chat alongside an unrelated tag, and no chat at all
(unchanged from before). The write-up below is the original filing.

---

## Symptom

`POST /api/v1/images?action=generate` mints a `files` row with

```ts
const linkedTo = tags?.map(t => t.tagId) || [];
```

and there is no other write to `linkedTo` on that path. The request body it
validates — `{ prompt, profileId, tags?, options? }` — carries no chat, so the
only way an image made here can be tied to a conversation is for the caller to
have happened to pass a `{ tagType: 'CHAT', tagId }` entry. Nothing in the app
does. An image generated through this route is therefore linked to whatever
tags it was given and to no chat, and every chat-scoped read of
`files.findByLinkedTo(chatId)` — the chat file listing, the stale-chat collapse
sweep's candidate set, and now the chat gallery — cannot see it.

## Root cause

There are two image-generation entry points and they were built at different
times against different assumptions:

| Route | Chat link |
|---|---|
| `POST /api/v1/image-profiles/[id]?action=generate` | `chatId` in the schema (`:22`), passed to `executeImageGenerationTool`, which sets `linkedTo = chatId ? [chatId] : []` (`lib/tools/handlers/image-generation-handler.ts:139`) |
| `POST /api/v1/images?action=generate` | none — `linkedTo` from tags only |

The Salon's own Generate Image dialogs (`components/chat/GenerateImageDialog.tsx`,
`StandaloneGenerateImageDialog.tsx`) post to the **profile** route and pass
`chatId`, so images made from the Salon *are* linked and *do* reach the gallery.
That is what keeps this off the "images are missing" list — and also what makes
the collection route's silence easy to miss, because the obviously-named
endpoint is the one that cannot do it.

The two routes have converged on everything else: both build their generation
request through `buildImageGenParams`, both convert to WebP, both write through
the Lantern Backgrounds mount bridge. `linkedTo` is the one place they still
disagree, and the disagreement is a missing field rather than a considered
difference.

## Why it survived

- **No caller.** `grep` finds no client posting `?action=generate` to the
  collection route; every UI path goes through the profile route. A gap with no
  traffic produces no reports.
- **The tags escape hatch reads like coverage.** `tagType: 'CHAT'` exists in the
  schema, so a reader concludes the route can be told about a chat. It can — but
  only by a caller who knows to encode the chat as a tag, and tags carry other
  meaning (they are inherited onto the file, and they drive the library's tag
  filter), so a chat id in `tags` is not the same statement as a chat id in
  `linkedTo`.
- **The symptom is an absence.** An image that isn't in a listing looks like an
  image that was never made.

## The fix

Accept the chat and fold it into the link set, matching the profile route:

```ts
const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  profileId: z.uuid(),
  chatId: z.uuid().optional(),
  tags: …,
  options: …,
});

// Build linkedTo from the tags plus the chat that asked, deduped: a caller
// that passes both a CHAT tag and chatId must not link the id twice.
const linkedTo = Array.from(new Set([
  ...(tags?.map(t => t.tagId) ?? []),
  ...(chatId ? [chatId] : []),
]));
```

`getInheritedTags(linkedTo, userId)` then sees the chat the same way the
profile route's path does, so tag inheritance is identical between the two
entry points as well.

## Verification

- **Route test** (`__tests__/unit/api/images-generate-linked-to.test.ts`): a
  generate request carrying `chatId` creates a file whose `linkedTo` contains
  it; a request carrying both `chatId` and a matching `CHAT` tag contains it
  exactly once; a request carrying neither is unchanged from today.
- **By hand** — POST the route with a `chatId`, then open that chat's gallery:
  the image is there, filed under **Generated**.
