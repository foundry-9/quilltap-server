# Feature: The Inventory — objects a character carries, in four tiers

**Status:** Implemented 2026-10-18 in 4.11-dev (decisions in §2 settled with the operator). See §9, *As built*, for where the build departs from the text above.
**Owner subsystems:** **Pascal the Croupier owns the Inventory** — it is part of "the game", so the announcements are his, the help pages are his and the glossary row is his. The Scriptorium (the `Inventory/` folders the files live in), Prospero (the project Inventory card) and The Lantern (equipped objects reach the image pipelines) are party to it; the wardrobe is Aurora's and stays so.
**Companion design:** the wardrobe. Read [wardrobe-refactor.md](wardrobe-refactor.md) §3–4 (one location, one pool, one mutations module, one route factory), [wardrobe-folders.md](wardrobe-folders.md) (folders as the file path) and [wardrobe-item-images.md](wardrobe-item-images.md) (per-item pictures) before starting. The Inventory is built on the same shape and **does not share code with the wardrobe where the wardrobe's code is garment-specific** (slots, nudity semantics, outfit history, dressing instructions, the avatar pipeline's outfit text). Where the wardrobe's code is generic (folder path rules, the projection writer, the folder operations, the route-factory shape, the browser's file-manager layout) lift it into a shared module and have both call it rather than copying it.
**Implementation note:** This spec is written to be executed by Claude Code. Follow the CLAUDE.md standing rules throughout: changelog entry in plain voice, help docs with `url` frontmatter and an In-Chat Navigation section, debug logging on every touched backend path, `qt-*` classes not raw Tailwind (new ones mirrored into theme-storybook with a patch bump and a stop for `npm publish`), `npx tsc` not `npm run build`, routes only under `/api/v1/` through `withActionDispatch`, query keys only from `lib/query/keys.ts`, no polling, no stubs, no `TODO`, a migration with a `PRETTY_LABELS` entry. The decisions in §2 are settled. **Do not reopen them during implementation**; if one proves unworkable, stop and say so.

---

## 1. The feature in one paragraph

