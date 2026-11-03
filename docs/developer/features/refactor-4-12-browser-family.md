# Refactor 4.12 — The browser family, finished: the remaining Wardrobe / Inventory pairs and the last legacy browser

**Status:** Phases 1–3 done (2026-11-03). Phase 4 is held for the tier-walk spec's project-tier decision; Phase 5 is decided (§4.4) and waits on spec 2. Proposed 2026-11-02. Part of the [4.12 refactor set](refactor-4-12.md). Sequel to the six-phase [folder browser](complete/folder-browser.md), whose own "left for later" list this picks up. The server-side tier resolver (`location.ts` ×3) is the [tier-walk spec](refactor-4-12-tier-walk.md)'s family A and is not repeated here.

## 1. The problem

The folder-browser programme shared the browser shell, folder state, the ⋮ menu, the container select, the destination picker and the server folder layer across the Wardrobe, the Inventory, the Scriptorium and Document Mode. What it left is a set of Wardrobe / Inventory pairs that are still parallel files, and one browser from before the programme, `components/files/FileBrowser.tsx`, that the spec explicitly deferred ("Retiring it is a separate clean-up").

### 1.1 Pairs still parallel (client)

| Pair (Wardrobe / Inventory) | Lines | What is the same |
|---|---|---|
| `WardrobeBrowser.tsx` / `InventoryBrowser.tsx` | 546 / 281 | The hook wiring, the "Show archived" / "Show shared" checkboxes, the Move / Copy-to-folder select-bar buttons, the search input |
| `wardrobe-control-dialog.tsx` / `inventory-control-dialog.tsx` | 606 / 345 | Container auto-select (`:158-201` / `:116-148`), the `requestConfirmation` wrapper, the `containerLabel` switch (`:323-335` / `:188-200`), the `ContainerSelect` header with its "shared with every character who can reach this …" note (`:358-387` / `:209-229`), the modal-or-tab shell (`WardrobeShell:107-143` / `:316-344`) |
| `WardrobeFolderPickerDialog.tsx` / `InventoryFolderPickerDialog.tsx` | 120 / 77 | Folders hook, `createFolder`, root label; the submit-and-toast lives in `WardrobeBrowser.fileToFolder:220-248` on one side and inside the picker (`:58-74`) on the other |
| `hooks/useWardrobeItemActions.ts` / `hooks/useInventoryItemActions.ts` | 308 / 209 | The editor / folderPicker / transfer overlay state machine, `addressOf`, `overlayOpen` |
| `wardrobe-image-viewer.tsx` / `inventory-image-viewer.tsx` | 145 / 82 | `FullScreenImageViewer` + `SaveImageDialog` + download / copy |
| `providers/wardrobe-dialog-provider.tsx` / `inventory-dialog-provider.tsx` | 74 / 58 | Open / close context |
| `lib/hooks/use-wardrobe-folders.ts` / the folder part of `lib/hooks/use-inventory.ts` | 169 / ~60 | The same five folder actions; Wardrobe invalidates on settle, Inventory uses `refreshUnlessRealtime` because a `wardrobe` realtime topic does not exist (`use-wardrobe-folders.ts` header; `topic-map.ts` has `inventory` and `mountPoints` only) |
| `WardrobeTransferDialog.tsx` / `InventoryTransferDialog.tsx` | 193 / 98 | Only the footer and `ContainerSelect`. Request bodies differ (`:88-99` vs `:52`); Wardrobe has a components fieldset, a default destination and a nullable `source` the server probes for |
| `wardrobe-item-row.tsx` / `inventory-item-row.tsx` | 424 / 143 | Checkbox, archived badge, origin chip, the `ItemActionMenu` entry list (`:360-388` / `:121-139`). The spec rejected an `ItemRowShell` ("a checkbox and a chip, too little to share"); that still holds |

### 1.2 Pairs still parallel (server)

