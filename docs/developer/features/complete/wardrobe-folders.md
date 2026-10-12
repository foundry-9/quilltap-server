# Feature: Wardrobe folders — categorising a closet without changing what it holds

**Status:** Approved 2026-10-12; built 2026-10-12 (see [As built](#7-as-built)).
**Owner subsystems:** Aurora (the wardrobe), The Scriptorium (the `Wardrobe/` folders the files live in), Prospero (the project Wardrobe card).
**Companion spec:** [scenarios-from-anywhere.md](../scenarios-from-anywhere.md) was written the same day and shares nothing but the author; build them in either order.
**Implementation note:** This spec is written to be executed by Claude Code. Follow the CLAUDE.md standing rules throughout, and the wardrobe chokepoints in particular: one location (`resolveWardrobeLocation`), one pool (`loadWearablePool`), writes only through `item-mutations.ts`, routes only through the route factory, never an `ownerCharacterId` hint, never a scope switch to pick a writer. Changelog entry, help docs with `url` + In-Chat Navigation, debug logging on every touched backend path, `qt-*` classes not raw Tailwind, `npx tsc` not `npm run build`, the tool snapshot test re-recorded with `npx jest -u`. The decisions in §2 were settled with the operator before this spec was written. **Do not reopen them.**

---

## 1. The feature in one paragraph

A wardrobe tier (a character's vault, a group store, a project store, Quilltap General) is today one flat `Wardrobe/` folder of one-file-per-item Markdown. This feature lets the user file items and outfits into folders — *Formal*, *Formal/Evening*, *Rainy days* — purely to organise and filter what they see. Nothing about what a character can wear changes: every item in every folder is in the pool exactly as before, outfits may be composed of items from any folders, and the tools see folders only as a label. The browser becomes a small file manager: a breadcrumb, subfolders first, then the items in the folder you are in; search spans every folder. A **Move to folder…** action (single, or several at once in a select mode) and a folder field in the item editor do the filing. The folder tree is the real folder tree under `Wardrobe/` in the store, so what you see in the wardrobe is what you see in the Scriptorium, and a file moved there moves here.

## 2. Decisions of record

| Question | Decision |
|---|---|
| Navigation | **File-manager style.** A breadcrumb (`Wardrobe › Formal › Evening`), one folder at a time: subfolders listed first, then the folder's items. Search always spans all folders and shows each hit's folder path; the existing kind / slot / sort / archived / never-worn filters apply within whatever is listed. |
| Merged character view | **Tier first, then folders.** The root of a character's container is the character's *own* closet (its subfolders and root items). Each shared tier that has items appears as one special row after the own subfolders — *Group: Regulars*, *Project: Blackwood*, *General* — with a tier chip; entering one shows that tier's root and its own folder tree. Folders are never merged across tiers. **Show shared** hides the tier rows. |
| Moving | **Menu picker plus multi-select bulk move.** `⋮ → Move to folder…` opens a folder-tree picker with **New folder…** inline. A **Select** toggle adds checkboxes to manageable item rows and a sticky bar with *N selected · Move to folder… · Cancel*. **No drag-and-drop** in this version. |
| Tools | **Read-only.** `wardrobe_list` and `wardrobe_read` results gain `folder`; no tool input gains one. `wardrobe_create` files new items at the root. |
| Source of truth | **The file's path, nothing else.** `WardrobeItem.folder` is derived from `relativePath` on read and written back as the path on projection. It is **not** written to frontmatter. There is no folder table, no folder metadata file; empty folders are `doc_mount_folders` rows, which already persist. |
| Depth and names | Nesting is unbounded in principle, capped at **8 segments**. A segment is sanitised with the item-file rule (`sanitizeFileName`: `\/:*?"<>|` → `_`, ≤ 100 chars), may not be `.`, `..` or empty, and may not be **`images`** at any depth (`Wardrobe/images/<itemId>/` holds pictures). Folder names are **case-insensitively unique** among siblings; creating *formal* beside *Formal* resolves to the existing one. |
| Outfits (composites) | A composite lives in a folder like any item; its components may be anywhere. Moving a composite moves only the composite. Nothing is ever pulled along. |
| Transfers between tiers | An item **keeps its folder path** when moved or copied to another tier; the destination folder is created as needed. The transfer dialog gains no folder control. |
| Deleting a folder | Allowed when non-empty: its items (and subfolders) move **up to the parent**, then the folder row is removed. A confirm dialog states the count. Nothing is ever deleted but the folder row. |
| Renaming a folder | `moveDatabaseFolder` on the store; the items' `folder` follows because the path is the truth. Siblings' case-insensitive uniqueness applies. |
| Scriptorium | Bidirectional by construction. A `.md` moved under `Wardrobe/<sub>/` in the Scriptorium appears in that wardrobe folder on the next read; a folder created there is a wardrobe folder. No realtime topic is added; the browser refetches on open and after its own mutations, exactly as today. |
| Creating an item | The editor's new **Folder** field defaults to the folder being browsed. The create route accepts `folder`. |
| `instructions.md` | Root only. It is never an item and is never swept, at any depth. |

## 3. Vocabulary

- **Folder** — a string path relative to `Wardrobe/`: `''` for the root, otherwise `Seg/Seg/Seg` with no leading or trailing slash. Carried as `WardrobeItem.folder`.
- **Container** — the tier the browser is pointed at (`WardrobeContainer`, unchanged).
- **Tier row** — in a character container, the special folder-like row that opens a shared tier.
- **Select mode** — the browser state in which manageable rows show checkboxes.

## 4. What already exists (read before building)

- **Location:** `resolveWardrobeLocation` (`lib/wardrobe/location.ts:140`), `WardrobeLocation` (:51–74) with `readItems` / `findItem` / `create` / `update` / `delete`. `update` strips `id`, `createdAt`, `updatedAt` from the patch (:118–124). There is no multi-item update; each call re-projects the whole folder.
- **Reads are flat on purpose.** `readCharacterVaultWardrobe` (`vault-overlay/vault-readers.ts:328–392`) calls `docMountDocuments.findManyByMountPointsInFolder([mp], 'Wardrobe', '.md')` without `recursive`; the repository method (`doc-mount-documents.repository.ts:180–219`) drops nested paths unless `options.recursive === true`. Every tier reads through this one reader (`wardrobe-sync.ts:73`, `shared-wardrobe.ts:60`, `wardrobe-writes.ts:96–103`). `isWardrobeItemDocumentPath` (`vault-overlay/parsers.ts:254–261`) states the same flat rule and is the **one predicate** the `.qtap` wear-ledger export (`lib/export/ndjson-writer.ts:728–729`), the restore id remap (`lib/backup/restore/uuid-remap.ts:104, 158`) and the ledger import (`lib/import/quilltap-import/import-wardrobe-wear.ts:213`) use. Making it recursive fixes all three side-channels at once; leaving it flat means an item in a subfolder loses its ledger rows on export and its id remap on restore.
- **Ids come from frontmatter.** `resolveWardrobeItemId` (`parsers.ts:238–246`): the frontmatter `id` when UUID-shaped, else a path-derived stable id. Every projected file carries `id`, so moving a file does not change its identity. Every reference is by id: `componentItemIds`, `chats.equippedOutfit`, `wardrobe_wear_stats.itemId`, image `files` rows. **Nothing stores a path.**
- **Writes re-project the folder.** `createInMount` / `updateInMount` / `deleteInMount` (`wardrobe-writes.ts:168–236`) read the folder, change the list in memory, and call `projectVaultWardrobe` (`wardrobe-sync.ts:105–139`), which calls `projectArrayIntoVaultFolder` (`vault-projection.ts:29–85`): list existing top-level `.md`, write every item to `Wardrobe/<sanitized title>[-n].md`, delete any top-level `.md` not written except preserved names. A title change already renames the file; the item's original path is never kept. Writes are serialised per mount (`runSerialized`, :48–58). `projectArrayIntoVaultFolder` is also used by `managed-fields.ts` for other vault folders — **its default behaviour must not change**.
- **Other projection callers:** `lib/startup/refresh-vault-wardrobe.ts:73` (re-projects what the reader returned — carries `folder` for free once the reader is recursive) and `migrations/scripts/cutover-characters-to-vault.ts:599` (legacy DB → root; untouched).
- **Component slugs** (`componentItems` frontmatter) resolve against the items in the same read (`itemBySlug`, `vault-readers.ts:352–379`; `resolveAndCheckComponentItems`, `parsers.ts` ~440+). An unknown slug is dropped with a warning; an unknown UUID is kept (bug 187). A recursive read keeps "the same read" one list, so nothing changes here — but a file that is *hidden* from the read today (already in a subfolder) and referenced by slug is currently being dropped on every write; the recursive read ends that.
- **Routes:** the factory (`lib/wardrobe/routes/wardrobe-route-factory.ts`): collection `GET` (list, `?includeArchived`, `?scope=group`, `?action=instructions`), `POST` (create, `?action=instructions`); item `GET` (`?action=wear-history`), `PUT` (`updateWardrobeSchema`, archive via `{archived}`), `DELETE`. Tier URLs at :5–8. Transfers: `app/api/v1/wardrobe/transfers/route.ts` (`move` keeps the id, `copy` mints one; schema :63–102). Store-level folder ops exist on the mount-point route: `?action=move-file`, `move-folder`, `delete-folder` (empty only), `POST …/folders`; implementations `lib/mount-index/database-store.ts` (`moveDatabaseDocument` :219, `moveDatabaseFolder` :428), `folder-paths.ts` (`ensureFolderPath` :108).
- **Schemas:** `WardrobeItemSchema` (`lib/schemas/wardrobe.types.ts:165–215`), `wardrobeItemFieldsSchema` / `createWardrobeSchema` / `updateWardrobeSchema` (:129–159). Composite = `componentItemIds.length > 0` (`isComposite`, :330).
- **Tools:** `lib/tools/wardrobe-*-tool.ts` + `lib/tools/handlers/wardrobe-*-handler.ts`. `wardrobe_list`'s result item is `WardrobeListItemResult` (`wardrobe-list-tool.ts:45+`, `is_own` at handler :130, the `[shared — read-only]` tag at :248). Registered in `lib/tools/__tests__/tool-definitions-snapshot.test.ts`.
- **UI:** `components/wardrobe/wardrobe-control-dialog.tsx` (container select, instructions, left `WardrobeBrowser`, right *Wearing now* / *Fitting room*); `WardrobeBrowser.tsx` (search, Items/Outfits, sort, slot buttons, Show archived / Show shared / Never worn, flat `WardrobeItemRow` list, sticky footer with Import from image and + New Item; all filtering client-side, :85–109); `wardrobe-item-row.tsx` (⋮: Edit, Generate image, star, Duplicate, Move, Copy, Archive/Restore, Delete; borrowed rows get Move and Copy only); `wardrobe-item-editor.tsx` (modal, `single` | `bundle`); `WardrobeTransferDialog.tsx`; hooks `useWardrobeListData` (character container lists the merged pool, `canManage = Boolean(item.characterId)`; shared container lists its own folder), `useWardrobeItemActions`. The Prospero card `app/prospero/[id]/components/WardrobeCard.tsx` reuses the browser. No drag-and-drop anywhere in the wardrobe.
- **Query keys:** `queryKeys.wardrobe.*` (`lib/query/keys.ts:251–289`); `list(tierKey, { includeArchived })`.
- **Docs:** `docs/developer/features/complete/wardrobe-refactor.md` (invariants; §6 lists what was deliberately not done), `help/wardrobe.md` (381 lines, `url: /aurora`), `help/project-wardrobe.md:30–34` ("an item may be moved between tiers simply by moving its file"), `help/wardrobe-images.md`. The archive-service prune keeps the `wardrobe/` prefix recursively (`archive-service.ts:831–835`) — already fine.
- **Legacy `folders` table:** the wardrobe never touches it; it uses `doc_mount_folders` through `ensureFolderPath`. Keep it that way.

## 5. Design

### 5.1 The model

```ts
// lib/schemas/wardrobe.types.ts
export const WardrobeFolderPathSchema = z.string().max(900).refine(isValidWardrobeFolderPath, …);
WardrobeItemSchema = WardrobeItemSchema.extend({
  /** Folder path relative to `Wardrobe/`; '' = root. Derived from the file's path, never from frontmatter. */
  folder: WardrobeFolderPathSchema.default(''),
});
wardrobeItemFieldsSchema  += folder: WardrobeFolderPathSchema.optional()   // create defaults '', update leaves unchanged
```

`lib/wardrobe/folders.ts` (new, client-safe, pure):

- `normalizeWardrobeFolderPath(input): string` — trims, splits on `/`, drops empty segments, sanitises each with `sanitizeFileName`, rejects `.`/`..`/`images` (case-insensitive) and more than 8 segments by throwing `WardrobeFolderPathError` (a 400 at the route).
- `folderOfWardrobePath(relativePath): string` — `Wardrobe/A/B/x.md` → `A/B`; `Wardrobe/x.md` → `''`.
- `parentFolder`, `folderName`, `joinFolder`, `isSameFolder` (case-insensitive), `isUnderFolder`.
- `WARDROBE_FOLDER_MAX_DEPTH = 8`, `WARDROBE_RESERVED_FOLDER_SEGMENTS = ['images']`.

### 5.2 Reading recursively

- `readCharacterVaultWardrobe` passes `{ recursive: true }` and skips any path whose folder's first segment is `images` (case-insensitive) or whose file name is `instructions.md`. Each parsed item gets `folder = folderOfWardrobePath(doc.relativePath)`.
- `isWardrobeItemDocumentPath` becomes: under `Wardrobe/`, ends `.md`, not under `Wardrobe/images/`, not `instructions.md` at any depth. Update its doc comment; it is still the one predicate and the three side-channels inherit the change.
- `parseWardrobeItemFile` ignores a frontmatter `folder` key if a hand-edited file carries one (the path wins; log at debug).

### 5.3 Projecting recursively

`projectArrayIntoVaultFolder` gains an option, default off so `managed-fields.ts` is untouched:

```ts
opts?: {
  preserveFileNames?: readonly string[];
  /** Recursive projection: the mapper may return `fileName` with `/` separators
   *  (a folder path under `folder`), the existing-file listing is recursive, and
   *  the sweep deletes stale `.md` at any depth except under `excludeSubfolders`. */
  recursive?: { excludeSubfolders: readonly string[] };
}
```

- Collision suffixing (`-1`, `-2`) is **per folder**: the `seen` set is keyed by the full lower-cased relative path.
- `ensureFolderPath(mountPointId, 'Wardrobe/' + folder)` once per distinct folder before writing (collect the set first; one call each).
- The sweep never deletes folders. Preserved names are matched by file segment at any depth.
- `projectVaultWardrobe` passes `recursive: { excludeSubfolders: ['images'] }` and maps `fileName = joinFolder(item.folder, sanitizeFileName(item.title) + '.md')`.

A moved item is therefore "write at the new path, delete at the old" — the same thing a title rename has always been. Image links are keyed by item id and are unaffected.

### 5.4 Location and mutations

- `WardrobeLocation` gains `updateMany(patches: Array<{ id, patch }>): Promise<WardrobeItem[]>` → one read, all changes applied in memory, **one** projection. `update` becomes `updateMany([one])`. Also `listFolders(): Promise<WardrobeFolder[]>` — the union of `doc_mount_folders` rows under `Wardrobe/` (excluding `images`) and the folders implied by item paths, each `{ path, name, itemCount }` with `itemCount` counting non-archived items directly inside; `createFolder(path)`, `renameFolder(path, newName)` (→ `moveDatabaseFolder`), `deleteFolder(path)` (→ items and subfolders to the parent via `updateMany` + `moveDatabaseFolder`, then delete the row).
- `lib/wardrobe/item-mutations.ts` gains `moveItemsToFolder(location, itemIds, folder)` — validates every id is in the location (`findItem`), normalises the folder, calls `updateMany`. Only manageable items qualify; a borrowed id is a 400 naming it. `createItem` accepts `folder` (normalised; default `''`). `updateItem` accepts `folder` in its patch.
- Folder mutations get their own `lib/wardrobe/folder-mutations.ts` (`createWardrobeFolder`, `renameWardrobeFolder`, `deleteWardrobeFolder`) so the route handlers stay thin. All of them log at debug with scope, mountPointId, path, and counts.
- The transfer route: an item carries `folder` across; the destination's `create` / `updateMany` ensures the folder. The copy with `components: 'copy'` keeps each component's folder too.

### 5.5 Routes (through the factory, every tier at once)

Collection route additions, dispatched with `withCollectionActionDispatch`:

| Verb | Action | Body | Result |
|---|---|---|---|
| `GET` | `?action=folders` | — | `{ folders: WardrobeFolder[] }` |
| `POST` | `?action=create-folder` | `{ path }` | `{ folder }` |
| `POST` | `?action=rename-folder` | `{ path, name }` | `{ folder }` |
| `POST` | `?action=delete-folder` | `{ path }` | `{ movedItems: n, movedFolders: n }` |
| `POST` | `?action=move-items` | `{ itemIds: string[], folder: string }` | `{ items: WardrobeItem[] }` |

`createWardrobeSchema` / `updateWardrobeSchema` accept `folder`. The character collection's `?scope=group` listing and the merged pool carry `folder` on every item because the type does. Unknown actions remain a 400 by the dispatcher's rule.

### 5.6 Tools (read-only)

- `WardrobeListItemResult` and the `wardrobe_read` result gain `folder: string | null` (null for root). The text rendering appends ` [folder: Formal/Evening]` after the title line when non-null, in both tools.
- `wardrobe_list` descriptions say folders are the operator's filing and carry no meaning for dress. No input schema changes; re-record the snapshot test.

### 5.7 The browser

`WardrobeBrowser.tsx` keeps its props and gains folder state: `currentFolder` (`''` at root), `currentTier` (`'own' | tierKey`; character containers only), `selectMode`, `selectedIds`.

- **Folder bar** (above the search box): the breadcrumb — root crumb **Wardrobe** (or the container's name), one crumb per segment, each clickable; in a character container a tier row's crumb reads *General* / *Project: X* / *Group: Y*. Right side: **New folder** (inline input, Enter to create, Esc to cancel) and **Select**.
- **The list:** when not searching, subfolder rows first (`WardrobeFolderRow`: folder icon, name, item count, ⋮ → Rename, Delete), then in a character container at the root the tier rows (after own subfolders, hidden when Show shared is off), then the items whose `folder` equals `currentFolder` (and, in a character container, whose tier matches). When the search box is non-empty: no folder or tier rows; every item in the container's list matches by title (as today), and each `WardrobeItemRow` shows a muted crumb `Formal › Evening` (and the tier chip, which borrowed rows already carry). The breadcrumb reads *Searching everywhere*.
- The existing filters (kind, slot, sort, archived, never worn, shared) apply to the item rows in whatever view is listed. Counts on folder rows ignore the filters (they are "what's in there", not "what matches").
- **Select mode:** checkboxes on manageable item rows (never on folder rows, tier rows, or borrowed rows); the row's ⋮ and wear buttons are disabled; a sticky bar at the bottom of the list reads *N selected · Move to folder… · Cancel*. Leaving the folder or toggling search clears the selection.
- **Move to folder…** (row ⋮ and the sticky bar) opens `WardrobeFolderPickerDialog` (`BaseModal`, portalled): the container's folder tree (from `?action=folders`) as an indented list with the root on top, the item's current folder disabled, **New folder…** inline under the highlighted node, **Move** primary. On success: toast, invalidate `wardrobe.list(tierKey, *)` and `wardrobe.folders(tierKey)`, stay in the current view.
- **Row ⋮** gains *Move to folder…* above *Move* (the tier transfer); rename the latter's label to *Move to another wardrobe…* and *Copy* to *Copy to another wardrobe…* so the two kinds of moving are not confused.
- **Editor:** a **Folder** select (root + every folder from `?action=folders`, plus *New folder…* which reveals an input) in both `single` and `bundle` modes; defaults to the browser's `currentFolder` on create.
- **Empty states:** an empty folder reads **"Nothing hangs here yet."**; a deleted folder's confirm reads **"Send its N items up to *Parent*?"**. Keep the voice light; the browser is a working surface.
- Mobile: the breadcrumb wraps; the sticky bar stays at the bottom of the list, not the viewport.

The Prospero Wardrobe card gets all of this because it mounts the same component; verify it there too.

### 5.8 Query keys

`queryKeys.wardrobe.folders(tierKey)` → `['wardrobe', 'folders', tierKey]`. Invalidated by every folder mutation, by item create/update/delete/transfer (an item's folder may be new), and swept by the existing `wardrobe.all` prefix.

### 5.9 Scriptorium reflection — what must hold

- A `.md` moved into `Wardrobe/Formal/` in the file manager lists under *Formal* after the next wardrobe read, keeps its id (frontmatter), its pictures, its ledger, and its place in any outfit.
- A folder created under `Wardrobe/` in the file manager appears in `?action=folders` (it is a `doc_mount_folders` row).
- A folder named `images` created under `Wardrobe/` in the file manager is simply not a wardrobe folder (excluded on read); the wardrobe never creates one.
- Moving a wardrobe file *out* of `Wardrobe/` removes it from the wardrobe, as today.
- The SVAR mapping (`components/files/svar/event-route-map.ts`) is untouched.

### 5.10 Export, backup, restore

Store files travel by path already (`ndjson-writer.ts` `streamOneStore`, backup's whole-table dump), so folder rows and nested files ride along with no format change. The three side-channels are fixed by §5.2's predicate. Add a test for each: an item at `Wardrobe/Formal/x.md` exports its `wardrobe_wear_stats` rows, remaps on restore, and imports its ledger.

### 5.11 Not in this version

- Drag-and-drop onto folders or crumbs.
- A `wardrobe` realtime topic (still the refactor doc's §6 debt).
- Folder-aware tool inputs.
- A folder control on the tier-transfer dialog.
- Merging folders across tiers in the character view.

## 6. Work, in order

Each phase ends with `npx tsc`, `npm run lint`, the wardrobe unit suites, and the walkthrough items named. Phases A and B change no visible behaviour for a root-only wardrobe, so they can ship alone.

### Phase A — model, read, predicate, projection (server)

1. `folder` on the schemas, `lib/wardrobe/folders.ts` (§5.1).
2. Recursive read and predicate (§5.2); recursive projection option and `projectVaultWardrobe` mapping (§5.3).
3. Tests: `folders.test.ts` (normalisation, reserved segments, depth, case-insensitive sameness); `parsers` predicate (nested yes, `images/` no, `instructions.md` at depth no); `vault-projection` recursive mode (writes nested, sweeps nested stale, never touches `images/`, per-folder collision suffixes, flat callers unchanged); the three side-channel tests of §5.10; a read of a vault whose file was hand-moved into a subfolder lists it with the right `folder`.
4. Walkthrough on V4test: move a vault item's file into `Wardrobe/Test/` in the Scriptorium; the item still lists (root-level UI for now shows it with `folder = 'Test'`), wears, and keeps its picture; edit its title and confirm the file is rewritten in `Test/`.

### Phase B — location, mutations, routes

1. `updateMany`, `listFolders`, `createFolder`, `renameFolder`, `deleteFolder` on the location (§5.4); `moveItemsToFolder`; `folder-mutations.ts`; `folder` accepted on create and update; transfer carries `folder`.
2. The five factory actions (§5.5), every tier at once by construction.
3. Tests: route factory actions on one tier config; `move-items` refuses a borrowed id; `delete-folder` moves contents up and removes the row; `rename-folder` moves items' `folder`; transfer preserves `folder`; `updateMany` projects once (spy on `projectVaultWardrobe`).

### Phase C — the browser

1. Folder bar, folder rows, tier rows, breadcrumb, search-spans-all, select mode, sticky bar (§5.7).
2. `WardrobeFolderPickerDialog`, row ⋮ changes, editor Folder field, query keys (§5.8).
3. Tests (RTL with `renderWithQuery`): root lists folders then items; entering a folder filters items; search ignores the folder and shows crumbs; tier rows appear only in character containers and hide with Show shared off; select mode exposes checkboxes only on manageable rows; the picker disables the current folder.
4. Walkthrough on V4test, in a chat and in the Prospero card: create *Formal* and *Formal/Evening*, move three items singly and two in bulk, wear one from *Evening*, compose an outfit across folders, rename *Formal* to *Dress*, delete *Dress/Evening* and watch its items land in *Dress*, open the Scriptorium and see the same tree, move a file there and see it move here.

### Phase D — tools

1. `folder` in `wardrobe_list` / `wardrobe_read` results and text (§5.6); re-record the snapshot.
2. Walkthrough: ask a character what is in the closet and confirm the folder tags read sensibly.

### Phase E — docs

- `help/wardrobe.md` (a *Folders* section: breadcrumb, select mode, move, rename, delete, what folders do **not** mean), `help/project-wardrobe.md:30–34` (nested files are items too), `docs/CHANGELOG.md`, `docs/developer/API.md` (five actions, one field), the chokepoint paragraph in CLAUDE.md gains: *"An item's folder is its path under `Wardrobe/` and nothing else; folder changes go through `moveItemsToFolder` / `folder-mutations.ts`, and `isWardrobeItemDocumentPath` is recursive except under `images/`."* Move this spec to `features/complete/` with an "As built" section.

## 7. As built

Everything in §§5–6 shipped as specified, with these particulars and small departures:

- **Files.** `lib/wardrobe/folders.ts` (rules, client-safe; also `normalizeWardrobeFolderName`, `normalizeWardrobeFolderPathOrRoot`, `rebaseFolder`, `folderCrumb`, `wardrobeFolderStorePath` and the `WardrobeFolderNotFoundError` / `WardrobeFolderConflictError` classes), `lib/wardrobe/folder-mutations.ts`, `lib/wardrobe/folder-view.ts` (the browser's pure view rules: folder rows, tier rows, `viewTierOf`), `lib/hooks/use-wardrobe-folders.ts` (query + mutations), `components/wardrobe/WardrobeFolderPickerDialog.tsx`, `components/wardrobe/wardrobe-item-editor/WardrobeFolderField.tsx`. `sanitizeFileName` moved to client-safe `lib/mount-index/sanitize-file-name.ts` (re-exported from `character-vault.ts`) so the folder rules can share it.
- **Read.** `readCharacterVaultWardrobe` reads recursively and filters with `isWardrobeItemDocumentPath` itself — the reader and the three side-channels now use literally the same predicate. A frontmatter `folder:` key is ignored (debug log).
- **Projection.** `projectArrayIntoVaultFolder`'s `recursive` option as specified. One change applies to flat callers too: the "did I just write this?" check in the sweep compares lower-cased paths. The store's link upsert is case-insensitive and keeps the stored casing, so the old exact-case comparison could delete a file it had just rewritten when only casing differed (a title `coat` → `Coat`, or now a folder `formal` landing in `Formal/`).
- **Writes.** `updateManyInMount` (one read, one projection; `updateInMount` is a one-patch call of it) and four folder primitives (`listFoldersInMount`, `createFolderInMount`, `renameFolderInMount`, `deleteFolderInMount`) live in `wardrobe-writes.ts` on the same per-mount serialisation chain as item writes. A batch that moves folders, or a create into a folder, reads the folder back so the answer carries the store's casing. The cycle-check peers are now loaded only when a patched item is a composite. A folder a write *brings* (a create, a patch) passes `safeFolder`: kept when already normal, otherwise normalised or sent to the root — this covers imported `.qtap` `wardrobe_item` records, which carry `folder` because the item type does.
- **Delete folder.** Items (archived included) under the folder are re-rooted to the parent in one `updateMany` batch, which merges naturally into a same-named folder there; empty subfolder rows are re-created under the parent, then the old rows are removed deepest-first through `deleteDatabaseFolder` (which re-checks emptiness). A folder holding non-item files (blobs, `.txt`, a nested `instructions.md`) is refused with a 409 before anything moves, rather than relocating files the wardrobe does not own.
- **Rename.** `moveDatabaseFolder`; `CONFLICT` → 409, `NOT_FOUND` → 404. No projection — the item files move with the folder.
- **Routes.** The five actions are on the factory's existing `withActionDispatch` maps (the factory has always used it rather than `withCollectionActionDispatch`). Rename, delete and move resolve the location without provisioning; create-folder provisions like a create.
- **Transfers.** `folder` rides on the planned items; the route passes it through `normalizeWardrobeFolderPathOrRoot` so a hand-made folder the rules refuse lands at the root instead of failing the transfer.
- **Tools.** `folder` (null at the root) on `wardrobe_list` / `wardrobe_read` results, ` [folder: …]` after the title in both renderings, descriptions updated. The snapshot test covers input schemas only, which did not change, so there was nothing to re-record.
- **Browser.** View state (tier, folder, select mode, selection, the new-folder input) remembers the container or view it was set in and reads as its initial value elsewhere, instead of effects that reset it (the React lint rule forbids set-state-in-effect). Shared tiers in a character's view derive their folder rows from their items (they are browsed, not managed); the own tier unions the server's tree with item-implied folders. Folder-row counts come from the server when it lists the folder, otherwise from the items. Unticking **Show shared** from inside a tier returns to the closet's root. Folder rename is inline on the row; delete confirms through the dialog's existing confirmation. Row ⋮ gained *Move to folder…*; *Move* / *Copy* are now *Move to another wardrobe…* / *Copy to another wardrobe…*.
- **Editor.** The Folder field's options come from the *destination* wardrobe (the item's home on edit; the chosen "Add to" target on create), and a value not in the tree is kept (it is created on save). Drafts carry `folder`, so Duplicate files the copy beside the original.
- **Export schema.** `qtap-export.schema.json`'s `WardrobeItem` documents `folder`. No DDL change: folders are the existing `doc_mount_folders` rows.
- **Tests.** `folders.test.ts`, `vault-projection-recursive.test.ts`, `wardrobe-folder-read.test.ts`, `wardrobe-folder-writes.test.ts` (in-memory store: updateMany projects once, list/create/rename/delete), route-factory folder actions, transfer folder preservation, tool folder rendering, the three side-channels (`ndjson-writer`, `import-wardrobe-wear`, `uuid-remapper`), and `wardrobe-browser.folders.test.tsx` (RTL).
- **Review round (PR #85).**
  - The projection sweeps only files the wardrobe owns (`ownsFile: isWardrobeItemDocument` — an item path whose frontmatter has a valid `types` list), at every depth. A note or half-written file under `Wardrobe/` is never deleted by a wardrobe write; this narrows the old root-level sweep too. `deleteFolderInMount` counts such files as strays.
  - Operator-requested folders resolve against the tier's existing folder rows (`resolveWardrobeFolder` via `location.resolveFolder`): an existing folder is used exactly as stored, so filing into a hand-made `Hats: Summer` or `Formal/images` works and never makes a sanitised sibling; only new parts are normalised. `updateItem` drops a `folder` equal to the current one, and the editor sends `folder` only when it changed (`payloadForEdit`). `safeFolder` in the writer keeps any structurally safe path (`isSafeWardrobeFolderPath`) and normalises only unsafe ones (`../x`). So the picker may list hand-made folders: they are valid targets.
  - Rename stamps ids into item files that lack a frontmatter UUID (one projection) before `moveDatabaseFolder`, since a path-derived id would change with the path.
  - Delete-folder also refuses (409, nothing moved) a folder with a subfolder of its own name, which would be re-rooted into itself; a `NOT_EMPTY` from the store maps to 409.
  - `GET ?action=folders` resolves without `ensure` and answers `{ folders: [] }` for a project or group with no store.
  - The projection ensures only subfolders that hold no existing document. `updateManyInMount` / `createInMount` no longer read back for casing (resolution supplies it); `updateManyInMount({ requireAll })` replaces `moveItemsToFolder`'s separate read for the borrowed-id check. `WardrobeItemNotInLocationError` moved to `folders.ts` (re-exported from `item-mutations.ts`).
- **Not done here.** The live walkthroughs on V4test (§6 A.4, C.4, D.2) need a running instance and were not performed in this build session.
