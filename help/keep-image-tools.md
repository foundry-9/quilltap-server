---
url: /settings?tab=chat
---

# The Photo Album — Keeping, Listing, and Re-Attaching Images

When a character generates an image in the Salon, that image is, by default, a passing thing. The chat is cleaned up after thirty days, the original file slips quietly into the void, and all that remains is a fond recollection. This is, as a rule, fine. But occasionally a character will produce a portrait, a backdrop, or an artefact of such evident merit that they should rather like to keep it about — to glance at it again later, to bring it up in conversation a fortnight hence, to file it tidily away under "covenant" or "the night we built the sunroom."

For these occasions Quilltap furnishes three brass-handled instruments: **`keep_image`**, **`list_images`**, and **`attach_image`**.

## What's actually happening

A character's photo album is not a separate filing system. It is a directory called `photos/` inside the character's own document vault, the same vault that holds their wardrobe and their commonplace book. When the character keeps an image, the system makes a hard link to the existing image binary — no duplication of bytes — and writes a small Markdown document describing the photograph (the original generation prompt, a snapshot of the scene at the time, the caption the character wished to remember it by, and a freeform tag or two). That Markdown is what becomes searchable. A blind LLM (one that cannot itself perceive images) can therefore still reason about the picture, because the description and provenance ride along with it in plain English.

Because it's a hard link rather than a copy, the original image binary persists for as long as any link to it exists — including the link in the character's album. The thirty-day chat cleanup does not touch a kept image.

## The Tools

### `keep_image(uuid, caption?, tags?)`

Save an image to the calling character's photo album. Pass:

- **`uuid`** — the UUID of the image to save. The character receives one when they generate the image; it also appears in any prior `list_images` result.
- **`caption`** — optional. A short, human-flavoured phrase the character wants to remember the image by (e.g. *"the night we built the sunroom"*).
- **`tags`** — optional. Freeform retrieval labels (e.g. `["covenant", "sunroom"]`). These are not the platform's global Tag system — they exist purely to help the character find this photograph later by semantic similarity.

If the character has already kept this image, `keep_image` declines politely with the path of the existing copy. To amend a caption or tag set, delete the existing copy first (with `doc_delete_file`) and keep the image afresh.

### `list_images(query?, tags?, saved_by?, limit?, offset?)`

List photographs in the character's album, with optional semantic search and filters.

- **`query`** — a freeform phrase. The system embeds it and ranks against the prompt + scene + caption + tags of each kept image.
- **`tags`** — restrict to images bearing any of these tags.
- **`saved_by`** — restrict to images saved by a particular character (by name or id). Mostly useful when Shared Vaults is on and the chat contains characters who can see each other's albums.
- **`limit`** / **`offset`** — pagination. Defaults: 20 results per page from the beginning.

If Shared Vaults is enabled for the chat and the participating characters have `systemTransparency`, their albums become visible to one another. Otherwise each character sees only their own.

### `attach_image(uuid)`

Re-attach a previously kept image to the current message — render it inline in the conversation again. Pass the UUID returned by `list_images` (the album link uuid) or the original image-v2 uuid. The system resurfaces the image with its caption and tag set, attaching the descriptor to the outgoing reply.

A character can only attach images from their own album. If they wish to share a photograph another character has kept, they must keep their own copy first.

## How the character knows the UUID

Whenever a fresh image is announced in chat — a new portrait commissioned by Aurora, a backdrop projected by the Lantern, an ad-hoc picture from `generate_image`, or an image the user has uploaded as an attachment — the announcement message in the transcript names the file's UUID inline (catalogued thus: "...uuid `abc-123-...`..."). The character can simply read it off the page and feed it to `keep_image`. Library shelves are well-labelled, and so are these.

## Where the bytes live

- The image binary lives once, in `doc_mount_blobs`, shared by every link to it.
- The character's album link lives in `doc_mount_file_links` under `<characterVault>/photos/`.
- The link's `extractedText` carries the Markdown context document — YAML frontmatter (tags, `linkedBy`, `linkedById`, `generationModel`), the prompt, the revised prompt if present and different, a scene snapshot from `chat.sceneState` at keep-time, and a closing attribution line.
- The Markdown is chunked and embedded inline, so the character's vault search picks it up automatically. No new search source, no new filter — just ask the character about their photographs.

## Enabling and Disabling

The three photo album tools live in the same group as the document editing tools — gated by the **Document Editing** toggle in the chat tool settings. Disabling that group disables the photo album tools as well.

## In-Chat Navigation

To navigate to the chat settings where tools can be configured:

```
help_navigate(url: "/settings?tab=chat")
```