| Pair | Lines | What is the same |
|---|---|---|
| `lib/wardrobe/routes/wardrobe-route-factory.ts` / `lib/inventory/routes/inventory-route-factory.ts` | 497 / 385 | `RouteConfig`, `LABELS`, `makeResolver` (`:134-159` / `:97-111`, identical), the read probe for folders (`handleGetFolders:220-231` / `probe:122-132`), the `handleFileItems` skeleton. A third tiered factory, `lib/mount-index/scenario-item-route-factory.ts` (388), repeats the config shape |
| `app/api/v1/wardrobe/[itemId]/images/route.ts` / `app/api/v1/inventory/[itemId]/images/route.ts` | 379 / 219 | `findHome`, `save-targets`, `save-to-store` (`:322-364` / `:178-205`: the same six-step sequence), `set-current`, `delete-image`, the schemas; the Inventory file's header says it "mirrors the wardrobe's" |
| `lib/wardrobe/folders.ts` / `lib/inventory/folders.ts` | 146 / 127 | Four error subclasses and one-line wrappers over `lib/mount-index/item-folders.ts` |

Divergences the factories hide, which a shared preamble must settle rather than paper over: response keys (`wardrobeItems` vs `items`), per-tier vs uniform 404 labels, the error mapping (`writeErrorResponse` switch vs `withInventoryErrors`), and the Wardrobe's provisioning on GET (`:170-172, :321-323`; the tier-walk spec files that as a bug).

### 1.3 Dead code found on the way

- `lib/wardrobe/folder-mutations.ts`: `createWardrobeFolder`, `renameWardrobeFolder`, `deleteWardrobeFolder` have **no callers**; only `WARDROBE_FOLDER_KIND` is used. CLAUDE.md still says "folder changes go through `moveItemsToFolder` / `folder-mutations.ts`".
- `lib/wardrobe/folder-view.ts` re-exports `childFolderRows`, `tierLabel`, `tierRows` with no importers; `WardrobeBrowser` imports it for `OWN_TIER` and `viewTierOf` only, and the Inventory imports `OWN_TIER` from `lib/folder-browser/view` directly.
- `FileBrowser.tsx`'s whole project branch (`?action=list-files`, `files/folders?projectId=`, the upload button) is unreachable: both callers pass `projectId={null}`.
- Three copies of `normaliseRelativePath` / `isPathSafe`: `lib/mount-index/path-utils.ts:27` (exported), `app/api/v1/mount-points/[id]/folders/route.ts:23-38`, `lib/mount-index/database-store.ts:54`.
- Hand-rolled `role="menu"`s beside `ItemActionMenu`: `wardrobe-control-dialog.tsx:502-563` ("Reset…"), the slot picker in `wardrobe-item-row.tsx:164`, `components/scenarios/ScenarioRow.tsx:53` (whose comment says "mirroring the wardrobe row").

### 1.4 The last legacy browser

`components/files/FileBrowser.tsx` (663 lines, with `FileBrowserGrid` 175, `FileBrowserList` 288, `MoveToProjectModal` 207, `OrphanCleanupModal` 125, `FolderManagement/CreateFolderModal` 148, `FolderPicker` 279 + test: about 1,885 lines) has two callers, the `/files` page (`app/files/FilesView.tsx:31`) and the attachment picker's General source (`LibraryFilePickerModal.tsx:416`). It reads the legacy `files` table (`GET /api/v1/files?filter=general`), the legacy `folders` table (`/api/v1/files/folders`, 434 lines, the `ensureByPath` chokepoint), and uses association-aware delete, promote-to-project, sync, orphan cleanup and thumbnail generation by `files.id`. The bytes of those rows already live in the "Quilltap Uploads" database store (`lib/file-storage/user-uploads-bridge.ts`); the rows' metadata and virtual `folderPath` do not map onto that store's tree. Server code with no client caller outside FileBrowser: `files/folders/route.ts`, `cleanup-orphans.ts` (264), `sync.ts`, `generate-thumbnails.ts` (90), `[id]/actions/promote.ts` (53), and `[id]/actions/move.ts` (70, no client caller found at all).

## 2. Goal

Finish what the folder-browser programme started: every Wardrobe / Inventory surface that differs only in wording and types becomes one component or one factory with a kind parameter; the dead pieces go; and `/files` and the picker's General source stop depending on a browser over the `files` table, so `FileBrowser` and its server routes can be retired.

## 3. Non-goals