A character in an RPG carries things: a sword, a lantern, three potions, a signet ring that proves who they are. The Inventory gives every wardrobe tier (a character's vault, a group store, a project store, Quilltap General) an `Inventory/` folder of one-file-per-object JSON documents, browsable in a file-manager dialog exactly like the wardrobe's, filed into folders and pictured. What a character has *equipped* is **per chat**, exactly as the wardrobe's outfit is: a character arrives in a chat carrying whatever is flagged *equipped by default*, and the operator picks things up and sets them down from the Salon. A shared tier holds stock and **archetypes**: a project's "magic bow" is a class of object, and a character gets their own *instance* of it that inherits the archetype's fields and overrides the ones that make it theirs (*Excalibur* is an instance of *sword*). An archetype can be edited but not deleted while anything anywhere derives from it, unless the deletion is forced, in which case every instance is first baked into a standalone object. A **kit** names a list of objects and is equipped or unequipped as one, so a character picks up or sets down a whole loadout in a gesture. Every object carries two descriptions: one the characters read (told to the model as a trailing section of every turn while the object is equipped) and one of rendering hints that joins the character's appearance in the image pipelines while it is equipped. The Inventory is Pascal the Croupier's: it is the game's furniture, named plainly because that is what people expect. The operator does all of this from the UI; what characters may do through tools, and what Pascal may roll for, is a later spec.

## 2. Decisions of record

Settled with the operator on 2026-10-18 ("defaults on everything but what I specified"). Rows marked **(default)** were proposed by the spec author and accepted by silence; strike one here, before building, if it is wrong. Rows marked **(operator)** are the operator's own words.

| Question | Decision |
|---|---|
| Format | **One `.json` file per object** under `Inventory/`, named `<title or name>[-n].json`, identity from the `id` inside the file (never the path). Mirrors the wardrobe's `.md` items in every respect but the syntax. |
| Where "equipped" lives | **Per chat** **(operator)**, as the wardrobe's outfit is: a new `chats.equippedInventory` JSON column, `{ [characterId]: string[] }` of object ids, written only through `ChatsRepository.setEquippedInventory`. The object file carries **no** `equipped` flag. No history or rollback in v1 (the wardrobe's `chat_wardrobe_history` is not mirrored). |
| Equipped by default | **A boolean on the object, `equippedByDefault`** **(operator)**, default `false`. When a character arrives in a chat (chat start, seat added or reactivated, merge) every object they can reach that is flagged, non-archived and not an archetype is equipped for them; a flagged kit equips its members. A continuation chat copies the source chat's set instead, as the wardrobe does. Defaults apply **only at arrival**; a chat that predates the feature, or whose operator has changed things, is not revisited — a *Reset to defaults* action exists for that. Which tiers the flag is honoured in: **every tier the character can reach** (default) — a project-store object flagged by default is carried by every character in every chat of that project. |
| What may be equipped | **Any non-archetype, non-archived object the character can reach** (default): own, group, project or General. A shared object equipped by two characters is carried by both; it is a reference, not a possession. |
| `maxEquipped` | **A per-(chat, character) cap across kin** (default, the spec author's strongest assumption). Kin are reachable objects whose *resolved* `name` matches case-insensitively (two instances of "magic bow"; a standalone and its copies, which keep the name). Equipping checks `count(equipped kin) + 1 ≤ maxEquipped` of the object being equipped. There is no `quantity` field: one file is one object, and more of a thing is more files (copies or instances). |
| `canCopy` | **`false` blocks every copy path** (default): the browser's Duplicate, copy-transfers between tiers, `copy-items` into a folder. **Move and instantiate-from-archetype stay allowed** — instantiating is not copying. The baked copy produced by *detach* or a forced archetype delete is not a copy either. |
| Two descriptions | **`description`** is what characters read: the model sees it in the per-turn section while the object is equipped. **`imageDescription`** is rendering hints for the image pipelines: it joins the character's appearance (where the outfit text joins it today) while the object is equipped, and is the subject of the object's own picture generation **(operator)**. Either may be null; an object with no `description` is silent to the model and one with no `imageDescription` is not depicted. |
| Inheritance | **Sparse overrides resolved at read time** (default). An instance stores `parentId` plus only the fields it overrides; the resolved object is the archetype's fields overlaid with the instance's own (`metadata` merged shallowly, key by key). Editing an archetype changes every instance that did not override the field. **Detach** (break the relationship) bakes the resolved values into the instance and nulls `parentId`. |
| Chains | **No** (default). A parent must be an archetype (`isArchetype: true`) with `parentId: null`. An archetype cannot be equipped, cannot be a kit member's *target* at equip time (it is instantiated instead, see kits), and cannot be a kit. An instance cannot be an archetype. |
| Where a parent may live, where an instance may land | **Parent in any tier; instance in any tier** (default). The instantiate picker offers the archetypes the destination can reach (character > group > project > general, per `loadInventoryPool`); dependents are counted **instance-wide** across every mount, not just the reachable ones, as the operator asked. |
| Archived characters | **Refuse** (default). Their vaults are tombstones and cannot be written, so a forced archetype delete, and *detach all*, refuse with `409` while any dependent lives in an archived character's vault, naming the characters. The tombstone prune keeps `Inventory/` (as it keeps `Wardrobe/`) so those dependents stay countable. |
| Kits | **A kit is an object file with `kind: 'kit'` and `itemIds`** (default), in the same folder tree, like a composite. No nesting (a kit may not name a kit). A kit may name archetypes: equipping it instantiates each archetype member into the holder's own vault and equips the instance — the "starter kit in the project store" case. A kit is never itself in the equipped set; its state in a chat is derived (*all / some / none* of its resolvable members equipped). Equip is atomic: the plan is computed first, a cap breach fails the whole kit with no writes. Unequip unequips every present member and keeps the instances. |
| Prompt delivery | **One trailing per-turn section** (default), after recall and progressions and before the inform block: the equipped objects' `description`s, never in system block 1, no builder version bump. Empty is absent: nothing equipped-and-described, no section, so an unrelated turn stays byte-identical. |
| Image delivery | **Through the one appearance resolver** (default): `resolveCharacterAppearances` (`lib/image-gen/appearance-resolution.ts`) gains the equipped objects' `imageDescription`s beside the outfit text, so the avatar, the Lantern's story background and the image-scene tasks all see them without any prompt builder learning about the Inventory. |
| Ownership and name | **Pascal the Croupier owns it** **(operator)**: this is the game's furniture. The name is plainly **Inventory** **(operator)** — not a personified name — because that is the word people expect, and a system already full of strange names should not stray so far there that nobody can find how to do things. Pascal's glossary row in `CLAUDE.md` gains the Inventory; the help lives beside Pascal's. |
| Announcements and the avatar | **Mirror the wardrobe's shape, in Pascal's voice** (default): an operator's equip or unequip in a chat posts one short announcement per gesture as `systemSender: 'pascal'` with a new `systemKind: 'inventory-change'` (no `pascalMeta` roll record — the Salon's roll bubble must not try to render it) and triggers the same avatar refresh an outfit change does, through one `notifyInventoryChanged` chokepoint. Nothing is posted by a mutation outside a chat. |
| Tools and Pascal | **Out of scope** **(operator)**. No `inventory_*` tools, no Pascal effects, no Run-Tool entries in v1; [inventory-tools-and-pascal.md](inventory-tools-and-pascal.md) covers them (built 2026-10-18). Nothing in v1 may make that spec harder: equip / unequip / instantiate / detach are plain async functions a tool handler can call, and `setEquippedInventory` must be a buffered-write-capable `set*` method so the job child can call it later. Note the existing `self_inventory` tool (character transparency) — the later tool family must not be confused with it in names or docs. |
| UI home | **A sibling Inventory dialog** (default), not a tab inside the wardrobe dialog, mounted in the same three places (`app-layout.tsx` provider + dialog, the workspace `TabView` `'inventory'` tab, the Prospero project card) with a container select covering all four tiers. Equip controls and the *Carrying now* pane appear only when the dialog is opened from a chat. |
| Glyphs and where the picture shows | **The picture is for choosing, not for display** **(operator)**. It appears only where the operator picks from an array wider than what is in the bag — the instantiate picker, the kit member picker, the equip-from-pool picker, the transfer dialog — and in the object's own editor and full-screen viewer. Everywhere else (browser rows, the *Carrying now* pane, chips, kit member lists, announcements' glyphs if any) the glyph is **SVG, then emoji, then a default glyph**; never the picture. The SVG is stored inline as a string, **≤ 16 KB**, sanitised on write (no `<script>`, no event attributes, no external references), rendered as an icon not a depiction. |
| Images | Mirror `wardrobe-item-images.md`: pictures at `Inventory/images/<itemId>/`, `files` rows linked to the object, upload and generate, one current picture (`imageFileId`). Generation goes through `generateImageWithConciergeFailover` with an object-icon prompt builder whose subject is `imageDescription`, then `description`, then the name. An instance with no pictures of its own shows its archetype's, read-only. |
| Metadata | **A `metadata` object** of arbitrary JSON (default). Every other top-level key is reserved by the schema below; the parser rejects unknown top-level keys with a `warn` and drops them on re-projection, so free-form data lives under `metadata` and nowhere else. |
| Folders | **Exactly the wardrobe's rules** (`wardrobe-folders.md` §2): path is the truth, `''` is the root, ≤ 8 segments, `images` reserved at any depth, case-insensitively unique siblings, delete moves contents up, rename is a store folder move, Scriptorium is bidirectional by construction. **The folder-path helpers are lifted into a shared module** (§5.1) rather than copied. |
| Transfers between tiers | Mirror the wardrobe transfer dialog: `move` keeps the id, `copy` mints one (refused when `canCopy: false`), folder path kept, destination folder created as needed. Moving an *instance* across tiers keeps `parentId`; moving an *archetype* is allowed and its dependents are unaffected (they point at an id, not a path). An object moved out of a character's reach stays in that chat's equipped set until the next equip touches it; the resolver drops unreachable ids on read and the next write prunes them. |
| Archiving | Objects archive like wardrobe items (`archivedAt`). An archived object is dropped from every chat's resolved equipped set on read (not written out until the next equip); an archived archetype still blocks deletion by its dependents and still resolves for its instances. |
| Realtime | **No new topic.** The chat topic (`lib/realtime/topic-map.ts:72–80`) already invalidates `wardrobe.outfit(chatId)` after a turn; add `inventory.equipped(chatId)` to the same row. The browser's file reads refetch on open and after their own mutations. |

## 3. Vocabulary

- **Object** — one Inventory file. Code: `InventoryItem`. User-facing: *object* or *item*; the help docs say *item*.
- **Archetype** — an object with `isArchetype: true`; a class, never carried.
- **Instance** — an object with `parentId` set; inherits from its archetype.
- **Standalone** — an object with neither; a baked instance is standalone.
- **Kit** — an object with `kind: 'kit'`; its `itemIds` are its members.
- **Kin** — reachable objects sharing a resolved `name` (for the cap).
- **Equipped set** — the ids a character carries in one chat (`chats.equippedInventory[characterId]`).
- **Detach** — break an instance's relationship with its archetype, baking resolved values in.
- **Resolved object** — an instance with its archetype's fields filled in; what every reader outside the writer sees.

