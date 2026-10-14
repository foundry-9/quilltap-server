# Bug 151 — unseen images ride to the model at full resolution, and nothing counts the bytes

**FIXED in v4 (2026-09-17)** — images are now trimmed to what a model needs to
read them at the two points where bytes are loaded for a request, and the walk
that collects unseen images spends a byte budget rather than a message count.
Stored files are untouched: the archive keeps its full resolution and quality.

| | |
|---|---|
| **Status** | **FIXED** |
| **Found** | 2026-09-17, reported from the `Friday` instance — *"something too large for DeepSeek"* on a turn addressed to Baraka Ilunga |
| **Fixed** | 2026-09-17 |
| **Severity** | **Medium-High** — the turn fails outright and the chain stops. Nothing is lost or corrupted, but a multi-character room becomes unusable for any vision-ticked profile as soon as avatars are regenerated, and the operator is told nothing that points at the cause |
| **Who it bites** | any chat on a profile with **Supports image upload** ticked, after Aurora or the Lantern has generated more than one image since the responding character last spoke. Worst on providers with a tight request-body limit — NanoGPT answers somewhere under 4.5 MB |
| **Provenance** | Original to v4. Latent since generated images began reaching vision profiles ([bug 91](bug-91-image-attachments-silently-dropped.md)); surfaced by `gpt-image-2.5`, whose 1024x1536 output stores at ~1.7 MB where the previous generation averaged 198 KB |
| **Fix site** | `lib/files/llm-image-budget.ts` (new), `lib/chat-files-v2.ts` (both load paths), `lib/services/chat-message/context-builder.service.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

## Symptom

A turn addressed to a character on a NanoGPT/DeepSeek profile fails, and the
chain stops. The Salon surfaces the provider's message verbatim, which reads
as a complaint about size and names no subject:

```
[stderr] NanoGPT API error in streamMessage: 413 Request Entity Too Large
[stderr] [TurnOrchestrator] Chain error, stopping
         chatId=7f6ab2f6-2e23-4620-a07b-0d574809f41b chainDepth=1
```

It is read as a context-window problem, which is the one thing it is not. The
same turn logged:

```
[ContextManager] Budget analysis
  maxContext: 1000000   totalEstimatedTokens: 49652   compressionNeeded: false