- `ItemRowShell`. Still too little in common.
- Unifying the two **transfer services** (`lib/wardrobe/transfers.ts` 413 / `lib/inventory/transfers.ts` 148). They share ten normalised lines; the Wardrobe carries outfit components and id remapping, the Inventory carries kit stranding, `canCopy` and contextual reach, and both are named CLAUDE.md chokepoints. Leave them.
- The item writers (`createItem` / `updateItem` / `setItemArchived`; `lib/inventory/item-mutations.ts` with `lintInventoryTitle`). Chokepoints; untouched.
- Drag-and-drop (the spec's open question 4).

## 4. Design

### 4.1 Client: one kind-parameterised layer (cheap, ~450–600 lines)

- **`ItemControlDialogShell`** (new, `components/item-browser/`): container auto-select, confirmation wrapper, `containerLabel`, the `ContainerSelect` header with the shared note, modal-or-tab shell. Both control dialogs become body components inside it. Wardrobe's tests (`wardrobe-control-dialog.*.test.tsx`: race, shared filter, worn bundles) pin behaviour.
- **Browser chrome into `FolderBrowserShell` props**: `showArchived` / `showShared` toggles and the Move / Copy-to-folder select actions, declared once. Test ids kept (`wardrobe-folder-crumb`, `inventory-folder-crumb`, `wardrobe-wear-line`).
- **One `ItemFolderPickerDialog`** over `DestinationPickerDialog`, taking the folders hook and `createFolder` as a port; `fileToFolder` moves out of `WardrobeBrowser` into it, as the Inventory already has it.
- **`useItemOverlays`**: the editor / folder-picker / transfer overlay state machine shared by both actions hooks. The duplicate-item divergence (client POST with `nextCopyTitle` vs server `?action=duplicate`) is settled by giving the Wardrobe a server `?action=duplicate` through its factory, so both hooks call one mutation.
- **`ItemImageViewer`** and **`ItemDialogProvider`** parameterised by kind.
- **Menus**: `ScenarioRow`'s kebab, the Wardrobe "Reset…" menu and the slot picker become `ItemActionMenu` (which gains a `trigger` prop for the non-⋮ cases). Three hand-rolled WAI-ARIA menus and their Escape / click-outside effects go.
- **Folder hooks**: one `useItemFolders(kind)` with the Inventory's `refreshUnlessRealtime` strategy, which means adding a `wardrobe` topic to `REALTIME_TOPICS` / `topic-map.ts` and publishing it from the wardrobe location writes (the Inventory's `chokepoints.test.ts` pattern: every location write publishes). This also removes the "no realtime topic for wardrobe" header.

### 4.2 Server: shared preamble and one images route (medium, ~200 lines)