## 4. What already exists (read before building)

- **Location:** `resolveWardrobeLocation` / `WardrobeLocation` (`lib/wardrobe/location.ts:56–105`): scope enum, `readItems` / `findItem` / `create` / `update` / `updateMany` / `delete`, the folder operations, `writableMountPointId` (throws `CharacterArchivedError`), `ensure` only for writers. `locationForMount` (:121) builds one over a `WardrobeMount`; `resolveWardrobeMount` (`vault-overlay/wardrobe-writes.ts:92`) is the one tombstone-aware mount resolver and `mountWardrobeLocation` (:110) the generic mount → location step. `groupLocationsForCharacter` (:276).
- **Pool:** `loadWearablePool` (`lib/wardrobe/pool.ts:257`), `buildWearablePool` (:196), `loadSharedTiers` / `createSharedTierLoader` (:103, :125), `resolveProjectTierForChat` (:150), `componentGraph` (:332), `loadCastPools` (:352). Precedence character > group > project > general, archived dropped per tier before shadowing.
- **Per-chat state:** `chats.equippedOutfit` (`lib/schemas/chat.types.ts:1036`, JSON `{ [characterId]: slots }`), read through `lib/wardrobe/resolve-equipped.ts`, committed by `commitEquippedOutfit`. **Patch-only columns:** `ChatsRepository.patchOnlyFields()` (`chats.repository.ts:560`) lists the Concierge columns so a whole-row `update` never carries a stale copy back; `setConciergeMode` is the model for a `set*` method that is a buffered write in the job child.
- **Arrival:** `applyOutfitSelections` (`lib/wardrobe/apply-outfit-selections.ts:236`; `OutfitSelectionContext.source` is `'chat-start' | 'participant-added' | 'merge'`, :159–163; the `'previous_chat'` continuation copy, :217) is the one place a seat's starting outfit is decided. Its three call sites are where the Inventory's arrival defaults are applied too.
- **Images:** `resolveCharacterAppearances` / `equippedWardrobeItemsForAppearance` (`lib/image-gen/appearance-resolution.ts:100, 237`) is the one resolver the avatar prompt (`avatar-prompt.ts`, which calls `describeOutfit`), the Lantern and `lib/memory/cheap-llm-tasks/image-scene-tasks.ts` read appearance through — confirm each consumer goes through it before touching any prompt builder.
- **Announcements:** `notifyWardrobeChanged` / `scheduleWardrobeAnnouncement` / `refreshAvatarForOutfit` (`lib/wardrobe/outfit-change-effects.ts:86–173`), writer `lib/services/aurora-notifications/writer.ts`.
- **Writes:** `createInMount` / `updateInMount` / `updateManyInMount` / `deleteInMount` (`wardrobe-writes.ts:209–652`) read the folder, change the list in memory and re-project through `projectVaultWardrobe` (`wardrobe-sync.ts`) → `projectArrayIntoVaultFolder` (`vault-projection.ts`), serialised per mount. **`projectArrayIntoVaultFolder`'s default behaviour must not change** — it is shared with `managed-fields.ts`. The folder operations (:333–631) are generic over "a folder of item files" except for the item predicate and the parser they call.
- **Reader and predicate:** `readCharacterVaultWardrobe` (`vault-overlay/vault-readers.ts`) reads `Wardrobe/` recursively, skipping `images/` and `instructions.md`; `isWardrobeItemDocumentPath` (`vault-overlay/parsers.ts:257–267`) is the one predicate the `.qtap` export, the restore id remap (`lib/backup/restore/uuid-remap.ts:56, 83–95`) and the ledger import use. `resolveWardrobeItemId` (:238): frontmatter `id` when UUID-shaped, else path-derived.
- **Folder rules:** `lib/wardrobe/folders.ts` (client-safe, pure): `normalizeWardrobeFolderPath`, `folderOfWardrobePath`, `parentFolder`, `folderName`, `joinFolder`, `isSameFolder`, `isUnderFolder`, `WARDROBE_FOLDER_MAX_DEPTH`, `WARDROBE_RESERVED_FOLDER_SEGMENTS`. Nothing in it is garment-specific but the names.
- **Mutations:** `createItem` / `updateItem` / `setItemArchived` / `moveItemsToFolder` (`lib/wardrobe/item-mutations.ts:106–214`), `createWardrobeFolder` / `renameWardrobeFolder` / `deleteWardrobeFolder` (`folder-mutations.ts`), `archivedPatch`, `nextCopyTitle`.
- **Routes:** `lib/wardrobe/routes/wardrobe-route-factory.ts` — collection `GET` (list, `?includeArchived`, `?action=folders`, `?action=instructions`), `POST` (create, `create-folder`, `rename-folder`, `delete-folder`, `move-items`, `copy-items`); item `GET` (`?action=wear-history`), `PUT`, `DELETE`. Four route files are configs: `app/api/v1/characters/[id]/wardrobe/…`, `groups/[id]/wardrobe/…`, `projects/[id]/wardrobe/…`, `wardrobe/…` (General). Chat-side: `GET /api/v1/chats/[id]?action=outfit`, `POST ?action=equip` (`app/api/v1/chats/[id]/route.ts:13, 37`). Transfers `app/api/v1/wardrobe/transfers/route.ts`; images `app/api/v1/wardrobe/[itemId]/images/route.ts` (`generate`, `upload`, `set-current`, `delete-image`, `save-targets`, `save-to-store`).
- **Item pictures:** `lib/wardrobe/item-images.ts` (`resolveWardrobeItemHome`, `listWardrobeItemImages`, `assertItemImageChoice`, `toWardrobeImageSummary`, URL helpers), `item-image-generation.ts`, `item-image-prompt.ts`, `item-images-client.ts`.
- **Schemas:** `WardrobeItemSchema`, `wardrobeItemFieldsSchema`, `createWardrobeSchema`, `updateWardrobeSchema`, the folder body schemas (`lib/schemas/wardrobe.types.ts`).
- **Prompt sections:** `buildProgressionsSection` is called from `lib/chat/context-manager.ts:2163`, `lib/chat/initialize.ts:222` and `lib/services/carina/carina.service.ts:586`; `buildInformBlock` from `context-manager.ts:1657`. The Inventory section is appended at the same three sites, between the two.
- **UI:** `components/wardrobe/wardrobe-control-dialog.tsx` (`WardrobeControlDialog`, `WardrobeView`), `WardrobeBrowser.tsx`, `wardrobe-item-row.tsx`, `wardrobe-item-editor.tsx`, `WardrobeFolderPickerDialog.tsx`, `WardrobeTransferDialog.tsx`, `wardrobe-item-thumbnail.tsx`, `wardrobe-image-viewer.tsx`, hooks `useWardrobeListData` / `useWardrobeItemActions`; provider `components/providers/wardrobe-dialog-provider.tsx`; mounts `components/layout/app-layout.tsx:22–23, 126–137`, `components/workspace/TabView.tsx:41, 113–114`, `app/prospero/[id]/components/WardrobeCard.tsx`.
- **Query keys:** `queryKeys.wardrobe.*` (`lib/query/keys.ts`: `all` / `lists` / `list(tierKey, …)` / `folderLists` / `folders(...)` / `outfit(chatId)`).
- **Export and restore of the chat column:** `public/schemas/qtap-export.schema.json:599` (`equippedOutfit`), `lib/backup/restore/archive.ts:147–182` (shape upgrade on restore), the id remap in `uuid-remap.ts`.
- **Tombstones:** `lib/characters/archive-service.ts:124–138` keeps everything under `Wardrobe/` when pruning an archived character's vault.
- **Help:** `help/wardrobe.md` (`url: /aurora`), `help/project-wardrobe.md` (`url: /prospero/:id`), `help/wardrobe-images.md`; command list `.claude/commands/update-documentation.md`.

