# Wardrobe item images: a picture of every garment and outfit

**Status:** implemented in 4.10-dev. Part 3 of the wardrobe programme; follows
[wardrobe-list-legibility.md](wardrobe-list-legibility.md) (it reshapes the row this spec adds a
thumbnail to). Independent of [wardrobe-wear-ledger.md](wardrobe-wear-ledger.md).

> **As built (2026-10-07).** Where the implementation departs from the text below:
>
> - **§3.1 needed a migration.** `chat_settings` is column-per-field, so `wardrobeImageSettings`
>   got a column via `add-wardrobe-image-settings-field-v1` (default `{"imageProfileId":null}`).
> - **§3.3 step 2 reads the owner with `characters.findById`, not `findByIdRaw`.** The raw row
>   lacks the vault-managed physical description; a read failure still falls to catalogue.
> - **§3.2 "sanitizer and concealment pass".** The avatar pipeline has neither, so none runs
>   here; the worn prompt shares only `buildFigureIdentityBlock` with the avatar.
> - **§7 export.** Picture `files` rows are not emitted as `file` records (that would ship every
>   picture's bytes twice). Each character-owned `wardrobe_item` record carries `_imageFiles`
>   (metadata only); the bytes ride in the vault blobs. `importWardrobeItemImages` re-mints the rows
>   against the imported vault after `reconcileRelationships`, keeping the exported id when free.
> - **§2.2 the link.** A `files` row's `originalFilename` is its link's leaf name, so the link is
>   always `Wardrobe/images/<itemId>/<originalFilename>` in the mount its `storageKey` names; that
>   is how delete/move/copy find it.
> - **§6.1 caption.** The profile name and reroute flag come from the generate response; a
>   reopened editor names the stored `generationModel` instead.
> - **Later addition: tool-queued pictures.** `wardrobe_create` / `wardrobe_update` can queue a
>   `WARDROBE_ITEM_IMAGE_GENERATION` job, gated by `wardrobeImageSettings.generateFromTools`
>   (`lib/wardrobe/tool-image-generation.ts`). The bridge's blob write now has a host-RPC arm for
>   that job; the "parent-process only" rule in §2.1 holds for deletes. `wardrobe_list` /
>   `wardrobe_read` expose `image_file_id` for `describe_image`.
> - **Known limit.** Importing the same character twice into one instance already duplicates
>   wardrobe item ids across vaults; picture history is keyed by item id, so the two copies share it.

A wardrobe item or outfit may carry an image. It can be **generated in place** from a button
in the editor (or the row's menu), using an image-generation profile designated for wardrobe
work — some providers refuse a garment on its own, and the operator wants to pick a desk that
will draw it — or **attached by hand** from a file. When items are created by **Import from
image**, the photograph they were read from becomes their first image. An item keeps a small
history of its images with one marked current; a bad regeneration costs nothing.

## 1. Settled decisions (operator, 2026-10-07)

- **A character-owned item is drawn worn by its owner.** The subject is the character, full
  length, wearing the garment, on a plain studio ground; the garment is the point of the
  picture. A shared item (General, project, group) has no owner and is drawn **catalogue
  style**: the garment alone on a dress form or flat-laid, no person. An outfit follows the
  same rule for the whole ensemble.
- **Refusals fail over to the Concierge's uncensored image desk**, through
  `generateImageWithConciergeFailover` like every other refusable image call. There is no
  chat, so there is no Locked state; the only gate is whether an uncensored image understudy
  is configured. The response says which profile drew it.
- **History, one current.** Regenerating or uploading adds an image; the newest becomes
  current; earlier ones stay as thumbnails and can be made current or deleted.
- **A designated profile, overridable per generation.** Settings → Images gains a *Wardrobe
  images* card with an image-profile picker. The Generate button uses it by default and
  offers a one-click override.
- **Generation is synchronous**, in the API route, wrapped in `trackActivity('image', …)` —
  the same shape as the avatar preview route. No new job type, no host-RPC bridge, no polling.
  The editor shows an in-place busy state for the twenty-odd seconds it takes.
- **The image is stored in the item's own tier mount**, beside the markdown, keyed by item id
  so renames cannot orphan it. It gets a `files` row the way avatars do, so it has a URL with
  immutable caching, a thumbnail, and the generation prompt on record.

## 2. Storage

### 2.1 Bytes

Each image is written into the mount that holds the item's `Wardrobe/*.md` — the character's
vault, the group's or project's official store, or Quilltap General — at

```
Wardrobe/images/<itemId>/<yyyymmdd-hhmmss>-<kind>.webp      kind ∈ generated | uploaded | imported
```

via `linkBlobContent` (`lib/database/repositories/doc-mount-file-links.repository.ts`), which
transcodes to WebP, de-duplicates bytes by sha256, and creates the `doc_mount_files` /
`doc_mount_blobs` / `doc_mount_file_links` trio. A new bridge,
`lib/file-storage/wardrobe-image-bridge.ts`, wraps it:

```ts
writeWardrobeItemImage(input: {
  mountPointId: string; itemId: string; kind: 'generated' | 'uploaded' | 'imported';
  content: Buffer; contentType: string; description?: string;
}): Promise<{ storageKey: string; linkId: string; blobId: string; relativePath: string; sha256: string; sizeBytes: number }>
```

following `character-vault-bridge.ts`: `sanitizeLeafName`, `ensureFolderPath`, the
`mount-blob:{mountPointId}:{blobId}` storage key from `buildMountBlobStorageKey`, then
`emitDocumentWritten` so the mount index notices. It refuses to run in the job child
(`QUILLTAP_JOB_CHILD === '1'` → throw) rather than growing a host-RPC arm nobody calls yet;
every caller in this spec is a parent-process route.

The projection sweep in `vault-projection.ts` lists and deletes **`.md` documents only**, so a
blob link under `Wardrobe/images/` is neither mistaken for a garment nor swept. It is also
not renamed or deleted with the item — which is why it is keyed by id and why §5 deletes it
explicitly.

Mount resolution per tier: `resolveWardrobeMount` (`wardrobe-writes.ts`) for a character (it
throws `CharacterArchivedError` for a tombstone — the image route must let that propagate, never
fall back), `getGeneralMountPointId()` for General, and the official store for a project or
group (`ensureProjectOfficialStore` / `ensureGroupOfficialStore`). Resolve through
`resolveWardrobeContainer` (`lib/wardrobe/resolve-container.ts`), which already returns the
mount id for a `{ scope, id }` pair.

### 2.2 The `files` row

```ts
repos.files.create({
  storageKey, linkedTo: [itemId], tags: [itemId],
  source: 'GENERATED' | 'UPLOADED' | 'IMPORTED',
  category: 'IMAGE', mimeType: 'image/webp', size,
  generationPrompt, generationModel,             // generated only
  description: 'Wardrobe image for “<title>”',
}, { id: fileId })
```

`linkedTo` and `tags` must be UUIDs; item ids are (the parser's fallback mints one from the
path). The URL is `/api/v1/files/{fileId}` and `?action=thumbnail` for the row. The history is
**not** a frontmatter list: it is `files.findByLinkedTo(itemId)` filtered to `category: 'IMAGE'`,
newest first.

### 2.3 Frontmatter: one key

`imageFileId: <uuid>` — the current image. Threaded through the five places a new field must
appear or the vault round-trip drops it:

- `WardrobeItemSchema` and `wardrobeItemFieldsSchema` (`lib/schemas/wardrobe.types.ts`):
  `imageFileId: UUIDSchema.nullable().optional()`. It is accepted on update only to *choose*
  among the item's own images (§4.4 validates); a create body may not set it.
- `lib/wardrobe/create-body.ts`.
- `buildWardrobeItemFile` (`lib/mount-index/character-vault.ts`): emitted when set.
- `parseWardrobeItemFile` (`lib/database/repositories/vault-overlay/parsers.ts`): read into the
  hand-built object.
- The frontmatter table in `docs/developer/DDL.md`.

Setting it goes through the ordinary update chokepoint (one folder re-projection per
generation; acceptable).

## 3. The profile and the prompt

### 3.1 Designated profile

`chatSettings.wardrobeImageSettings: { imageProfileId: string | null }` — a new JSON object in
`ChatSettingsSchema` (`lib/schemas/settings.types.ts`), `.optional()`, so no migration. Mirror
`storyBackgroundsSettings` end to end: a branch in `app/api/v1/settings/chat/route.ts`, a
default in `chat-settings.repository.ts`, a handler in
`components/settings/chat-settings/hooks/useChatSettings.ts`, the types in
`components/settings/chat-settings/types.ts`, a remap line in
`lib/backup/restore/uuid-remap.ts`, and a line in the Almanack ledger
(`lib/tools/almanack/phase3-ledgers.ts`).

Resolver, beside `resolveImageProfileForChat` in `lib/image-gen/profile-resolution.ts`:

```ts
resolveWardrobeImageProfile(userId, repos, override?: string | null): Promise<ImageProfile | null>
// override → wardrobeImageSettings.imageProfileId → repos.imageProfiles.findDefault(userId)
// each must exist, be the user's, and carry apiKeyId — the same three checks the chat resolver makes
```

It deliberately does **not** consult `storyBackgroundsSettings.defaultImageProfileId`: the
Lantern's backdrop desk is chosen for landscapes, not for a garment someone might refuse.

Settings UI: a **Wardrobe Images** collapsible card in
`components/settings/tabs/ImagesTabContent.tsx` between *Story Backgrounds* and *Default
Aesthetics*, one picker ("Which artist draws the garments. Pick a desk that will not balk at
the odd corset; the Concierge's uncensored desk stands in if it does."), listing every image
profile with its `isDangerousCompatible` ones marked. Section id `wardrobe-images`, so the help
deep-link is `/settings?tab=images&section=wardrobe-images`.

### 3.2 Prompt (`lib/wardrobe/item-image-prompt.ts`)

```ts
buildWardrobeItemImagePrompt(repos, input: {
  item: WardrobeItem;
  components: WardrobeItem[];            // resolved leaves for a composite; [] for a garment
  owner: Character | null;               // null → catalogue
  projectOfficialMountPointId?: string;  // for the aesthetic
}): Promise<{ prompt: string; orientation: 'portrait' | 'square'; subject: 'worn' | 'catalogue' }>
```

- **Cue per garment:** `imagePrompt ?? title`, the rule `avatar-prompt.ts` already follows via
  `decorateOutfitItems(..., { titleOnly: true })`; the `description` is Markdown prose and is
  **not** fed to a diffusion model, matching the existing pipelines. For an outfit, the
  components' cues joined in canonical slot order, through `outfit-description.ts` so the hair
  slot's unreported-if-blank rule and the slot phrasing are not restated here.
- **Worn (owner present, not archived):** the identity block the avatar prompt builds —
  physical description and the pronoun-derived sex anchor from
  `lib/characters/pronoun-gender.ts` — extracted into a shared `buildFigureIdentityBlock` in
  `avatar-prompt.ts` so the two prompts cannot drift. Then: "full-length, standing, facing the
  viewer, wearing <cue>; the rest of the attire plain and unremarkable so the garment is the
  subject; neutral studio backdrop; even light". A hair-slot item is framed head and shoulders.
  Orientation portrait. The avatar pipeline's sanitizer and per-character concealment pass run
  here too, unchanged — a character concealed in portraits is concealed on the hanger.
- **Catalogue (no owner):** "product photograph of <cue> on a dress form / laid flat, no
  person, neutral ground, even light". Orientation square.
- **Aesthetic:** `resolveAesthetic({ kind: 'aurora', projectOfficialMountPointId })` — the
  Images tab's "people and their outfits" aesthetic — for both subjects.
- The resulting prompt is returned to the client with the image and stored as the file's
  `generationPrompt`, so the operator can see what was asked.

### 3.3 Generation (`lib/wardrobe/item-image-generation.ts`)

```ts
generateWardrobeItemImage(repos, { userId, container, item, imageProfileId?: string }): Promise<{
  fileId: string; url: string; prompt: string;
  profile: { id, name }; rerouted: boolean; trail: ConciergeTrail | null;
}>
```

1. Resolve the profile (§3.1); none → `badRequest` with the same copy the avatar path uses
   ("Set one in Settings → Images").
2. Build the prompt; load the owner with `characters.findByIdRaw` (raw: a broken vault costs
   the figure, not the picture — fall to catalogue and say so in the response's `subject`).
3. `conciergePolicy = resolveConciergeSettings(await repos.chatSettings.findByUserId(userId), null)`.
4. `generateImageWithConciergeFailover({ profile, apiKey }, attempt, { userId, chatId: null,
   purpose: 'wardrobe', conciergePolicy })`, where `attempt` does `buildImageGenParams`,
   `createImageProvider(profile.provider).generateImage`, and `logLLMCall` with
   `type: 'WARDROBE_ITEM_IMAGE'`, rebuilding params when the profile differs from the primary
   (the shape in `character-avatar.ts`'s `attemptPortrait`). Widen the `purpose` union in
   `image-failover.ts`, `concierge-notifications/writer.ts` (`ConciergeRefusalPurpose`) and
   `refusal-ledger.ts` with `'wardrobe'`; with no chat the ledger and announcement arms are
   skipped, and the trail comes back for the editor to show.
5. `convertToWebP` → `writeWardrobeItemImage` → `files.create` → item update
   `{ imageFileId }`.
6. Return. All inside `trackActivity('image', …)` so the Img chip lights.

A refusal that the understudy also refuses (or no understudy configured) surfaces as a `422`
with the trail; the editor renders it as text with a "Try another profile" picker — never a
silent failure.

## 4. API

One route for every tier, dispatching by action, with the container in the query so the four
per-tier route families are not each grown four handlers:

```
GET    /api/v1/wardrobe/[itemId]/images?scope=<scope>&id=<containerId>
       → { current: fileId | null, images: [{ fileId, url, thumbnailUrl, source, createdAt, prompt?, model? }] }

POST   …?action=generate      body { imageProfileId?: string }           → { image, prompt, profile, rerouted, trail }
POST   …?action=upload        multipart file (validateImageFile: types + 10 MB cap from lib/images-v2.ts) → { image }
POST   …?action=set-current   body { fileId }                             → { current }
POST   …?action=delete-image  body { fileId }                             → { current }   // next-newest becomes current
```

`app/api/v1/wardrobe/[itemId]/images/route.ts`, `createContextHandler` +
`withActionDispatch` per the standing rule (no action on POST → 400; there is no default
verb). The handler resolves the container, reads the item from it (404 if the item is not in
that container — the same probing the dialog's transfer code does), and lets
`CharacterArchivedError` map to `409`.

`set-current` and `delete-image` validate that `fileId` is linked to `itemId`
(`files.findByLinkedTo`), the only way `imageFileId` is ever written. The PUT item route
accepts `imageFileId` in `updateWardrobeSchema` and applies the same check in
`wardrobeItemFieldsSchema`'s route step — hand-setting it to a foreign file is refused.

## 5. Lifecycle hygiene

- **Item deleted:** `item-route-steps.ts` gains `cleanupItemImages(itemId)`: for each linked
  `files` row, `deleteWithGC(linkId)` on the mount link and delete the row. Same step as
  `cleanupEquippedRefs` (and the ledger cleanup from part 2), called by all three delete routes.
- **Transfer move** (`transfers/route.ts`): the item keeps its id but changes mount. Re-link
  each image into the destination mount at the same relative path (`linkBlobContent` with the
  same bytes de-duplicates to one blob), update each `files` row's `storageKey`, then
  `deleteWithGC` the source links. **Copy:** new id, so new links under the new id; `files`
  rows duplicated with new ids and `linkedTo: [newId]`; the copy's `imageFileId` points at its
  own copy.
- **Archived character:** writes refused (tombstone); reads still serve the picture.
- **Composite deleted:** its own images only; components keep theirs.

## 6. UI

### 6.1 Editor (`components/wardrobe/wardrobe-item-editor.tsx`)

A new **Image** section directly under Title, above the slot checkboxes — it is the most
visible thing in the form, which is the discoverability the operator asked for:

```
┌──────────────────────────────────────────────────────────────────┐
│ [ current image, portrait, max-h 16rem, or an empty dashed frame  │
│   reading “No picture yet” with the two buttons centred in it ]   │
│                                                                   │
│  [✦ Generate ▾]   [⬆ Upload]            Drawn by Flux Pro · rerouted to the uncensored desk │
│                                                                   │
│  history: [■][■][■]   (thumbnails; hover → Make current · Delete) │
└──────────────────────────────────────────────────────────────────┘
```

- **Generate** runs with the designated profile. Its `▾` opens the profile list (the same
  markup `AvatarGenerationPane` uses) with the designated one preselected; choosing another
  generates with that override once. While running, the frame shows a spinner and the
  buttons disable; on success the new image is current and slides into the history strip.
- The caption under the buttons names the profile that drew the current image and whether
  it was rerouted (from the response's `profile` / `rerouted`). A refusal that could not be
  rerouted renders as a short notice with the trail's last reason and the profile picker
  open.
- **Upload** accepts the same types as Import from image (JPEG, PNG, WebP, GIF; 10 MB).
- In **create** mode the section is present but inert: "Save the item first; then it may sit
  for its portrait." A fresh item has no id to hang a picture on.
- The section is identical for every tier; for a shared item the catalogue subject is
  implied, and the caption says "catalogue shot" so the operator is not surprised that nobody
  is wearing it.

### 6.2 Row (`wardrobe-item-row.tsx`)

A 40 px square thumbnail (`?action=thumbnail`) at the left of the title block when the item
has a current image; nothing when it has none. The ⋮ menu gains **Generate image** (uses the
designated profile, no picker; result lands in the row's thumbnail and a toast) for
manageable items, under *Edit*. Borrowed rows do not get it — a General garment is drawn from
the General wardrobe, by whoever manages it.

### 6.3 Pickers

`equipped-slot-row.tsx` and `outfit-quick-pick.tsx` candidate rows show a 28 px thumbnail
before the title when one exists. Two "Midnight Lightning…" garments with different pictures
are told apart at a glance, which is the picker's whole problem (part 1).

### 6.4 Import from image (`components/wardrobe/import-from-image-modal.tsx`)

The modal already holds the `File`. After each `POST …/wardrobe` creates a piece (and after
the optional outfit composite is created), it calls `?action=upload` on the new item with the
same file and `kind=imported`. `linkBlobContent` de-duplicates by sha256, so N pieces plus an
outfit share one blob behind N+1 links. The review step gets a line above the cards: "The
photograph will be kept as each piece's first picture" with a checkbox, on by default, to
turn it off. The `analyze-image` route itself is unchanged — it still discards the bytes.

### 6.5 Settings

The *Wardrobe Images* card (§3.1).

## 7. Export, import, backup

- `.qtap` export: the image `files` rows export as `file` records the way avatar-history files
  do (they share the `mount-blob:` storage-key path the exporter already handles), and the mount
  links ride with the mount's documents. `imageFileId` is a field of the `wardrobe_item`
  record; add it to `$defs/WardrobeItem` in `public/schemas/qtap-export.schema.json`. Shared
  items' `imageFileId` travels inside their `doc_mount_document` frontmatter already.
- Import: remap `imageFileId` through the files id map in `importCharacterWardrobeItems`
  (`import-characters.ts`); null it when the file did not come along. Re-link the file's
  `linkedTo` to the new item id.
- Backup/restore: nothing new — `files`, `doc_mount_*` and the vault documents are already
  backed up; add `imageFileId` to `uuid-remap.ts`'s wardrobe entry beside `componentItemIds`.
- The export-exclusion predicate (`lib/export/excluded-files.ts`) does not exclude `IMAGE`
  category files; confirm with a test that a wardrobe image is included, since the whole point
  of a `.qtap` of a character is that their wardrobe arrives dressed.

## 8. Logging

`generateWardrobeItemImage` logs `debug` at start (item, container, subject, profile) and
`info` on completion (fileId, bytes, rerouted, duration); the bridge logs `debug` per write;
cleanup and transfer re-linking log `info` with counts. Refusals log at `warn` with the trail,
as the avatar handler does.

## 9. Tests

- Prompt builder: worn vs catalogue selection; composite cues in canonical order; hair-slot
  framing; owner with broken vault falls to catalogue; the identity block is the one the
  avatar prompt uses (import the shared function, assert same output for a fixture
  character).
- Resolver: override → designated → default; each rejected without `apiKeyId`.
- Generation: failover is called with `chatId: null` and `purpose: 'wardrobe'`; a refusal with
  an understudy reroutes and the response says so; a refusal with none returns the trail and
  writes nothing; the `files` row carries the prompt.
- Bridge: path shape `Wardrobe/images/<id>/…webp`; refuses in the job child; `emitDocumentWritten`
  fires.
- Route: 404 for an item not in the named container; 409 for an archived character;
  `set-current` refuses a foreign file; `delete-image` promotes the next-newest; upload rejects
  an 11 MB file.
- Lifecycle: delete removes links and rows; move re-links and GCs the source; copy duplicates
  under the new id.
- Frontmatter round-trip: `imageFileId` survives build → parse.
- Import modal: uploads once per created item and once for the outfit; the checkbox off →
  no uploads.
- Editor and row: inert section in create mode; thumbnail appears when current exists; menu
  item absent on borrowed rows.
- Export/import: `imageFileId` in the record and remapped on import; image file not excluded.

## 10. Docs and bookkeeping

- `help/wardrobe.md`: a new section **"Portraits of the garments"** — generate / upload / the
  history strip / why a borrowed garment is drawn on a dress form and your own on you / that
  Import from image keeps the photograph. `url` and In-Chat Navigation unchanged.
- `help/image-generation-profiles.md` (the Images tab): the *Wardrobe Images* card, with
  `help_navigate(url: "/settings?tab=images&section=wardrobe-images")` in a sub-entry if that
  file carries per-section navigation.
- `help/project-wardrobe.md`: one line — shared garments get catalogue shots.
- `docs/developer/API.md`: the images route and its four actions; `imageFileId` on the item.
- `docs/developer/DDL.md`: the frontmatter key; a note under the character-vault layout that
  `Wardrobe/images/<itemId>/` holds blobs the projection never touches.
- `public/schemas/qtap-export.schema.json`: `imageFileId`.
- `docs/CHANGELOG.md`: plain voice.
- No plugin or package changes.

## 11. Gotchas

- **Do not transcode at a call site.** `linkBlobContent` normalizes images; the bridge passes
  the WebP from `convertToWebP` through and lets the repository do the rest. (Memory:
  blob-image-normalization chokepoint.)
- **Bytes bound for a model are not these bytes.** This spec sends no image to an LLM. If a
  later feature feeds a wardrobe picture to a vision model as reference, it goes through
  `shrinkImageForLlmTransport` — the stored file stays full size.
- **The preview-avatar route bypasses the failover on purpose.** Do not copy its generation
  block; copy `character-avatar.ts`'s attempt shape and the failover call.
- **`purpose: 'wardrobe'` has no chat.** The failover's announcement and ledger arms are
  skipped on `chatId: null`; the trail is the only record, so return it and show it.
- **Never `ensureCharacterVault` on a tombstone.** The route resolves the mount through
  `resolveWardrobeMount`, which throws for an archived character; map it, do not catch and
  retry elsewhere.
- **One folder re-projection per generation** (setting `imageFileId`) is the accepted cost.
  Do not batch or defer it; the editor expects the current pointer to be durable when the
  response returns.
- **Dedup means shared blobs.** Deleting one import-linked image removes its *link*; the blob
  survives while any sibling piece still links it. `deleteWithGC` handles that; do not reach
  for `deleteMountBlob` directly.