- Move `RouteConfig`, `LABELS`, `makeResolver`, the read probe and `GET ?action=folders` into `lib/mount-index/item-folder-routes.ts` beside `itemFolderActionHandlers`. Settle the hidden divergences explicitly: response keys stay per kind (a wire change is not worth it), 404 labels become per tier for both (the Wardrobe's are better), error mapping goes through one `withItemErrors(kind)`, and no GET passes `ensure`. The scenario item factory adopts the same `RouteConfig`.
- One `createItemImagesRoute(kind)` behind both images routes; the differences (instance fallthrough and `inherited` on the Inventory, `link-image` on the Wardrobe) become kind options.
- Delete the dead folder wrappers and re-exports; collapse the three `normaliseRelativePath` copies onto `path-utils.ts`; fix the CLAUDE.md wording.

### 4.3 The Wardrobe's client-side tier merge (risky, decide separately)

`use-character-wardrobe-items.ts` merges four tier queries in the browser, and its project tier is the official store only, which disagrees with `loadWearablePool`. The Inventory merges on the server (`?shared=true`). Moving the Wardrobe to the server merge removes about 150–200 client lines (`use-character-wardrobe-items` 140, `use-wardrobe-tier` 85, `use-wardrobe-container-items` 80, minus a thin replacement) and makes the browser show exactly what `loadWearablePool` gives the character. It touches the reference picker and the vantage hooks (`wardrobe-reference-picker.tsx` 336, `use-wardrobe-vantage-items`). Recommendation: do it, after the tier-walk spec's project-tier decision, as its own PR.

### 4.4 Retiring `FileBrowser` (decided 2026-11-03; ~1,900 client + up to ~850 server lines)

Not a refactor of the browser family so much as the end of the `files` table as a browsable surface. The human accepted the proposals below on 2026-11-03.

**Prerequisites.** Two other 4.12 specs land first. Spec 7 is done (#138); spec 2 is still to come.

- [Spec 7, one watcher core](refactor-4-12-native-watcher-core.md) (**done**). Before it, the `files/` watcher had no polling fallback: when a recursive `fs.watch` was refused it logged a warning and stayed off, leaving the manual *Sync* button as the only recovery. It now inherits the fallback, which is what lets decision 4 drop the button.
- [Spec 2, one document core](refactor-4-12-document-core.md). The editor and `doc_read_file` read an uploaded blob through two different readers. Once `/files` is a store browser, opening an upload goes through that path, so the divergence should be settled first.

**Decisions.**

1. **`/files` becomes a `DocumentStoreBrowser` over the Quilltap Uploads store**, where the bytes already are (`lib/file-storage/user-uploads-bridge.ts`). The page shows the store's real folders (`chat/`, `images/`, `diagnostics/`, `restored/`, `imported/`, …), not the legacy `folders` tree.
   - Before switching, a one-off survey on a real instance (read-only, through `npx quilltap`) counts hand-made `folders` rows with no project, and `files` rows with no project that carry a `description` or a non-root `folderPath`.
   - If the counts are non-trivial, a migration carries them over: descriptions into the store's description column, hand-made folders as real folders in the Uploads store with their files moved in. It follows the migration rules (pretty label, `reportProgress`). If the counts are negligible, they are dropped and the CHANGELOG says so.
   - `fileStatus: 'orphaned'` is handled by a Scriptorium-side "unreferenced files" action instead of the `files`-id orphan cleanup.
2. **The picker's General step browses the same store** with `DocumentStoreBrowser`, as the project and store steps already do. Linking by `files.id` (`chats/{id}/files?action=link`) gives way to `attach-mount-file`.
   - This adds a Librarian announcement on attaching a general file where there was none. That is accepted.
   - Check first whether the Uploads store already appears in the picker's `docStores` list (no filter hiding it was found). If it does, the General step and the store step merge.
3. **Promote-to-project becomes a store move**: a move or copy from the Uploads store into the project's store, through the existing cross-store `move-folder` / `copyFile` operations. `MoveToProjectModal` and `[id]/actions/promote.ts` go.
4. **Sync and thumbnail generation are dropped**; spec 7 has given the `files/` watcher its polling fallback. Before deleting `generate-thumbnails.ts`, check that `DocumentStoreBrowser`'s image rows render from the store without a pre-generation pass.
5. **Then delete** the client files in §1.4 and the server routes whose only callers they were, after a grep for other callers of each. `files/folders/route.ts` is the one `ensureByPath` caller on the request path. If nothing else reads the legacy `folders` table afterwards, record that in DDL.md, but do not drop the table in this phase: restore and import still write it.

**Help.** `help/files.md`, `help/file-organization.md`, `help/file-uploads.md`, `help/file-search-preview.md` and `help/files-with-ai.md` all mention `/files` or General Files; each is reread and rewritten for the store view, and the attachment-picker help loses its separate General section.

## 5. Phases

1. Dead code and the three `normaliseRelativePath` copies (one afternoon; no behaviour change).
2. §4.1 client layer, one pair per PR, in the table's order; the `wardrobe` realtime topic lands with the folder hooks.
3. §4.2 server preamble and images route.
4. §4.3 server-side wardrobe merge (after the tier-walk decision).
5. §4.4 `FileBrowser` retirement, after spec 2 (spec 7 is done): the survey and any migration first, then the `/files` page and the picker, then the deletions.

## 6. Verification

The existing suites: `wardrobe-route-factory.test.ts` (1,329 lines), `inventory/routes.test.ts`, `wardrobe-browser.folders.test.tsx`, `inventory-ui.test.tsx`, `item-action-menu.test.tsx`, `ScenarioRow.test.tsx`, the control-dialog tests, `inventory/chokepoints.test.ts` (extended to the new `wardrobe` topic), the images-route tests. New: one test per shared component rendering both kinds. Live: dress a character from a group store and a project store, move a garment between folders in both browsers, open the slot picker and the Reset menu with the keyboard.

## 7. Decisions needed from the human

1. ~~Proceed with §4.3 (server-side wardrobe merge) now or hold it.~~ **Answered (2026-11-03): hold until the tier-walk spec's project-tier decision.**
2. ~~The four `FileBrowser` questions in §4.4.~~ **Answered (2026-11-03): the proposals as written in §4.4.**
3. ~~Whether the Wardrobe's provisioning-on-GET is a bug to file or an intended convenience.~~ Fixed in Phase 3 (no GET passes `ensure`); no issue filed.