## 5. Design

### 5.1 Shared folder rules (refactor first)

Move the pure path helpers out of `lib/wardrobe/folders.ts` into `lib/mount-index/item-folders.ts` (client-safe, pure), parameterised by the root folder name and the reserved segments:

```ts
export interface ItemFolderRules { root: string; reserved: readonly string[]; maxDepth: number }
export function normalizeItemFolderPath(rules, input): string;      // throws ItemFolderPathError
export function folderOfItemPath(rules, relativePath): string;
export function isItemDocumentPath(rules, relativePath, ext, skipFileName?): boolean;
export const parentFolder, folderName, joinFolder, isSameFolder, isUnderFolder;
```

`lib/wardrobe/folders.ts` keeps its exports as one-line delegates over `WARDROBE_FOLDER_RULES` so no wardrobe caller changes; `lib/inventory/folders.ts` does the same over `INVENTORY_FOLDER_RULES = { root: 'Inventory', reserved: ['images'], maxDepth: 8 }`. `isWardrobeItemDocumentPath` becomes a delegate too. The wardrobe tests must pass unchanged.

### 5.2 The model

```ts
// lib/schemas/inventory.types.ts
export const INVENTORY_FOLDER = 'Inventory';                         // also in lib/mount-index/character-vault.ts beside CHARACTER_WARDROBE_FOLDER
export const InventoryKindSchema = z.enum(['item', 'kit']);
export const INVENTORY_SVG_MAX_BYTES = 16 * 1024;

export const InventoryItemSchema = z.object({
  id: UUIDSchema,
  kind: InventoryKindSchema.default('item'),
  name: z.string().min(1).max(200),                                  // official name
  title: z.string().max(200).nullable().optional(),                  // "Excalibur"
  description: z.string().max(4000).nullable().optional(),           // what characters read, while equipped
  imageDescription: z.string().max(2000).nullable().optional(),      // rendering hints for the image pipelines
  equippedByDefault: z.boolean().default(false),
  maxEquipped: z.number().int().min(1).max(999).default(1),
  canCopy: z.boolean().default(false),
  isArchetype: z.boolean().default(false),
  parentId: UUIDSchema.nullable().default(null),
  itemIds: z.array(UUIDSchema).max(200).default([]),                 // kits only; [] otherwise
  emoji: z.string().max(16).nullable().optional(),                   // emoji or short code
  svg: z.string().max(INVENTORY_SVG_MAX_BYTES).nullable().optional(),// sanitised on write
  imageFileId: UUIDSchema.nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  folder: InventoryFolderPathSchema.default(''),                     // derived from path, never stored
  archivedAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();

/** `chats.equippedInventory`: object ids carried per character in this chat. */
export const EquippedInventorySchema = z.record(UUIDSchema, z.array(UUIDSchema));
```

Refinements (`.superRefine`, applied by the parser and the create/update schemas): an archetype has `parentId: null` and `kind: 'item'`; a kit has `isArchetype: false`, `parentId: null`, non-empty `itemIds`; an `item` has `itemIds: []`.

**The stored file** is the schema minus `folder` (path) and, for an instance, minus every field it does not override: `InventoryItemFileSchema = InventoryItemSchema.omit({ folder: true }).partial().required({ id: true, createdAt: true, updatedAt: true })`. On read, the parser validates the file, derives `folder` from the path, and hands an **unresolved** item to the pool; resolution (§5.4) fills an instance in. A file whose `id` is not UUID-shaped or whose JSON does not parse is logged at `warn` and skipped — never deleted by a projection (`isInventoryItemDocument` must return false for it, as `isWardrobeItemDocument` does for a note).

Body schemas: `inventoryItemFieldsSchema` (everything but `id`, timestamps, `archivedAt`, `imageFileId`), `createInventorySchema`, `updateInventorySchema = fields.partial().extend({ archived, imageFileId })`. An instance's PUT with a field set to `null` where the schema allows null stores an explicit null (overriding the archetype with "none"); a field *omitted* from an instance's stored file inherits. The editor therefore needs a per-field *Inherit* affordance for instances (§5.9); the route needs `?action=clear-override` with `{ fields: string[] }` to remove keys from the stored file, since a JSON PUT cannot express "remove".

**The chat column.** Migration `add-chat-equipped-inventory-v1`: `ALTER TABLE chats ADD COLUMN equippedInventory TEXT` (JSON, nullable), with a `PRETTY_LABELS` entry; no loop, no progress call. `ChatSchema` and the chat metadata schema gain `equippedInventory: JsonSchema.nullable().optional()` beside `equippedOutfit`; `DDL.md` gains the column; `qtap-export.schema.json` gains it beside `equippedOutfit`. **It is a patch-only column** (`patchOnlyFields()`), and `ChatsRepository.setEquippedInventory(chatId, characterId, ids)` is the one writer: it reads the row, replaces that character's list (deduplicated, sorted for stable hashing) and patches the column alone. In the job child it is a buffered write (`set*` prefix), replayed in the parent — not called from the child in v1, but shaped for the tools spec.

### 5.3 Reading and writing files

