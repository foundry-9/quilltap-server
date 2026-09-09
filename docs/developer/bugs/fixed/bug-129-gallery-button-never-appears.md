# Bug 129 — the Salon sidebar's Gallery button is gated on a count that a nonexistent API action always answers zero

| | |
|---|---|
| **Status** | **Fixed in v4** (2026-09-09) |
| **Found** | 2026-09-08 |
| **Fixed** | 2026-09-09 |
| **Severity** | Medium — nothing errors and nothing is lost, but a shipped feature is unreachable from the UI for the whole life of the app. The chat gallery exists, its modal works, its listing route works; the button that opens it is simply never rendered |
| **Who it bites** | everyone. The Organize drawer's **Gallery** button has never appeared for any chat, whatever it holds — an uploaded photograph, a `generate_image` output, a Lantern backdrop, an Aurora repaint |
| **Provenance** | Found by source reading while planning the Salon chat gallery ([salon-chat-gallery.md](../../features/complete/salon-chat-gallery.md)). Confirmed by enumerating the chat GET's action dispatch: `files` is not among the twelve actions it answers |
| **Defect site** | `app/salon/[id]/hooks/useChatData.ts:92-101` (`fetchChatPhotoCount` calls `GET /api/v1/chats/{id}?action=files`), `components/chat/ChatSidebar.tsx:1663` (`{chatPhotoCount > 0 && onGalleryClick && …}`) |
| **Fix site** | `app/salon/[id]/hooks/useChatGallery.ts` (new), `app/salon/[id]/hooks/useChatData.ts`, `app/salon/[id]/SalonView.tsx`, `components/chat/ChatSidebar.tsx`, `lib/query/keys.ts`, `lib/realtime/topic-map.ts` |
| **v5 status** | **Not yet assessed.** The port carries its own Salon sidebar. Carry the invariant, not the code: a control gated on a fetched count needs a test that the fetch reaches an endpoint that exists |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-09).** The counter was deleted rather than repaired.
`chatPhotoCount` / `fetchChatPhotoCount` are gone from `useChatData`; the
number now comes from `useChatGallery(chatId)`, a TanStack Query read on
`queryKeys.chats.gallery(chatId)` against `?action=gallery` — an action the
chat GET actually dispatches, and one that answers with every image in the
conversation rather than only the linked-file subset. The same query backs the
grid, so the count and the gallery are one answer and cannot disagree. The
button lost its gate entirely and is rendered whenever the Salon has a gallery
to open. The key rides the `chats` row of `lib/realtime/topic-map.ts`, so a
Lantern backdrop or an Aurora repaint landing from a background job updates the
number with no poll — which is also bug 128's step 5, superseded here. The
write-up below is the original filing.

---

## Symptom

The Salon sidebar's **Organize** section reads

> Copy ID · Rename · State · Continue Elsewhere · Merge In · Export · Export Markdown

and never a **Gallery (N)** button, no matter how many images the conversation
has accumulated. `PhotoGalleryModal`'s chat mode, `ChatGalleryImageViewModal`,
and `GET /api/v1/chats/{id}/files` are all present, tested and working; there
is no door to any of them.

## Root cause

`fetchChatPhotoCount` asks the wrong endpoint:

```ts
const res = await fetch(`/api/v1/chats/${chatId}?action=files`, { cache: 'no-store' })
if (res.ok) {
  const data = await res.json()
  const imageCount = (data.files || []).filter(…).length
  setChatPhotoCount(imageCount)
}
```

`handleGet` (`app/api/v1/chats/[id]/handlers/get.ts`) dispatches exactly twelve
actions — `export`, `export-markdown`, `get-avatars`, `get-state`, `outfit`,
`outfit-summary`, `photo-albums`, `group-stores`, `mailbox`,
`accessible-stores`, `get-background`, `cost` — and **`files` is not one of
them**. An unrecognised action is not rejected: it falls through to the
whole-chat payload, which is a `200 OK` carrying `{ chat: {…} }`. So `res.ok`
is true, `data.files` is `undefined`, `(undefined || []).filter(…).length` is
`0`, and `chatPhotoCount` is set to zero on every read.

The button is then gated on that zero:

```tsx
{chatPhotoCount > 0 && onGalleryClick && ( … <span>Gallery ({chatPhotoCount})</span> … )}
```

The working listing lives one path segment away, at
`app/api/v1/chats/[id]/files/route.ts` — which is what `PhotoGalleryModal`
itself calls, correctly, once something manages to open it.

## Why it survived

- **Every layer answers `200`.** A wrong action is not an error on this route;
  it is a different, valid response. Nothing logs, nothing throws, and the
  network tab shows a healthy request.
- **A missing button is not a broken button.** There is no error state to
  notice and no control to click — the Organize drawer simply looks like it has
  seven entries rather than eight, and nobody knows to miss the eighth.
- **The modal it opens has its own tests**, which pass, because they exercise
  the modal directly and never go through the sidebar's gate.
- **The count is plausible.** Zero photos in a chat is an ordinary state, so
  the value is never surprising enough to check.
- **The sibling defect masks the diagnosis.** `chatPhotoCount` is also read
  exactly once at mount ([bug 128](../bug-128-stale-chat-memory-count.md)), so
  "the count is stale" is the first hypothesis, and it is a true statement
  about a number that would be wrong anyway.

## The fix

Phase 2 of [salon-chat-gallery.md](../../features/complete/salon-chat-gallery.md), which
supersedes bug 128's step 5:

1. `fetchChatPhotoCount` / `chatPhotoCount` are **deleted** from `useChatData`.
   A hook-local counter fed by a hand-rolled `fetch` is what made the wrong URL
   invisible; the replacement is a TanStack Query read through
   `queryKeys.chats.gallery(chatId)`, whose `total` is the count.
2. The new query hits `GET /api/v1/chats/{id}?action=gallery`, an action the
   chat GET actually dispatches, and one that answers with every image in the
   conversation rather than only the linked-file subset.
3. The button loses its gate and is rendered unconditionally. Gating it on a
   count is what hid the feature; a chat with a cast is never empty anyway,
   because participant portraits alone put the total above zero, and the
   modal's own empty state handles the unreachable case.
4. The query key rides the `chats` row of `lib/realtime/topic-map.ts`, so a
   Lantern backdrop or an Aurora repaint landing from a background job
   refreshes the number with no poll — which is also the cure for the
   read-once staleness bug 128 describes.

## Verification

- **Unit** — a `useChatGallery` test asserting the query key and that the
  request URL carries `action=gallery`. The old shape fails it.
- **Route** — `GET /api/v1/chats/{id}?action=gallery` answers `{ entries,
  counts, total }`; the pre-fix `?action=files` request is gone from the
  codebase (`grep -r "action=files"` finds nothing).
- **Live** — open any chat with a character in it. The Organize drawer shows
  **Gallery (N)** with N at least the number of participants, and the button
  opens the grid.
