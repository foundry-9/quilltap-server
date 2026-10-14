---
url: /aurora
---

# A Character's Photo Album — The Aurora Gallery

Every character in your workshop maintains a photo album. You'll find it on the character's own page — under **Aurora**, in the gallery tab — a grid of every picture that has been deposited into that character's keeping. Portraits the character has favoured, scene illustrations they have asked the Lantern to summon and `keep_image`'d for posterity, and any photographs you have uploaded into their album yourself: all of them line up here, side by side.

## Where the pictures actually live

A character's album is not a separate filing system. It is the `photos/` folder inside the character's document vault — the same vault that holds their wardrobe and commonplace book. Each photograph is a hard link to the original image bytes, accompanied by a small Markdown context document carrying the generation prompt, a snapshot of the scene at the time, your caption, and any tags. (No bytes are duplicated; the same image may live in your own gallery, in three different characters' albums, and in a chat attachment, all at once, with only one copy on disk.)

The character's pre-existing portrait — the one you set as their avatar at character creation, or the one a SillyTavern card brought in — sits alongside the photographs in `photos/`. An old portrait stored under `images/avatar.webp` remains visible too, so the album is never empty for a long-tenured character. The wardrobe pipeline's own working portraits, under `images/history/`, keep to their own shelf: see **Avatar Rolls** below.

## What you can do here

- **Upload** a new picture with the **Upload** button. Pick any image file from your machine; it is deposited directly into the character's vault `photos/` folder.
- **Set as avatar** — hover over any thumbnail and click the silhouette button. The character's `defaultImageId` is updated to point at the chosen photograph, and the new portrait propagates through the Salon, the chat list, the announcement bubbles, and every other place the character's face appears.
- **Clear avatar** — drop the current portrait without choosing a replacement.
- **Download a photograph** — hover over any thumbnail and click the downward arrow. The picture is handed to you as a proper file: a native save dialog in the desktop application, your browser's customary arrangements otherwise. No right-clicking required, which matters a great deal in the desktop shell, where right-clicking offers nothing at all. The same **Download** button (with **Copy**, beside it) sits at the top right of the enlarged view when you click a thumbnail.
- **Delete a photograph** — hover and click the bin, then click it again to confirm. The link is severed; if your character's album was the last place holding a hand on those bytes, the bytes themselves are garbage-collected. (If another character's album, a chat attachment, your own *My Photos* gallery, or any other link still points at the picture, the bytes stay where they are.)
- **Zoom in and out** with the magnifier controls to make the thumbnails larger or smaller.

## Avatar Rolls — the plates the house has already developed

Beneath the album you will find a second, quieter shelf: **Avatar Rolls**. Click the heading to open it.

These are not photographs anyone chose to keep. They are the working stock of the avatar pipeline — one portrait per *configuration* of outfit, image provider, profile and model. When a character changes their coat mid-scene, Quilltap draws them once in that coat and files the plate; every later scene in the same coat brings the same plate out of the drawer rather than commissioning (and paying for) a fresh sitting. The count beside the heading is how many distinct configurations this character has accumulated.

Each plate carries the same four courtesies the album offers, plus one of its own:

- **Set as avatar** — the silhouette button. The plate is filed into the album (if it is not there already) and hung as the character's standing portrait, which then propagates through the Salon, the chat list, the announcement bubbles, and everywhere else the character's face appears.
- **Keep in the photo album** — the bookmark button. The plate is hard-linked into `photos/` and joins the album above. A plate already kept shows the bookmark filled in and the button goes quiet; keeping is never done twice.
- **Download** — the downward arrow, exactly as in the album.
- **Delete** — the bin, twice to confirm. The plate leaves the drawer and any conversation displaying it stops pointing at it, so nothing is left naming a picture that has gone. **If you had kept a copy in the album, that copy stays** — only the plate is discarded. The next time the character wears that ensemble, a fresh sitting is simply commissioned.
- **View** — click the plate itself for the enlarged view, with its generation prompt, **Copy**, **Download**, and **Save to my gallery** (which files it in your own *My Photos* collection rather than the character's album).

Avatar rolls do not appear in the album above unless you put them there. The album is what someone chose to keep; this drawer is what the house had to draw along the way.

## How a photograph ends up in the album

There are three principal routes:

1. **You upload it.** The Upload button on this very page.
2. **The character keeps it during chat.** When a character has the **Document Editing** tools enabled and they generate (or are shown) an image in the Salon, they may invoke `keep_image` to file the picture in their own album. See [The Photo Album — Keeping, Listing, and Re-Attaching Images](keep-image-tools.md) for the details.
3. **You set their avatar from a generated image.** The portrait gets written into the vault as part of the avatar pipeline.

## A note on what changed

In earlier versions, a character's gallery was assembled by trawling every image in the workspace and showing the ones that happened to be *tagged* with the character. That arrangement was clever but indirect: a picture's membership in a character's album depended on a flag scattered across the image system rather than living inside the character's own vault.

Quilltap now keeps each character's photographs where they conceptually belong — under the character's vault, in `photos/` — and the gallery you see here is simply the contents of that folder. A one-time migration moves every previously-tagged image into the matching character's vault on first startup; you should not notice anything missing.

## In-Chat Navigation

To direct the conversation to a character's gallery, navigate to the character's Aurora page:

```
help_navigate(url: "/aurora")
```