`lib/database/repositories/vault-overlay/inventory-readers.ts` / `inventory-writes.ts`, mirroring the wardrobe pair:

- `readMountInventory(mount, { includeArchived })` — `docMountDocuments.findManyByMountPointsInFolder([mp], 'Inventory', '.json', { recursive: true })`, skipping `images/` at the first segment; parse each with `parseInventoryItemFile`; `folder = folderOfItemPath(INVENTORY_FOLDER_RULES, relativePath)`.
- `isInventoryItemDocumentPath` (the delegate from §5.1) and `isInventoryItemDocument` (path plus a parseable JSON `id`) are the **one predicate pair** for the export, the restore remap and the projection sweep.
- Writes re-project the folder through `projectArrayIntoVaultFolder` with a JSON serialiser (`JSON.stringify(file, null, 2) + '\n'`) and a `.json` extension — add an `ext` / `serialize` option to the projector with defaults that keep the wardrobe's behaviour byte-identical. File name is `sanitizeFileName(title ?? name)` with the wardrobe's `-n` collision rule. Serialised per mount with the same `runSerialized`.
- The folder operations (`listFolders`, `createFolder`, `renameFolder`, `deleteFolder`) are **generalised** in `wardrobe-writes.ts` over a `{ root, predicate, read, project }` descriptor and called by both; do not copy 300 lines.
- `resolveInventoryMount(scope, id)` is `resolveWardrobeMount` with the folder constant swapped — generalise `resolveWardrobeMount` into `resolveVaultFolderMount(folder, scope, id)` and keep both names as delegates. The tombstone throw stays.

### 5.4 Location, pool and resolution

`lib/inventory/location.ts`: `InventoryScopeSchema` (same four values), `InventoryLocation` with the same surface as `WardrobeLocation` (`readItems`, `findItem`, `create`, `update`, `updateMany`, `delete`, the folder ops, `resolveFolder`, `writableMountPointId`), `resolveInventoryLocation(scope, id, repos, userId, { ensure })`, `locationKey`, `groupLocationsForCharacter`.

`lib/inventory/pool.ts`: `loadInventoryPool({ characterId, chatId? | projectId? })` → `InventoryPool { byId: Map<string, InventoryItemWithOrigin>; own; tiers; owns(id) }`, one read per tier, precedence character > group > project > general, archived dropped per tier before shadowing (`includeArchived` option as the wardrobe has). `loadCastInventoryPools(chat)` for the chat-side reads. Every lookup outside the writer is a walk over the pool.

`lib/inventory/resolve.ts` (pure, client-safe): `resolveItem(item, pool): ResolvedInventoryItem` — a standalone or archetype resolves to itself; an instance resolves to `{ ...parent fields, ...instance's stored fields, metadata: { ...parent.metadata, ...instance.metadata }, id, parentId, folder, archivedAt, timestamps: instance's }`, with `isArchetype: false`, `kind: 'item'`, `itemIds: []`. **`imageFileId` and the picture list fall through** when the instance has none of its own. A missing parent (deleted out from under it, or in a tier this pool cannot see) resolves to the instance's own fields with `parentMissing: true`, logged at `warn` once per read. `resolvedPool(pool)` maps the whole pool. `kinOf(name, pool)`.

`lib/inventory/equipped-set.ts` (pure): `readEquippedSet(chat, characterId, pool): ResolvedInventoryItem[]` — the column's ids for that character, dropping any that are missing from the pool, archived or archetypes (each dropped id logged at `debug`); `kitState(kit, equippedIds)`: `'all' | 'some' | 'none'`.

`lib/inventory/dependents.ts` (server): `findDependents(archetypeId): Promise<Dependent[]>` — one `docMountDocuments` query for every `Inventory/**/*.json` across **all** mounts (not a pool), parse, filter `parentId === archetypeId`, tag each with its mount, scope, owner and whether the owner is an archived character. Used by the delete guard, `?action=dependents`, and `detachAll`. Deletion is rare; there is no dependency table.

### 5.5 Mutations

`lib/inventory/item-mutations.ts` — the only file writers besides the image route and transfers:

- `createItem(location, fields, { folder? })`: validates the refinements; a kit's `itemIds` must each resolve in the writer's pool (§5.4) to an item or an archetype, never a kit (no nesting); `svg` sanitised (`sanitizeInventorySvg`, `lib/inventory/svg.ts`: parse, drop `script`, `foreignObject`, `on*` attributes, `href`/`xlink:href` not starting `#`, `<use>` of external, `style` with `url(`; reject over size).
- `instantiate(location, archetypeId, { folder?, overrides? })`: the archetype must be an archetype and reachable from the destination's pool; writes `{ id: newUuid, parentId: archetypeId, kind: 'item', isArchetype: false, ...overrides }`. Returns the resolved instance.
- `updateItem(location, id, patch)`: an instance stores only the patched keys; `clearOverrides(location, id, fields)` removes keys. Changing `isArchetype` on an item with dependents, or setting it on an instance or a kit, is refused (`409`).
- `detach(location, id)`: bakes `resolveItem` into the file, `parentId: null`. `detachAll(archetypeId)`: `findDependents`, refuse if any is in an archived character's vault (`InventoryArchivedDependentsError`, `409` listing the characters), else detach each through its own location (one write per mount, `updateMany`).
- `deleteItem(location, id, { force })`: an archetype with dependents and no `force` → `InventoryArchetypeInUseError` (`409`, with `dependents` count and holders); with `force` → `detachAll` then delete; a deleted kit member is dropped from every kit in the same tier that named it (same read, same projection) and silently skipped elsewhere at equip time. Pictures are removed with the file as the wardrobe does. Chats' equipped sets are **not** scrubbed on delete; `readEquippedSet` drops the id and the next equip write prunes it.
- `setItemArchived(location, id, archived)`: `archivedPatch`.
- `moveItemsToFolder`, `copyItemsToFolder` (the latter refuses `canCopy: false` items with `InventoryNotCopyableError`, `409`), `duplicateItem` (same refusal; `nextCopyTitle`), the folder trio.

Every mutation logs at `debug` with scope, mount, id and the operation; refusals at `info`.

### 5.6 Equip, unequip and arrival (the chokepoints tools will call later)

`lib/inventory/equip.ts`: `equipItems(chat, characterId, ids, ctx)` and `unequipItems(chat, characterId, ids, ctx)`, where `ctx: InventoryChangeContext = { provenance: 'operator', announce: boolean }` (the tools spec adds `'character'` and `'pascal'`). The character must be a participant of the chat (`400` otherwise).