```

Six minutes earlier the identical profile had served a turn in the same chat
without complaint.

## Root cause

**Image bytes are not tokens, and nothing else was counting them.**

Three independent decisions have to line up for this to fire, and on the
reported turn all three did.

**1. The image gate was open.** `profileCanReceiveAttachment`
(`lib/llm/image-transport.ts:70`) asks two questions — does the model read
this, and can the plugin put it on the wire — and both answered yes. The
profile `DeepSeek V4 Flash Latest` (`deepseek/deepseek-v4.1-flash`) carries
`supportsImageUpload = 1`, and the NanoGPT plugin declares `image/*` in its
manifest's `attachmentSupport`. So the raw bytes were kept rather than being
replaced by the describe-fallback's text.

**2. The walk that collects unseen images counts messages, not bytes.**
`collectLanternImageFileIdsForCharacter`
(`lib/services/chat-message/context-builder.service.ts:249`) walks back from
the tail gathering every image attached to an ASSISTANT message since the
responding character last spoke, bounded by `ASSISTANT_IMAGE_LOOKBACK = 6` —
a **message count**. Baraka had not spoken since before 14:31, and Aurora
generated six avatars between 14:32:02 and 14:33:52, so the walk found two
inside its six-message window and had no ground on which to decline either.

**3. The only size check is per-image, and each image passed it.**
`readFileAsBase64` and `loadMountFileAsAttachment` (`lib/chat-files-v2.ts`)
both resized an image only when its base64 exceeded
`getProviderMaxBase64Size(provider)`. NanoGPT's manifest declares no
`maxBase64Size`, so that resolves to `DEFAULT_MAX_BASE64_SIZE = 4 MB`
(`lib/files/image-processing.ts:18`). Measured:

| | stored | base64 | over the 4 MB per-image cap? |
|---|---|---|---|
| `avatar_Lost_Severed_gen_1_0_314_…889.webp` (1024x1536) | 1,757,654 B | 2.23 MB | no |
| `avatar_Baraka_Ilunga_…615.webp` (1024x1536) | 1,796,172 B | 2.28 MB | no |
| **on the wire together** | 3,553,826 B | **4.52 MB** | — |

Neither was touched, because the cap cannot see the other one. 4.52 MB of
base64 plus ~200 KB of prompt text went to `nano-gpt.com`, which returned 413.

**`convertToWebP` never resizes.** The avatar and story-background handlers
transcode provider output at `WEBP_QUALITY = 90`
(`lib/files/webp-conversion.ts:16`) and store whatever dimensions the provider
returned. That is correct for the archive and is not the defect — but it means
the bytes a model receives are the bytes a gallery needs, which is a far
larger number.

## Why it survived

- **The token budget is the thing everyone reads, and it is blind here.**
  `[ContextManager] Budget analysis` reported 49,652 tokens against a
  million-token window and `compressionNeeded: false` — all true, all
  irrelevant. There was no second budget expressed in bytes anywhere on the
  path.
- **Every guard was scoped to one image.** The provider cap, the resize
  helper and the manifest's `maxBase64Size` all answer *"is this picture too
  big"*, and the failure is *"are these pictures too big together"*. No layer
  owned the aggregate.
- **The text side already had the budget the image side lacked.**
  `rehydrateUserAttachments` caps re-hydrated attachment *text* at
  `REHYDRATED_ATTACHMENT_CHAR_BUDGET = 80_000` and warns on overrun. The
  image walk beside it, added for the same class of problem, shipped with a
  message count and no byte equivalent — and text is the cheaper of the two by
  more than an order of magnitude.
- **It needed a model generation to become reachable.** Across `Friday`'s
  1,850 generated images the mean is 198 KB; two of those on one turn is 528 KB
  of base64 and nothing notices. `gpt-image-2.5` made the mean irrelevant.
- **The error names the wrong subject.** A 413 from a proxy reads as a context
  problem on the model behind it, which sends the reader to the context
  window — the one number that was fine.

## The fix

**Storage and transport are now different questions.** Nothing about a stored
file changes: avatars and backgrounds keep their full resolution and quality
90, and the gallery, the album, exports and backups are untouched. What
changed is what a *request* carries.

**`lib/files/llm-image-budget.ts` (new)** is the single source of truth for
what an image costs on the wire:

- `shrinkImageForLlmTransport` caps the long edge at
  `LLM_TRANSPORT_MAX_EDGE = 1024` (never enlarging), then re-encodes as WebP
  stepping down `LLM_TRANSPORT_QUALITY_LADDER = [78, 65, 55, 45]` until the
  base64 fits the smaller of `LLM_TRANSPORT_TARGET_BASE64 = 500 KB` and the
  provider's own per-image limit. 1024 is the single-tile read size the major
  vision stacks converge on; a 1536x1024 background becomes 1024x683 and a
  1024x1536 portrait becomes 683x1024.
- It never throws and never refuses. An undecodable buffer, a format sharp
  cannot resize, or an encode failure all return the input unchanged, because
  a turn that sends the stored bytes is strictly better than a turn that
  sends none.
- `LANTERN_IMAGE_BASE64_BUDGET = 2 MB` is the per-turn aggregate — four images
  at the per-image ceiling, and a wide margin under the narrowest provider
  body limit we have met.

Measured on the actual avatar from the reported turn
(`51a5dd74-…`, 1024x1536, 1,796,172 B):

| | dimensions | base64 |
|---|---|---|
| stored (unchanged) | 1024x1536 | 2,339 KB |
| on the wire, first rung (q=78) | 683x1024 | **98 KB** |

A 24x reduction, and the portrait is still fully legible — face, expression,
suit panelling, the bracelet, the HUD glyphs and the background terrain all
survive. The reported turn would have carried **196 KB** where it carried
4.52 MB.

**`lib/chat-files-v2.ts`** applies it in both load paths — `readFileAsBase64`
for the legacy `files` table and `loadMountFileAsAttachment` for mount blobs.
The second is the one that matters most: a character's avatar lives in their
vault, so every generated portrait reaches a model through it. Both keep
`resizeImageForProvider` afterwards as a hard backstop for the formats the
transport budget had to pass through; an `autoResize: false` caller still
gets the stored bytes verbatim.

**`lib/services/chat-message/context-builder.service.ts`** spends
`LANTERN_IMAGE_BASE64_BUDGET` across the walk's results, measuring
`fileAttachment.data.length` — the base64 this turn will actually put on the
wire, already trimmed — rather than the stored file's `size`. Overrun drops
images and warns, mirroring `rehydrateUserAttachments`' `skippedForBudget`.

**The budget is spent newest-first**, which deliberately differs from the text
path's oldest-first: when a budget forces a drop, the picture worth keeping is
the one just generated, not the portrait it replaced. Both the prefix and the
attachments are restored to chronological order afterwards, so ordering as
seen by the model is unchanged.

## How to verify

`__tests__/unit/lib/files/llm-image-budget.test.ts` — 9 cases against **real
sharp**, not a double, because the defect was entirely about measured byte
sizes and a mocked encoder returns whatever buffer the test hands it.

- *the provider ceiling alone leaves a 1.7 MB avatar untouched* pins the
  unfixed behaviour directly: `resizeImageForProvider` reports
  `wasResized: false` on a portrait whose base64 is over the transport target,
  which is the whole defect in one assertion.
- *keeps two shrunk avatars inside the per-turn budget that bug 151 blew*
  reproduces the reported turn and asserts the pair lands under both the new
  budget and the 4.52 MB that drew the 413.
- Long-edge caps for portrait and landscape, the 500 KB ceiling, the
  already-small passthrough, the SVG passthrough, undecodable bytes, and a
  provider ceiling below the ladder's reach.

By hand: regenerate two or more avatars in a multi-character chat, then take a
turn as a character on a vision-ticked profile. `logs/combined.log` at debug
shows `Image shrunk for LLM transport` with both dimension pairs, and the turn
completes.
