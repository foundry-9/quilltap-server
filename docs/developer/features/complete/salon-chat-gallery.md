# Feature: The Salon Chat Gallery — every image in a conversation, savable and downloadable

**Status:** **Shipped** in v4.10-dev (written 2026-09-08, landed 2026-09-09). See [Implementation notes (as landed)](#implementation-notes-as-landed) at the foot for where the plan and the code differ.
**Owner subsystems:** The Salon (`app/salon/[id]/`, `components/chat/ChatSidebar.tsx`), the Lantern / Aurora image pipelines (`lib/background-jobs/handlers/story-background.ts`, `character-avatar.ts`, `lib/services/lantern-notifications/`), the photo-album service (`lib/photos/save-image-to-album.ts`), and the file-serving routes.
**Implementation note:** This spec is written to be executed by Claude Code with minimal further design input. Where a choice existed, it has been made — see [Design decisions (resolved)](#design-decisions-resolved). Follow CLAUDE.md standing rules throughout: changelog entry in plain voice, help docs in the house voice, debug logging on every touched backend path, `npx tsc`, `npm run lint`, no new polling sites, query keys only through `lib/query/keys.ts`. Plan in the most capable model; Phases 1, 3 and 4 are each written so a cheaper agent can take them with this document as the whole brief. Phase 0 and Phase 2 touch chokepoints and should stay with the planning model.

## Motivation

A Salon conversation accumulates pictures from many directions: the user attaches a photograph, a character summons one with `generate_image`, the Lantern paints a story background every few turns, Aurora repaints a character's avatar when their outfit changes, a character re-shows a kept picture with `attach_image`, the Librarian attaches a file from a document store, and the cast's own portraits hang over every message. Today the only way to get at any of them is to find the message it hangs beneath (if it has one — backgrounds and avatars often do not) and press the bookmark on that message's toolbar.

The sidebar's **Organize** drawer is the chat-as-an-object panel: Copy ID, Rename, State, Continue Elsewhere, Merge In, Export. A **Gallery** belongs there: one grid of every image that exists in this conversation, whatever produced it, where each picture can be **saved to a photo album** exactly the way the message toolbar's bookmark saves it, and **downloaded** as a proper file.

## What exists today (and why it is not enough)

There is already a `Gallery (N)` button in the Organize section — [ChatSidebar.tsx:1663](../../../../components/chat/ChatSidebar.tsx) — and a chat mode on `PhotoGalleryModal` ([components/images/PhotoGalleryModal.tsx](../../../../components/images/PhotoGalleryModal.tsx)) that lists `GET /api/v1/chats/{id}/files` filtered to `image/*`. It falls short in four ways:

1. **The button never appears.** It is gated on `chatPhotoCount > 0`, and `useChatData.fetchChatPhotoCount` ([app/salon/[id]/hooks/useChatData.ts:94](../../../../app/salon/%5Bid%5D/hooks/useChatData.ts)) fetches `/api/v1/chats/{id}?action=files`. No such action exists on the chat GET ([handlers/get.ts:44-233](../../../../app/api/v1/chats/%5Bid%5D/handlers/get.ts) dispatches `export`, `export-markdown`, `get-avatars`, `get-state`, `outfit`, `outfit-summary`, `photo-albums`, `group-stores`, `mailbox`, `accessible-stores`, `get-background`, `cost`), so the request falls through to the whole-chat payload, `data.files` is `undefined`, and the count is always zero. The working listing lives at `app/api/v1/chats/[id]/files/route.ts`, which the modal itself calls correctly. This is a bug and gets filed as one (Phase 0). Note that [bug 128](../../bugs/bug-128-stale-chat-memory-count.md) step 5 proposes re-reading this count on the `chats` realtime topic; that would re-read the same nonexistent action and still get zero. This plan supersedes step 5 by moving the count onto the gallery query, and bug 128's file says so.
2. **It misses whole classes of image.** The `/files` listing is the union of `files.linkedTo ∋ chatId` and every message's `attachments` array. That catches uploads, `generate_image` output, `attach_image` re-shows, Librarian attachments, story backgrounds and Aurora-generated avatars — but not the cast's base portraits (`characters.defaultImageId`, never linked to a chat), not images generated from the Generate Image dialogs (`app/api/v1/images/route.ts:298` builds `linkedTo` from `tags` only and ignores the `chatId` it was sent), and not images referenced only by a Markdown `![](…)` in message content.
3. **Saving does not do what the ribbon does.** The message toolbar's bookmark ([MessageActionBar.tsx:89-109](../../../../app/salon/%5Bid%5D/components/message-row/MessageActionBar.tsx)) opens `SaveImageDialog`, which offers *every* album the chat can reach — the user's persona, each character, the project album, linked document stores, Quilltap General (`?action=photo-albums`) — and posts to `POST /chats/{id}/messages/{messageId}?action=save-image`, which flows through `saveImageToAlbum`. The gallery's detail view (`ChatGalleryImageViewModal`) instead has two hard-wired buttons that post `{ fileId }` to `/api/v1/characters/{id}/photos` for the *first* character and the *first* user character only, and it sends a `doc_mount_file_links` id as `fileId` for mount-file entries, which the character-photos route rejects (see memory: character photo save accepts either id, but the caller must say which).
4. **Download works, but only by buffering.** Every image route serves `Content-Disposition: inline`; the modals `fetch` the bytes into a Blob and hand them to `triggerDownload`. That is fine for a thumbnail and wrong for a 4K background in the Electron shell, where `triggerUrlDownload` can stream through `will-download` without touching renderer memory — the path the Organize drawer's own Export buttons already use.

## Vocabulary

- **Gallery entry** — one image the gallery shows, whatever its storage. Carries a stable `id`, the *kind* of id (`file` for a `files.id`, `link` for a `doc_mount_file_links.id`), a `source`, and everything the grid and detail view need.
- **Source** — where the image came from, as far as the chat is concerned: `attachment`, `generated`, `story-background`, `avatar`, `portrait`, `kept`, `inline`. See the table below.
- **Album** — any `doc_mount_point` with a `photos/` folder: a character's vault, the project's official store, a linked document store, Quilltap General. The `?action=photo-albums` list.
- **Save** — hard-link the image into an album's `photos/` folder with a Markdown sidecar, via `saveImageToAlbum`. Never a byte copy.

## The nine ways an image reaches a chat

This is the ground truth the enumerator is built on. Verified 2026-09-08.

| # | Source | Record tying it to the chat | Today's `/files` listing |
|---|---|---|---|
| 1 | User upload, or "link from library" (`POST /chats/[id]/files`, `?action=link`) | `files.linkedTo ∋ chatId` | yes |
| 2 | `generate_image` tool ([image-generation-handler.ts:141](../../../../lib/tools/handlers/image-generation-handler.ts)) | `files.linkedTo ∋ chatId`; also TOOL + ASSISTANT message `attachments` ([tool-execution.service.ts:196-259](../../../../lib/services/chat-message/tool-execution.service.ts)) | yes |
| 3 | Generate Image dialogs (`POST /image-profiles/[id]?action=generate`) | `linkedTo` from **tags only** — `chatId` accepted at [images/route.ts:258](../../../../app/api/v1/images/route.ts) but unused at `:298` | **no** unless a tag happens to be the chat |
| 4 | `attach_image` re-show of a kept vault image ([photo-handlers.ts:444](../../../../lib/tools/handlers/doc-edit/photo-handlers.ts)) | TOOL message `attachments ∋ linkId` only (`files.addLink` on a link id is a silent no-op) | yes (message walk) |
| 5 | Librarian mount-file attach (`?action=attach-mount-file`) | announcement message `attachments ∋ mountFileId`; no `linkedTo` | yes (message walk) |
| 6 | Story background job ([story-background.ts:874, 978](../../../../lib/background-jobs/handlers/story-background.ts)) | `files.linkedTo ∋ [chatId, …characterIds]` + `chats.storyBackgroundImageId` (current one only) | yes, including superseded ones |
| 7 | Aurora avatar job ([character-avatar.ts:498, 524, 543](../../../../lib/background-jobs/handlers/character-avatar.ts)) | `files.linkedTo ∋ [chatId, characterId]` + `chats.characterAvatars[characterId]` + `characters.avatarOverrides[{chatId}]` | yes, including superseded ones |
| 8 | Participant base portraits | `characters.defaultImageId` (link id *or* legacy file id; resolve with `resolveCharacterAvatar`) — no chat link at all | **no** |
| 9 | Markdown `![](…)` in message content | none; `MessageContent.tsx:503-515` rewrites relative paths to the author's blob mount at render time | **no** |

Two facts shape the design:

- **Ids are of two species.** `files.id` and `doc_mount_file_links.id` both appear in `attachments`, in `characterAvatars`, in `defaultImageId`. `saveImageToAlbum` already accepts either ([save-image-to-album.ts:157-185](../../../../lib/photos/save-image-to-album.ts)); `DELETE /chat-files/[id]` and `POST /characters/[id]/photos` do not. The entry must carry the species, and every action must branch on it rather than guess.
- **Announcement messages are optional.** `postLanternImageNotification` is skipped when `alertCharactersOfLanternImages` is off — the default ([writer.ts:103](../../../../lib/services/lantern-notifications/writer.ts)). Backgrounds and avatars therefore usually have no message row; `files.linkedTo` is the only reliable record, and the gallery must not be built by walking messages alone.

## Design

### One enumerator, server-side

**`lib/photos/chat-gallery.ts`** exports `listChatGallery(chatId, repos): Promise<ChatGalleryEntry[]>`. It is the single place that knows the nine sources. Nothing else — not the `/files` route, not the sidebar count, not the modal — re-derives "which images are in this chat."

```ts
export type ChatGalleryIdKind = 'file' | 'link';
export type ChatGallerySource =
  | 'attachment'        // #1, #5
  | 'generated'         // #2, #3
  | 'story-background'  // #6
  | 'avatar'            // #7 — Aurora repaint during this chat
  | 'portrait'          // #8 — a participant's standing portrait
  | 'kept'              // #4 — re-shown from an album
  | 'inline';           // #9

export interface ChatGalleryEntry {
  id: string;                 // files.id or doc_mount_file_links.id
  idKind: ChatGalleryIdKind;
  url: string;                // inline-served URL (files/[id] or mount-points blob)
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  sha256?: string;
  createdAt: string;          // ISO; sort key
  source: ChatGallerySource;
  /** The character this image is *of* or *by*, when known (avatar/portrait/background cast). */
  characterId?: string;
  characterName?: string;
  /** The message it hangs beneath, when one exists. Lets the detail view offer "Jump to message". */
  messageId?: string;
  /** True for the background the chat is currently showing / the avatar a character is currently wearing. */
  isCurrent: boolean;
  /** Whether the chat itself owns the record and may delete it (see "Deleting"). */
  deletable: boolean;
  /** Existing PhotoLinkSummary — how many albums already hold these bytes. */
  linkSummary?: PhotoLinkSummary;
}
```

**Passes, in order:**

1. `repos.files.findByLinkedTo(chatId)` — sources #1, #2, #3 (after the Phase 0 fix), #6, #7. Classify: `chat.storyBackgroundImageId === id` or the file sits under a `story-backgrounds/` or Lantern `generated/` path → `story-background`; a `characterAvatars[*].imageId` or `avatarOverrides` hit, or a `character-avatar` storage path → `avatar`; `source === 'GENERATED'` otherwise → `generated`; else `attachment`. `isCurrent` from `chats.storyBackgroundImageId` / `chats.characterAvatars`, matched on id **and** sha256 (the collapse sweep does the same for the same reason — [collapse-stale-chat-assets.ts:22-31](../../../../lib/background-jobs/maintenance/collapse-stale-chat-assets.ts)).
2. Message walk — lift the second pass of `GET /chats/[id]/files` ([files/route.ts:462-521](../../../../app/api/v1/chats/%5Bid%5D/files/route.ts)) into a helper `resolveMessageAttachmentEntries(messages)` in the same module and have the `/files` route call it, so the two never drift. Sources #4 and #5. Also records `messageId` for entries already found in pass 1 (a `generate_image` file is in both).
3. Cast portraits — for every non-removed `CHARACTER` participant and the user-persona participant, `resolveCharacterAvatar(character)` → source `portrait`, `isCurrent: true`, `deletable: false`. Skip if the same sha256 already appeared as an `avatar` entry (an Aurora repaint that became the default).
4. Inline Markdown — scan each non-SYSTEM message's `content` for `![…](url)` where `url` is `/api/v1/files/<uuid>`, `/api/v1/mount-points/<id>/blobs/<path>`, or a relative path (resolved against the author participant's vault mount, mirroring `MessageContent.tsx`). Source `inline`, `deletable: false`. Best effort: an unresolvable path is skipped with a `debug` log, never an error.

**Dedup** by sha256 where known, else by `(idKind, id)`; the first pass to see an image wins its `source`, later passes may only *add* `messageId`. **Sort** `createdAt` desc; portraits carry the character's `createdAt` so they land at the end rather than the top.

Every pass logs at `debug` with `{ chatId, pass, found }`; the result logs `{ chatId, total, bySource }`.

### Route: `GET /api/v1/chats/[id]?action=gallery`

New case in `handlers/get.ts`, returning `{ entries: ChatGalleryEntry[], counts: Record<ChatGallerySource, number>, total }`. The existing `/chats/[id]/files` GET keeps its shape and its non-image results (pickers use it) but reuses `resolveMessageAttachmentEntries`.

### Route: `POST /api/v1/chats/[id]?action=save-image`

The ribbon's save is message-scoped: `POST /chats/{id}/messages/{messageId}?action=save-image` refuses any `fileId` not in that message's `attachments` ([route.ts:314](../../../../app/api/v1/chats/%5Bid%5D/messages/%5BmessageId%5D/route.ts)). Half the gallery has no message. So add a **chat-scoped twin** with the identical body (`{ fileId, mountPointId, caption?, tags? }`) whose guard is *"is this id in `listChatGallery(chatId)`"* instead. Extract the attribution block at [route.ts:320-350](../../../../app/api/v1/chats/%5Bid%5D/messages/%5BmessageId%5D/route.ts) (character vault → that character; otherwise the impersonated persona) into `lib/photos/save-attribution.ts` `resolveSaveAttribution(chat, mountPointId, repos)` and call it from both routes. Both delegate to `saveImageToAlbum`. Same error mapping (`ALREADY_SAVED` → 409 with `keptAt`, the rest as today). The message route is unchanged in behaviour.

### Download: `?download=1` on the serving routes

Add an `attachment` mode to the three inline image routes — `app/api/v1/files/[id]/actions/download.ts`, `app/api/v1/files/proxy/[...key]/route.ts`, `app/api/v1/mount-points/[id]/blobs/[...path]/route.ts` — honouring `?download=1` by calling the existing `buildContentDisposition(filename, 'attachment')` ([lib/api/content-disposition.ts:22](../../../../lib/api/content-disposition.ts); today its only `attachment` caller is the Markdown export). Nothing else about the response changes. The client helper `downloadGalleryEntry(entry)` appends `download=1` to `entry.url` and calls `triggerUrlDownload(url, entry.filename)`, so the Electron shell streams and the browser gets a plain anchor download. `ImageModal` and `ChatGalleryImageViewModal` switch to the same helper; `downloadFetchedFile` stays for the Copy-to-clipboard path, which genuinely needs the bytes.

### Client state: one query, one key, realtime-gated

- `queryKeys.chats.gallery(id)` → `['chats', id, 'gallery']` in `lib/query/keys.ts`, beside `photoAlbums` and `background`.
- `lib/realtime/topic-map.ts` `'chats'` case adds `chats.gallery(id)`. The story-background and avatar jobs already publish `{ topic: 'chats', id: chatId }` on completion ([lib/realtime/job-topics.ts:48-61](../../../../lib/realtime/job-topics.ts)), so backgrounds and avatars refresh the gallery for free. Tool-generated images land through the parent-process message pipeline, which does not publish; the Salon already re-reads the chat after a turn, and `SalonView` invalidates `chats.gallery(id)` at every place it calls `fetchChatPhotoCount` today.
- `useChatGallery(chatId)` in `app/salon/[id]/hooks/` wraps `useQuery` with `apiFetch` and `refetchInterval: useRealtimeRefetchInterval(...)` as the offline fallback. **Delete** `chatPhotoCount` / `fetchChatPhotoCount` from `useChatData`; the sidebar's count is `total` from this query.

### UI

**Sidebar.** The Organize section's Gallery button is always rendered (a chat with a cast is never empty — portraits alone put it above zero) and reads `Gallery (N)`. Same `qt-tool-palette-button` styling as its neighbours.

**Grid.** `PhotoGalleryModal` chat mode consumes `ChatGalleryEntry[]`. Add:
- a filter row of source chips (All · Backgrounds · Avatars · Portraits · Generated · Attached · Kept · Inline), counts from `counts`, hidden chips for zero;
- a small corner badge on `isCurrent` entries ("current" — the background the chat shows, the avatar a character wears);
- hover actions on each thumbnail: **Save** (bookmark), **Download**, and **Delete** where `deletable`. The character-gallery grid already does hover actions (help/character-gallery.md, "hover over any thumbnail"); reuse its markup and `qt-*` classes rather than inventing new ones. Any new `qt-*` rule is mirrored into `packages/theme-storybook` per CLAUDE.md.
- **Portal to `document.body`.** The modal renders `fixed inset-0` inside the Salon pane; inside the tabbed workspace `.qt-workspace` is an isolated stacking context and traps it under the toolbar (see `project_workspace_stacking_context_portal`). Use `BaseModal` or `createPortal` as `SaveImageDialog`'s neighbours do.

**Detail view.** `ChatGalleryImageViewModal` takes a `ChatGalleryEntry`. Replace its two hard-wired album buttons with one **Save…** bookmark that opens `SaveImageDialog`; add **Download** via the helper; keep Copy, Prev/Next, Delete (gated on `deletable`); add a source line ("Story background · painted 3 Sep · current", "Portrait · Friday", "Attached beneath a message" with a *Jump to message* link when `messageId` is set). The `[N links]` badge from `linkSummary` stays.

**`SaveImageDialog`** gains a discriminated `target` prop:

```ts
type SaveImageTarget =
  | { kind: 'message'; messageId: string; fileId: string }   // the ribbon, unchanged
  | { kind: 'chat'; fileId: string };                        // the gallery
```

`kind: 'message'` posts where it does today; `kind: 'chat'` posts to the new chat-scoped action. Album list, caption, tags, the ALREADY_SAVED notice: all identical. The ribbon's call site passes `{ kind: 'message', … }` and is otherwise untouched.

### Deleting

Deletion is not the point of this feature, but the grid has a bin today and it must not lie. `deletable` is true only when the chat owns the record: sources `attachment`, `generated`, `story-background` and `avatar` with `idKind: 'file'` and `!isCurrent`. Portraits belong to the character; kept and inline images belong to an album or a vault; the current background and avatar are what the chat is showing. The bin is hidden otherwise, and the existing `DELETE /chat-files/[id]` is left as is (it already rejects link ids, and the UI now never sends one). The `onImageDeleted` callback that scrubs the message's attachments and appends `[attached photo deleted]` is kept.

## Phases

### Phase 0 — file the bugs and fix the two link gaps

- [x] File **bug 129** (next unused number at the time of writing; confirm against `docs/developer/bugs.md`): *sidebar Gallery button never appears* — `useChatData.fetchChatPhotoCount` calls a nonexistent `?action=files`. Root cause, provenance, verify steps. Register it in the index. The fix is Phase 2 (the count moves onto the gallery query); reference this spec from the bug.
- [x] File **bug 130**: *dialog-generated images are not linked to the chat that made them* — `app/api/v1/images/route.ts:298` ignores `chatId`. Fix now: `linkedTo = uniq([...(tags?.map(t => t.tagId) ?? []), ...(chatId ? [chatId] : [])])`. Add a route test. `git mv` the bug file to `fixed/` when it lands and update the index row.
- [x] Changelog entry for bug 130 under `4.10-dev` → **Fixed**.

### Phase 1 — the enumerator and its routes (delegable)

- [x] `lib/photos/chat-gallery.ts`: types above, `listChatGallery`, `resolveMessageAttachmentEntries`, the classify helpers, debug logging. Pure over `repos`; no HTTP.
- [x] Refactor `GET /chats/[id]/files` to call `resolveMessageAttachmentEntries`; response shape unchanged. Existing tests must still pass.
- [x] `handlers/get.ts`: `gallery` action. `docs/developer/API.md` row.
- [x] `lib/photos/save-attribution.ts` extracted from the message save route; message route calls it; behaviour identical.
- [x] `POST /chats/[id]?action=save-image` in the chat route's action map; gallery-membership guard; same body schema (share the Zod object with the message route rather than copying it).
- [x] Tests (`__tests__/unit/lib/photos/chat-gallery.test.ts`): one fixture per source #1–#9, including a background with alerts off (no message), an `attach_image` link id, a dialog-generated image, a portrait stored as a legacy file id and one as a link id, a Markdown-only image, and a sha256 duplicate across two passes. Assert source, `isCurrent`, `deletable`, dedup, sort. Route tests for `gallery` and the chat-scoped `save-image` (accepts a background with no message; rejects an id from another chat with 400; maps ALREADY_SAVED to 409).

### Phase 2 — client state and the sidebar

- [x] `queryKeys.chats.gallery(id)`; topic-map row; topic-map test.
- [x] `useChatGallery(chatId)` with `useRealtimeRefetchInterval`; remove `chatPhotoCount` / `fetchChatPhotoCount` from `useChatData`, `SalonView`, `ChatModals`; replace each former `fetchChatPhotoCount()` call with `queryClient.invalidateQueries({ queryKey: queryKeys.chats.gallery(chatId) })`.
- [x] Organize section: always render `Gallery (N)`.
- [x] Move bug 129 to `fixed/`, update the index row.

### Phase 3 — the gallery UI (delegable)

- [x] `SaveImageDialog` `target` prop; ribbon call site passes `kind: 'message'`.
- [x] `PhotoGalleryModal` chat mode on `ChatGalleryEntry[]`: filter chips, current badge, hover actions, portal to body. Character and user-character modes untouched.
- [x] `ChatGalleryImageViewModal` on `ChatGalleryEntry`: Save… via the dialog, Download via the helper, source line, Jump to message, gated Delete.
- [x] `lib/download-utils.ts`: `downloadGalleryEntry(entry)` (or a generic `downloadImageUrl(url, filename)` that appends `download=1`). `ImageModal` and `ChatGalleryImageViewModal` use it.
- [x] Update `__tests__/unit/photo-gallery-modal-deleted-handling.test.tsx` chat-mode fixtures to the new shape; add tests for the filter chips, the hidden bin on a non-deletable entry, and that Save opens the dialog with `kind: 'chat'`.
- [x] `qt-*` audit: `npm run lint` (the `check-qt-classes` gate); mirror anything new into `packages/theme-storybook`, bump its patch version, and stop for the human to `npm publish`.

### Phase 4 — download disposition (delegable)

- [x] `?download=1` on `files/[id]`, `files/proxy/[...key]`, `mount-points/[id]/blobs/[...path]`; `attachment` disposition via `buildContentDisposition`; `X-Blob-Sha256` and cache headers unchanged.
- [x] Route tests: default stays `inline`; `download=1` yields `attachment` with an RFC 5987 `filename*` for a non-ASCII name.
- [x] `docs/developer/API.md` notes the parameter on all three routes.

### Phase 5 — docs

- [x] **New `help/chat-gallery.md`**, `url: /salon/:id`, house voice: what the gallery shows (the seven sources, in the reader's terms — backdrops the Lantern painted, portraits Aurora repainted, the cast's standing portraits, pictures a character summoned, photographs you attached, pictures brought out of an album, pictures woven into the prose), the filter chips, the "current" badge, Save (pointing at the album picker described in chat-message-actions.md), Download, when the bin appears and why it sometimes does not. "In-Chat Navigation" section with `help_navigate(url: "/salon/:id")`.
- [x] `help/chat-participants.md` line 18 and the Organize section at ~486: the Gallery is always present and shows everything, not "when there are photos to display".
- [x] `help/chat-message-actions.md` "Save Image to a Photo Album": one sentence pointing at the gallery as the other door to the same dialog.
- [x] `help/photo-gallery.md` ("How a photograph finds its way into the cabinet"): mention the gallery's Save as a second route.
- [x] `docs/CHANGELOG.md` under `4.10-dev`, plain voice: **Added** the Salon chat gallery; **Fixed** bugs 129 and 130; **Changed** image routes accept `?download=1`.
- [x] `docs/developer/API.md`; move this file to `docs/developer/features/complete/` with an "Implementation notes (as landed)" section; add its row to `.claude/commands/update-documentation.md`.

## Design decisions (resolved)

- **A server-side enumerator, not a client-side union.** The client would have to call `/files`, `get-background`, `get-avatars`, the chat detail and every participant's character record, then dedupe across two id species by sha256 it does not have. The server has all of it in one place, and the sidebar count needs the same answer.
- **A new `gallery` action rather than growing `/files`.** `/files` is a file listing consumed by pickers and returns non-images; the gallery is an image listing with provenance. Sharing the message-walk helper keeps them from drifting without forcing one shape on both.
- **A chat-scoped save action rather than loosening the message guard.** The message route's guard ("this image is attached to this message") is a real invariant for attribution and for the sidecar's scene snapshot. Backgrounds and portraits have no message; pretending they do would mean inventing one. Two routes, one attribution helper, one album service.
- **Save goes through `SaveImageDialog`, not the character-photos route.** The requirement is "the way the ribbon does it": the full album list, caption, dedup notice. The hard-wired first-character buttons in the detail view were a shortcut from before the dialog existed and are removed, not kept alongside.
- **`?download=1` rather than a separate download route.** One flag on the existing routes, one helper on the client, and the Electron streaming path the Export buttons already prove out.
- **Portraits are shown but never deletable; kept and inline images likewise.** The gallery is a view over things other owners hold. Only records the chat itself minted (uploads, generations, superseded backgrounds and avatars) get a bin, and never the one currently on display.
- **Superseded backgrounds and avatars stay visible.** They are in `linkedTo` until the stale-chat collapse sweep removes them, and "backgrounds over the course of the story" is a feature, not a leak. The `current` badge is what tells them apart.
- **The `Gallery` button is unconditional.** Gating it on a count is what hid the feature for months. A cast always yields portraits, so the empty state is essentially unreachable anyway; when it is reached the modal's empty-state text handles it.
- **Realtime through the existing `chats` topic.** No new topic: the image jobs already publish per-chat hints, and the query key rides the `chats` row of the topic map. The poll is the offline fallback, gated as CLAUDE.md requires.

## Out of scope

- Bulk save / bulk download / zip export of a whole gallery.
- Reordering, captions or tags editable from the gallery (captions are set at save time in the dialog, as today).
- Making `DELETE /chat-files/[id]` understand link ids, or deleting kept vault images from the chat side.
- Rendering the gallery as a workspace tab rather than a modal.
- Exposing the gallery to the LLM (characters already have `list_images` / `attach_image`).

## Files touched (summary)

| Area | Files |
|---|---|
| Enumerator + save | `lib/photos/chat-gallery.ts` (new), `lib/photos/save-attribution.ts` (new), `app/api/v1/chats/[id]/handlers/get.ts`, `app/api/v1/chats/[id]/route.ts`, `app/api/v1/chats/[id]/files/route.ts`, `app/api/v1/chats/[id]/messages/[messageId]/route.ts`, `app/api/v1/images/route.ts` |
| Download | `app/api/v1/files/[id]/actions/download.ts`, `app/api/v1/files/proxy/[...key]/route.ts`, `app/api/v1/mount-points/[id]/blobs/[...path]/route.ts`, `lib/download-utils.ts` |
| Client state | `lib/query/keys.ts`, `lib/realtime/topic-map.ts`, `app/salon/[id]/hooks/useChatData.ts`, `app/salon/[id]/hooks/useChatGallery.ts` (new), `app/salon/[id]/SalonView.tsx`, `app/salon/[id]/components/ChatModals.tsx` |
| UI | `components/chat/ChatSidebar.tsx`, `components/images/PhotoGalleryModal.tsx`, `components/chat/ChatGalleryImageViewModal.tsx`, `components/chat/ImageModal.tsx`, `app/salon/[id]/components/SaveImageDialog.tsx` |
| Docs | `help/chat-gallery.md` (new), `help/chat-participants.md`, `help/chat-message-actions.md`, `help/photo-gallery.md`, `docs/CHANGELOG.md`, `docs/developer/API.md`, `docs/developer/bugs.md` + two bug files |

---

## Implementation notes (as landed)

Landed 2026-09-09 across all six phases. The design survived contact intact; what follows is the
short list of places where the code says something the plan above did not.

### Source #3 was mis-stated in the plan, and bug 130 is narrower than it reads

The plan says images from the Generate Image dialogs are never linked to their chat, citing
`app/api/v1/images/route.ts`. That is the wrong route. Both Salon dialogs
(`GenerateImageDialog`, `StandaloneGenerateImageDialog`) post to
`POST /api/v1/image-profiles/[id]?action=generate`, which has carried `chatId` in its schema all
along and passes it to `executeImageGenerationTool` → `saveGeneratedImage`, where
`linkedTo = chatId ? [chatId] : []`. **Dialog-generated images have always reached the gallery.**

What is true is the *collection* route: `POST /api/v1/images?action=generate` built `linkedTo` from
tags alone and had no `chatId` in its schema at all. No caller in the app uses it, so nothing was
actually orphaned. Bug 130 was filed against that route, with the discrepancy recorded in its own
write-up, and fixed as the plan specifies — an optional `chatId`, deduped into `linkedTo` through a
`Set`. Source #3 is therefore "already linked, via the profile route" rather than "not linked", and
the enumerator needed no special handling for it.

### Classification is by storage path, resolved through the link summary

The plan's pass-1 classifier wants "the file sits under a `story-backgrounds/` or Lantern
`generated/` path" and "a `character-avatar` storage path". A `FileEntry.storageKey` is
`mount-blob:<mountPointId>:<blobId>` and carries no path, so the relative paths come from the
`PhotoLinkSummary` the entry already needed — one `getPhotoLinkSummaryBySha256` per image, reused
for both the classification and the `[N links]` badge. The three signals that survive:

- `generated/` prefix → a Lantern backdrop (`writeLanternBackgroundToMountStore({ subfolder: 'generated' })`)
- `images/history/` prefix → an Aurora repaint (`writeCharacterAvatarToVault({ kind: 'history' })`)
- `folderPath === '/character-avatars/'` on the `FileEntry` → the same, for a chat whose files live
  in a project mount rather than a vault

`tool/` (the `generate_image` subfolder) is deliberately *not* a signal: `source === 'GENERATED'`
already answers that, and it is the classifier's fallback.

A superseded repaint keeps its character attribution from the participants' `avatarOverrides` rows
for this chat, since `chat.characterAvatars` only knows about the one presently worn.

### Inline references resolve to real records, not synthetic ids

The plan's pass 4 records "that the image was referenced". As written that would have produced
entries whose `id` was a URL, which Save could not have used. Both shapes are resolved to a real id
instead — `repos.files.findById` for `/api/v1/files/<id>`, and
`repos.docMountFileLinks.findByMountPointAndPath` for a blob path (absolute or resolved against the
author's vault) — so an inline picture is savable like any other. A reference that names no record
is skipped with a `debug` line.

The file-URL pattern matches the id segment loosely and lets `findById` be the arbiter: a stricter
uuid pattern would only turn "not found" into "not even looked for".

### `SaveImageDialog` keeps its picker alongside the target

`SaveImageTarget` landed exactly as specified. `attachments` stayed as a separate prop rather than
folding into the target, because it is the in-dialog picker's candidate list — a message with three
images still lets you change your mind after the dialog opens, and `target.fileId` is the initial
selection rather than a fixed one. The gallery passes a one-element array built from the entry it
opened on.

### The filter chips reuse `qt-tab`

No new `qt-*` class was added, and therefore no `packages/theme-storybook` mirror and no publish
gate. `qt-tab-group` / `qt-tab` / `qt-tab-active` are already a chip row and already themed; the
chips use them directly.

### Two small hardenings not in the plan

- `GET /chats/[id]/files` catches a failing `repos.chats.getMessages` and answers with the linked
  files alone. The pre-refactor code had that behaviour by accident (the message walk lived inside
  its own `try`); the refactor would have turned it into a 500.
- The collector applies a later pass's `messageId` to an entry it deduped by hash. Without it, a
  `generate_image` file found in pass 1 and re-seen in pass 2 under a mount-link id lost its
  Jump-to-message link. A test pins it.

### `ALREADY_SAVED` maps differently on the two routes

The chat-scoped route answers `409` with `code`, `relativePath` and `keptAt`, as the plan asks. The
message route still answers `400`, because the plan also says it is "unchanged in behaviour". The
dialog reads both: it treats a `409` *or* a `code: 'ALREADY_SAVED'` as the duplicate notice.

### Bug numbering

Bug 129 (the button that never appeared) and bug 130 (the collection route's missing `chatId`) were
both filed and both fixed; both live in `docs/developer/bugs/fixed/`. Bug 128's step 5 is marked
superseded in its own file, as the plan requires.