Plan, then write — any vault `instantiate` writes first, then one `setEquippedInventory`:

1. Load `loadInventoryPool({ characterId, chatId })`, the resolved pool, and the current equipped set.
2. Expand kits: each member that is an archetype becomes an `instantiate` into the character's vault root (or the kit's folder when the kit is in the character tier); each member that is an item is itself; a member that does not resolve is skipped and reported in the result's `skipped[]` with a reason (`missing`, `archived`, `is_kit`).
3. For each object to equip (deduplicated, already-equipped ones dropped and reported as `alreadyEquipped[]`): archetypes and archived objects are refused (`409`); the cap `count(equipped kin) + planned kin + 1 ≤ resolved.maxEquipped` or the whole call fails with `InventoryCapExceededError` (`409`, naming the object and the cap) and nothing is written, instantiations included.
4. Write, then `notifyInventoryChanged(chat, characterId, { equipped, unequipped }, ctx)`. Return `{ equipped: ResolvedInventoryItem[], created: ResolvedInventoryItem[], skipped, alreadyEquipped }`.

Unequip never fails on state: ids already absent are reported, not refused; kit members are expanded to the instances present.

`lib/inventory/equip-effects.ts`: `notifyInventoryChanged` posts one Pascal announcement per call when `ctx.announce` — `systemSender: 'pascal'`, `systemKind: 'inventory-change'`, no `pascalMeta`; add the kind to the `systemKind` enum and teach the Salon's Pascal bubble to render it as a plain line (copy in Pascal's croupier voice: *"Vivienne takes up Excalibur and a signet ring."* / *"… sets down the lantern."*) — and calls the wardrobe's avatar refresh (`refreshAvatarForOutfit`, generalised to take "appearance changed" rather than an outfit) so a newly carried sword can reach the portrait. Outside a chat there is no call.

`lib/inventory/apply-defaults.ts`: `applyInventoryDefaults(chat, characterIds, { source })` — called beside `applyOutfitSelections` at each of its three call sites with the same `source`. For `'previous_chat'` continuations it copies the source chat's list for each character (ids only; the resolver drops what no longer resolves). Otherwise, for each character **with no entry yet** in the column, it equips every reachable, non-archived, non-archetype object with `equippedByDefault: true`, kits expanded as in step 2, through `equipItems` with `announce: false` (arrival is not a gesture) and the cap honoured (a breach at arrival drops the offending object with a `warn`, never fails the arrival). `resetInventoryToDefaults(chat, characterId)` clears the entry and re-applies.

### 5.7 Prompt and image delivery

`lib/inventory/prompt-section.ts`: `buildInventorySection({ chat, characterId, repos }): Promise<string | null>`. Reads the equipped set, keeps objects with a `description` (kits never appear; their members do), sorts by `title ?? name`, and renders:

```
## Carried and equipped
- Excalibur (sword): A longsword whose blade is never dulled…
- Signet ring: Proves the bearer is of House Vane.
```

Title first with the name in parentheses when both exist and differ; the name alone otherwise. Returns `null` when nothing qualifies. Appended at the three `buildProgressionsSection` call sites, directly after the progressions section and before the inform block. It must never enter system block 1 and bumps no builder version. One test asserts a turn with no equipped-and-described object produces a byte-identical context.

`lib/inventory/image-description.ts`: `describeEquippedInventoryForImages(chat, characterId, pool): string | null` — the equipped objects' `imageDescription`s as a comma-joined noun-phrase list ("carrying a longsword with a jewelled pommel, a brass signet ring on the left hand"). `resolveCharacterAppearances` (`appearance-resolution.ts`) appends it to each character's resolved appearance beside the outfit text; **no prompt builder reads the Inventory directly.** A test asserts the avatar prompt, the Lantern prompt and the image-scene task all carry the phrase after one equip, and nothing when `imageDescription` is null.

### 5.8 Routes

`lib/inventory/routes/inventory-route-factory.ts`, four config files, plus two standalone routes and three chat actions. Add every route to `docs/developer/API.md`.

| Route | Verb | Actions |
|---|---|---|
| `/api/v1/characters/[id]/inventory`, `/groups/[id]/inventory`, `/projects/[id]/inventory`, `/inventory` (General) | `GET` | list (`?includeArchived`, resolved); `?action=folders`; `?action=archetypes` (archetypes reachable from this tier, for the instantiate picker) |
| same | `POST` | create; `?action=instantiate` `{ archetypeId, folder?, overrides? }`; `create-folder`, `rename-folder`, `delete-folder`, `move-items`, `copy-items` |
| `…/inventory/[itemId]` | `GET` | one resolved object; `?action=dependents` (archetypes) |
| | `PUT` | `updateInventorySchema` (`archived` → `setItemArchived`); `?action=clear-override` `{ fields }`; `?action=detach` |
| | `DELETE` | `?force=true` to bake and delete an archetype with dependents |
| `/api/v1/chats/[id]` | `GET` | `?action=inventory` → `{ [characterId]: { equipped: ResolvedInventoryItem[], kits: { [kitId]: 'all' \| 'some' \| 'none' } } }` for every participant |
| | `POST` | `?action=inventory-equip` / `inventory-unequip` `{ characterId, ids }`; `?action=inventory-reset-defaults` `{ characterId }` |
| `/api/v1/inventory/transfers` | `POST` | `{ action: 'move' \| 'copy', itemId, from: { scope, id }, to: { scope, id } }` |
| `/api/v1/inventory/[itemId]/images` | `GET` / `POST` | `generate`, `upload`, `set-current`, `delete-image`, `save-targets`, `save-to-store` — a config over the wardrobe image route's steps with an object prompt builder |

All through `withActionDispatch`; unknown action → `400`; refusals from §5.5–5.6 map to `409` with a `code` (`ARCHETYPE_IN_USE`, `ARCHIVED_DEPENDENTS`, `NOT_COPYABLE`, `CAP_EXCEEDED`, `INVALID_PARENT`, `KIT_NESTING`, `NOT_EQUIPPABLE`). The character routes answer `CharacterArchivedError` as the wardrobe routes do.

### 5.9 UI

`components/inventory/`, a sibling of `components/wardrobe/` with the same file-manager layout: `inventory-control-dialog.tsx` (`InventoryControlDialog`, `InventoryView`; container select over the four tiers; when opened from a chat, a right-hand *Carrying now* pane per cast member with unequip buttons, kit rows with their all/some/none state, and *Reset to defaults*), `InventoryBrowser.tsx` (breadcrumb, subfolders, tier rows in a character container, search across folders, filters *Items / Kits / Archetypes*, *Equipped only* (chat context), *Show archived*, *Show shared*, select mode with *Move to folder…*), `inventory-item-row.tsx` (SVG → emoji → default glyph per §2, never the picture; title and name, chips: *Archetype*, *Instance of X*, *Kit · all/some/none*, *Equipped*, *Default*; ⋮ menu: Edit, Equip / Unequip (chat context, hidden for archetypes), Instantiate (archetypes, with a destination picker), Detach (instances, with the warning dialog), Duplicate (hidden when `canCopy: false`), Move to folder, Move / Copy to tier, Archive / Restore, Delete), `inventory-item-editor.tsx` (fields of §5.2 including both descriptions with their hint copy — *what the characters know about it* / *how it should be drawn*; for an instance every inheritable field shows the archetype's value greyed with an *Inherit* toggle, `clear-override` on save; the kit editor is a member picker over the pool, with pictures, archetypes allowed and kits excluded; the instantiate, equip-from-pool and transfer pickers show pictures the same way; SVG textarea with live preview and a size counter; emoji field), `InventoryTransferDialog.tsx`, `inventory-image-viewer.tsx`, the folder picker reused from the wardrobe by generalising `WardrobeFolderPickerDialog` over a folder-list query key. Hooks `useInventoryListData`, `useInventoryItemActions`, `useChatInventory(chatId)`. Provider `components/providers/inventory-dialog-provider.tsx`; mounts beside the wardrobe's in `app-layout.tsx` and `TabView.tsx` (`'inventory'` tab, `InventoryTabPayload`); `app/prospero/[id]/components/InventoryCard.tsx`; a Salon entry point beside the wardrobe's.

Dialogs that warn: **Detach** ("This object will stop following *Magic bow*. Its current values are kept; later edits to the archetype will not reach it."), **Delete archetype in use** (count and the holders by name; a *Detach all and delete* button; disabled with the archived-character list when §2's refusal applies), **Equip** on a cap breach (which object and which cap).

Where the wardrobe browser's components are generic (breadcrumb, folder rows, select bar, tier rows) lift them into `components/item-browser/` and have both use them; where they are garment-specific (slot chips, outfit composer) leave them. New `qt-*` classes (chips, the glyph tile) are mirrored into theme-storybook with a patch bump; stop for `npm publish`.

### 5.10 Query keys, realtime

`queryKeys.inventory`: `all`, `lists`, `list(tierKey, { includeArchived })`, `folderLists`, `folders(tierKey)`, `item(id)`, `archetypes(tierKey)`, `dependents(id)`, `images(id)`, `equipped(chatId)`. File mutations invalidate `lists`, `folderLists` and the touched `item` / `dependents`; equip and unequip invalidate `equipped(chatId)`. Add `queryKeys.inventory.equipped(id)` to the chat topic's row in `lib/realtime/topic-map.ts` beside `wardrobe.outfit(id)`; no new `REALTIME_TOPICS` row.

### 5.11 Export, backup, restore, tombstones

- `.qtap` exports and backups carry `Inventory/**` as ordinary store documents and `files` rows — nothing to add to the writer, nothing to exclude. The chat row's `equippedInventory` rides with the chat; add it to `qtap-export.schema.json` beside `equippedOutfit`. Check the schema for a file-link kind enum; if one exists, add the inventory link kind.
- **Restore in new-account mode** remaps ids: extend `lib/backup/restore/uuid-remap.ts` with `isInventoryItemDocumentPath` → remap the file's `id`, `parentId`, `itemIds[]`, `imageFileId` and the `files` link, and every id inside `chats.equippedInventory`, mirroring the wardrobe remap. A test restores a bundle with an archetype, an instance, a kit and a chat carrying the instance, and asserts all four still point at each other.
- `lib/characters/archive-service.ts` keeps `Inventory/` on prune (beside `Wardrobe/`), so `findDependents` can still see an archived character's instances. Rehydrate needs nothing.
- `reconcileStoreNames` and the mount-point namespace are untouched. One migration (§5.2), `DDL.md` updated, no new table.

### 5.12 Logging

Every reader and writer in `lib/inventory/` and the two vault-overlay modules logs at `debug` with `{ scope, mountPointId, itemId, folder, op }`; equip and arrival log `{ chatId, characterId, equipped, created, skipped }`; refusals at `info` with the code; a skipped unparseable file, a missing parent and an arrival cap breach at `warn`.

## 6. Out of scope (v1)

- `inventory_*` tools, Run-Tool entries, Pascal effects and the Workbench picker — follow-up spec.
- Equipped history and rollback.
- A `quantity` / stack count.
- Archetype chains, kit nesting.
- Drag-and-drop in the browser.
- Transferring an object from one character to another inside a chat (the "give" gesture) — belongs with the tools spec.
- Revisiting existing chats when an object's `equippedByDefault` changes (the *Reset to defaults* action covers it by hand).

## 7. Phases

Each ends with `npx tsc`, the suites named, and a dev-server walkthrough of the surfaces named. Ship one at a time.

- **A. Shared rules.** §5.1 and the generalisations in §5.3 (`projectArrayIntoVaultFolder` options, folder-op descriptor, `resolveVaultFolderMount`). Wardrobe suites pass unchanged.
- **B. Model, files, column.** §5.2 schemas and refinements, `lib/inventory/svg.ts`, readers and writers, the predicate pair, `INVENTORY_FOLDER` in `character-vault.ts`, the migration and `setEquippedInventory`, tombstone prune. Tests: parser round-trip, refinements, SVG sanitiser, predicate, migration, patch-only fence (a whole-row `update` cannot change the column).
- **C. Location, pool, resolution, mutations.** §5.4–5.5. Tests: resolution (overrides, metadata merge, picture fall-through, missing parent), detach and forced delete, archived-dependent refusal, `canCopy` refusals.
- **D. Equip, arrival, effects.** §5.6. Tests: kin cap per chat, kit equip atomicity and archetype-member instantiation, unequip of kits, arrival defaults for each `source` and the continuation copy, cap breach at arrival, one announcement per gesture and none at arrival.
- **E. Prompt and images.** §5.7 at the three call sites and in the appearance resolver. Tests: rendering, empty-is-absent byte identity, kits excluded, the three image consumers.
- **F. Routes.** §5.8, `API.md`. Tests: action dispatch, every `409` code, `?force`, transfers, the chat actions.
- **G. UI.** §5.9–5.10. Component tests for the browser's filters, the instance editor's inherit toggle, the warning dialogs, the *Carrying now* pane.
- **H. Export and restore.** §5.11. Tests named there.
- **I. Docs.** `help/inventory.md` (`url: /salon`, Pascal's voice, filed beside `help/pascals-workbench.md`: objects, the two descriptions, archetypes and instances, kits, equipped by default, folders, pictures, what the model and the Lantern are told), `help/project-inventory.md` (`url: /prospero/:id`), a General section mirroring the wardrobe's General help, each with In-Chat Navigation; `docs/CHANGELOG.md` (plain voice); ROADMAP row; add the help files to `.claude/commands/update-documentation.md`; add the Inventory to Pascal's row in the `CLAUDE.md` glossary and to the `pascal` sender's responsibilities there; move this file to `features/complete/` with an *As built* section.

## 8. Acceptance

- A project archetype *Magic bow* instantiated into two characters: editing the archetype's description changes both; overriding one's title to *Heartseeker* leaves the other; deleting the archetype is refused with "2 objects derive from it"; forced, both become standalone with the baked description and the archetype is gone.
- A character with `maxEquipped: 2` rings and three ring instances can equip two in one chat; the third is refused naming the cap; in a second chat all three are again available and two can be equipped.
- A project kit *Ranger's loadout* naming an archetype and two project objects, equipped from the Salon: one instance appears in the character's vault and three objects are equipped in that chat; one Pascal announcement is posted; unequipping leaves the three in the inventory and the kit row reads *none*.
- A signet ring flagged *equipped by default*: a new chat with the character starts with it carried and no announcement; a continuation chat copies the source chat's set instead; *Reset to defaults* restores it after the operator set it down.
- `canCopy: false` on the signet ring: Duplicate is absent, copy-transfer answers `409`, move works.
- A turn with an equipped sword that has a `description` carries the trailing section; a sword with only an `imageDescription` adds nothing to the model's context and does add its phrase to the avatar prompt; setting the sword down removes both and the next turn's context is byte-identical to one with no inventory.
- An archived character holding an instance blocks a forced delete of its archetype with the character's name.
- A `.json` dropped into `Inventory/Weapons/` in the Scriptorium appears in the *Weapons* folder of the browser on reopen; a note dropped there is ignored and survives the next write.

## 9. As built

Shipped in phases A–I on branch `claude/bold-lamport-temetc` (4.11.0-dev.21 → dev.30). The design above stands; these are the places the build differs from it, or settles something it left open.

- **Shared folder code.** `lib/mount-index/item-folders.ts` (`ItemFolderRules`) holds the pure path rules and `vault-overlay/item-folder-ops.ts` the folder operations, the per-mount write chain (`runSerialized`, keyed `${root}:${mountPointId}`) and `resolveVaultFolderMount`. The wardrobe's modules are now delegates over them. `resolveVaultFolderMount` takes only a `characterId` (null for General); the shared tiers are addressed by mount.
- **Stored files are sparse throughout.** `InventoryItemFileSchema` is built with `patchSchemaOf` (Zod 4's `.partial()` re-applies defaults, bug 244), not the `.omit().partial()` the text shows. A record carries a transient `fileStem` beside `folder` so an instance with no title or name of its own keeps its file name on re-projection.
- **Archetypes outside the pool's tiers.** The pool resolves an instance against an archetype on any shelf in the instance (`findRecordsAnywhere`), not only the shelves the character can reach, because §2 lets an instance and its parent live anywhere. An archetype that is gone resolves the instance with `parentMissing: true` and its own fields.
- **Kits.** Equipping a kit reuses an uncarried instance of an archetype member that the character already owns before minting another. Deleting an object drops it from the kits that name it, except where it is a kit's last member: a kit may not be empty, so that member stays named and is skipped at equip time.
- **The greeting.** The Inventory section reaches the greeting from `autoGenerateFirstMessage` (in `app/api/v1/chats/route.ts`), not from `initialize.ts`: `buildChatContext` runs there before the chat row exists, and the carried set is per chat. It rides the greeting's user turn as a trailing section (`trailingContextSections`), never the system prompt, as on every later turn.
- **The avatar.** The avatar prompt is not built through `resolveCharacterAppearances`, so the avatar job reads the carrying phrase itself (`loadCarryingPhrase`) and passes it to `buildCharacterAvatarPrompt` as the `carrying` option. The Lantern and the image tool go through the resolver as designed (`carryingDescription`, rendered by `sceneDescriptionParts` and as a *Carried* clothing entry in prompt expansion). `refreshAvatarForAppearance` is the shared refresh; `refreshAvatarForOutfit` remains as an alias.
- **Routes.** The factory has a `duplicate` collection action besides the ones §5.8 lists. Picture generation uses `purpose: 'dialog'` with a new LLM log type `INVENTORY_ITEM_IMAGE`. The chat `GET ?action=inventory` also returns the chat's `projectId` so the dialog can show the project shelf.
- **Kits across transfers.** A kit sent to another tier must reach its members from there (`INVALID_SHAPE`), and moving an object some kit names to a tier that kit cannot reach is refused (`KIT_STRANDED`, a code the spec did not list).
- **Duplicate ids.** When two files claim one id, the one at the object's own name wins, and the others are left alone by every projection (never swept, never written over).
- **The project roster gate.** Not applied in v1, where every caller is the operator. Settled with the operator on 2026-10-18 when the tools landed: the roster gates the project's shelf exactly as it gates the project wardrobe. See `lib/inventory/roster-gate.ts` and the *As built* section of [inventory-tools-and-pascal.md](inventory-tools-and-pascal.md).
- **UI.** No new `qt-*` classes: the rows reuse the existing badge family, so there was no theme-storybook mirror or publish. The browser's generic pieces were lifted from the wardrobe into `components/item-browser/` and both browsers use them.
- **Restore.** A new-account restore re-keys `chats.equippedInventory` to the remapped character ids, keeps object ids verbatim (they live in the files), keeps picture `files` rows linked to their object, and repoints each object's `imageFileId` after the vaults land (`planInventoryImagePointerFixes`, step 22f-quater). The chat column is written by `chats.create` (patch-only fields are skipped only on `update`). Noticed in passing: the same restore does not re-key `chats.equippedOutfit`, which is keyed the same way; that is the wardrobe's and was left alone.
- **Tests.** `__tests__/unit/lib/inventory/` (files, svg, resolve, item-mutations, equip, delivery, routes) over an in-memory store (`__tests__/helpers/inventory-fake-store.ts`); the migration; `appearance-carrying.test.ts`; `inventory-ui.test.tsx`; `inventory-backup.test.ts`; and the additions to the patch-only, archive-prune, merge, context-management, topic-map and LLM-log suites.

