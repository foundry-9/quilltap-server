# One Folder Browser — Wardrobe, Inventory and the Scriptorium

**Status:** Phases 1–5 done (2026-10-31). Phase 6 not started.
**Supersedes:** [svar-file-manager-implementation-plan.md](svar-file-manager-implementation-plan.md) — the SVAR route is abandoned in favour of growing the Wardrobe/Inventory browser into a shared library.

## Goal

The document-store surfaces should feel like the Wardrobe and the Inventory:
a breadcrumb, folder rows, item rows, a ⋮ menu on each, and Move/Copy
dialogs that pick a folder (and, where it makes sense, another store).
Database-backed stores also offer **hard links**. Images, PDFs and `.docx`
files can be viewed in place.

Two document surfaces get the browser:

1. **The Scriptorium store view** (`app/scriptorium/[id]/DocumentStoreDetailView.tsx`).
   It replaces both `FileTable` and the SVAR beta.
2. **Salon Document Mode.** The browse step of `DocumentPickerModal` uses the
   browser, and the Document pane gains read-only viewers for image, PDF and
   docx.

Wherever two of the three browsers (wardrobe, inventory, documents) do the
same job, the code moves into a shared library rather than a third copy.

## What exists today

### Already shared

| Layer | Where |
|---|---|
| Pure folder path rules | `lib/mount-index/item-folders.ts` |
| Server folder ops over vault item trees | `lib/database/repositories/vault-overlay/item-folder-ops.ts` (`ItemFolderTree<T>`) |
| Folder-view math (child folder rows, tier rows) | `lib/wardrobe/folder-view.ts`. It is generic, but it sits under `wardrobe/` and uses Wardrobe types; Inventory imports it from there. |
| UI pieces | `components/item-browser/`: `ItemFolderBar`, `ItemFolderRow`, `ItemTierRow`, `ItemSelectBar`, `ItemFolderPickerDialog` |
| Viewers | `components/files/FilePreview/`: image, PDF (pdfjs) and text/markdown. There is no docx viewer. |
| Mount file ops | `lib/mount-index/file-ops.ts` (`move`/`copy`/`link`, cross-mount, sha-verified) and `folder-ops.ts`; REST verbs `move-file`, `copy-file`, `link-file`, `move-folder`, `delete-folder`, folder create, per-file `GET`/`PUT`/`PATCH`/`DELETE`; `deriveMountCapabilities` |
| Hard links | `doc_mount_file_links.linkGroupId`; a write through any member repoints the whole group (`fanOutGroupFileId`, `reindexLinkGroupSiblings`) |

### Duplicated between Wardrobe and Inventory

- **Browser shell state.** About 150 near-identical lines of view, folder,
  selection, new-folder and folder-handler state:
  `WardrobeBrowser.tsx` l.119–409 and `InventoryBrowser.tsx` l.73–224.
- **Item rows and their ⋮ menus.** Each row writes the menu markup inline.
  There is no arrow-key navigation. Folder rows close only on mouse-leave,
  with no Escape and no outside click.
- **Transfer dialogs and destination selects.** There are two dialogs, two
  catalogue hooks and two `<select>` blocks. The Wardrobe dialog uses raw
  `fetch` instead of TanStack.
- **Folder hooks and query keys.** `useWardrobeFolders` /
  `useWardrobeFolderMutations` against the folder half of
  `useInventoryMutations`. The `wardrobe.*` and `inventory.*` key blocks have
  the same shape.
- **Server code with the same job:**
  - The folder half of `WardrobeLocation` and `InventoryLocation`.
  - The folder-mutation wrappers.
  - `moveItemsToFolder` and `moveInventoryItemsToFolder`, which are identical.
  - The folder actions in the two route factories, and their two error mappers.
- **Behaviour gaps:**
  - Inventory has no "Copy to folder" in the UI, though the server supports it.
  - Inventory's editor files an item with a plain text field instead of a
    folder picker.

### Document-store gaps

- **The listing route** (`GET /mount-points/{id}/files`) omits `linkGroupId`
  and ships the heavy `extractedText` with every row.
- **Hard links are invisible.** There is no "linked in N places" endpoint,
  and no UI offers linking (only the CLI and the API).
- **Folder operations are partial:**
  - There is no folder copy.
  - Folder move works within one mount only.
  - Folder delete refuses a folder that still has contents.
- **Viewing and editing:**
  - There is no docx viewer.
  - Document Mode opens only text files.
  - The classic UIs allow upload and delete only on database stores.
- **Data fetching.** No react-query keys exist for a store's detail or file
  listing. The Scriptorium page and the picker re-fetch by hand, so the
  `mountPoints` realtime topic cannot reach them.

## Design

### Layer 1: `lib/folder-browser/` (pure, client-safe)

This layer is the home for everything a browser computes without I/O.

- **Moves out of `lib/wardrobe/folder-view.ts`:**
  - Generic types: `FolderRowView`, `TierRowView`, `BrowserOrigin`.
  - Functions: `childFolderRows`, `tierRows`, `viewTierOf`, `tierLabel`.
  - `lib/wardrobe/folder-view.ts` becomes a re-export with Wardrobe names
    until its callers are moved over.
- **New `BrowserAction` vocabulary:** `edit | rename | move | copy | link |
  transfer-move | transfer-copy | archive | restore | duplicate | delete |
  open | download | …`.
  - A source declares which actions an entry supports, and the menu renders
    from that declaration.
  - Gating is done once, from a capability object: `canWrite`, `canDelete`,
    `canLink`, `canCopy` and so on. For document stores this is
    `deriveMountCapabilities` plus a mount-type check for links.
- **`previewKindOf(entry)`:** `image | pdf | docx | markdown | text |
  unsupported`. It extends `getPreviewType` from
  `components/files/FilePreview/types.ts`, which becomes a caller of it.

### Layer 2: `components/item-browser/` (shared React)

The existing five components stay. The following are added:

- **`useFolderBrowserState({ containerKey, items, folders, tierOf, folderOf })`**
  — the hoisted shell state:
  - current tier and folder, the selection `Set` keyed by view, search, and
    the new-folder draft;
  - the derived `folderRows`, `tierRows` and visible items;
  - `submitNewFolder`, `renameFolder` and `deleteFolder`, which call an
    injected `FolderMutations` port.

  `WardrobeBrowser` and `InventoryBrowser` keep only their own filters
  (slots, kits, equipped and so on).
- **`ItemActionMenu`** — one ⋮ menu built on `useFixedMenu`:
  - It has `role="menu"`, arrow and Home/End key navigation, Escape,
    outside-click close, and focus returning to the trigger.
  - Groups and dividers come from a declarative `MenuEntry[]`.
  - `ItemFolderRow` uses it too, which fixes the mouse-leave close.
- **`ItemRowShell`** — the parts every row shares: the select checkbox, the
  thumbnail slot, the title, the folder crumb shown on search hits, the
  borrowed/origin chip and the ⋮ menu. Wardrobe and Inventory rows become
  their own content inside it.
- **`DestinationPickerDialog`** — replaces `ItemFolderPickerDialog` and both
  transfer dialogs:
  - **Modes:** `move | copy | link`.
  - **Container:** an optional container select (General / Projects / Groups /
    Characters for item tiers; the accessible stores for documents). The
    current container is the default.
  - **Folder:** a folder tree for the chosen container, including
    "New folder…".
  - **Extras:** per-source extra controls go in `children`, such as the
    outfit-components fieldset.
  - **Data:** containers come from one `useContainerCatalogue(kind)` hook,
    using TanStack.
- **`FolderBrowserShell`** — the shared layout:
  - folder bar, then tier rows, folder rows and item rows;
  - the select bar with Move / Copy / Link / Delete;
  - the empty state and the sticky "+ New" footer.
  - Each browser passes its filter strip and row renderer.

### Layer 3: shared server folder layer

- **`ItemFolderLocation`** (`lib/mount-index/item-folder-location.ts`)
  - It is the folder half of a location: `listFolders`, `resolveFolder`,
    `createFolder`, `renameFolder`, `deleteFolder`, `writableMountPointId`,
    `updateMany`.
  - `WardrobeLocation` and `InventoryLocation` extend it.
  - `moveItemsToFolder` becomes a single generic `moveItemsToFolderIn(location, ids, folder)`.
  - The create/rename/delete wrappers become one `itemFolderMutations(location, rules)`.
- **Route factory.**
  - `itemFolderActionHandlers({ resolveLocation, errorResponse })` returns
    `create-folder`, `rename-folder`, `delete-folder` and `move-items`.
  - Both route factories spread them into `withActionDispatch`.
  - `copy-items` stays per kind: Wardrobe has outfit components; Inventory
    has `canCopy` and the kit rules.
- **Transfer logic.** Wardrobe's cross-tier transfer moves out of its route
  into `lib/wardrobe/transfers.ts`, matching the shape of
  `lib/inventory/transfers.ts`. The routes become thin, and a future
  `wardrobe_give` tool would have a function to call.

### Layer 4: document-store source

`components/document-browser/`:

- **`useDocumentStoreSource(mountPointId)`** — the document-store
  implementation of the browser's ports, built on TanStack.
  - New query keys: `mountPoints.detail(id)`, `mountPoints.files(id)` and
    `mountPoints.links(id, path)`.
  - These keys join `mountPoints` in `topic-map.ts`, so realtime reaches
    them.
  - The mutations call the existing verbs.
- **`DocumentStoreBrowser`** — `FolderBrowserShell` plus a `DocumentRow`
  showing the type icon or thumbnail, size, modified time, a
  "linked ×N" chip, and embedding/conversion status.
- **⋮ menu on files**, gated by capabilities:
  - Open / Preview
  - Rename
  - Move to… and Copy to…, both via `DestinationPickerDialog`, to any
    folder in this store or another
  - **Hard link to…**, offered only where it can succeed: database ↔
    database, or filesystem ↔ filesystem in the same store
  - Show links (where else this file appears; jump to it)
  - Unlink from group
  - Edit description (blobs)
  - Download
  - Re-embed
  - Delete
- **⋮ menu on folders:** Rename, Move to…, Copy to…, and Delete (with a
  recursive confirm).
- **`DocumentViewer`** — a dispatch over `previewKindOf`:
  - `FilePreviewImage`, `FilePreviewPdf` and `FilePreviewText` are reused.
  - **New `FilePreviewDocx`.** The server renders the file to HTML with
    `mammoth.convertToHtml` behind `GET files/<path>?render=html`. The HTML
    is sanitised on the server, and mammoth stays server-only. The viewer
    shows it read-only inside the prose styles.
  - Unsupported types fall back to the fallback viewer.

### API additions (`/api/v1/mount-points`)

- **Listing.** `GET [id]/files` returns `linkGroupId` and a `linkCount`
  (count of links sharing the `fileId`) and drops `extractedText`. Callers
  that need the text fetch it per file.
- **Links.** `GET [id]/files/<path>?action=links` returns where the file
  appears: `{ mountPointId, mountName, relativePath, grouped }[]`, from
  `findByLinkGroupId` and `findByFileId`.
- **Unlink.** `POST [id]?action=unlink-file {path}` detaches a link from its
  group. The link keeps its current content, and the next write forks it.
- **Folder copy and cross-mount folder move.**
  - `?action=copy-folder` and `?action=move-folder` gain a
    `destMountPointId`.
  - The implementation walks the folder and calls the existing per-file ops,
    with no new storage code.
  - Moving to another mount is copy then delete, and fails as one unit.
- **Recursive folder delete.** `?action=delete-folder {path, recursive: true}`.
  Every file goes through the existing per-file delete, so `deleteWithGC`
  still decides what is reclaimed.
- **docx render.** `GET [id]/files/<path>?render=html`, for `.docx` only.
- **Realtime.** Every file and folder op in the parent publishes
  `publishRealtime('mountPoints', id)`.

### Document Mode

- **Picker.** The browse step of `DocumentPickerModal` becomes
  `DocumentStoreBrowser` in a `pick` mode: navigate and select. Its ⋮ menus
  are still available, so housekeeping can happen without leaving the
  Salon. The source step and the `onSelectDocument` contract stay as they
  are.
- **Document pane.**
  - It opens text files as it does now.
  - For image, PDF and docx it shows `DocumentViewer` read-only, with a
    "read-only — view only" ribbon.
  - The chat's `open-document` action accepts these kinds. It records them
    as open, and they are never handed to an LLM as text. Characters
    already reach docx/PDF through the extracted text in the
    `doc_*` tools.

### Retired

- **SVAR:**
  - the `@svar-ui/react-filemanager` dependency;
  - `components/files/svar/`;
  - the beta toggle;
  - the `capabilities` block stays, since the new browser uses it.
- **`app/scriptorium/[id]/components/FileTable.tsx`.** Its detail-row
  features (description edit, Pascal's Workbench link) move into the ⋮ menu
  and the preview.
- **`FileBrowser`'s mount mode**, once `DocumentPickerModal` and its other
  mount callers are moved. Its legacy `/api/v1/files` mode is a separate
  clean-up.
- **The SVAR specs** move to `complete/`, marked superseded.

## Phases

Each phase lands green and on its own.

> **Phase 1 as built (2026-10-31).** Shipped: `lib/folder-browser/view.ts`,
> `useFolderBrowserState` / `useItemFolderHandlers`, `FolderBrowserShell`,
> `ItemActionMenu`, `ContainerSelect` + `useContainerCatalogue`,
> `ItemFolderField`; Inventory Copy to folder and editor folder picker;
> `WardrobeTransferDialog` on TanStack. Deferred:
>
> - **`ItemRowShell`.** The rows differ too much: wardrobe rows top-align,
>   expand composites and nest; inventory rows are single-line. With the
>   menu extracted, what is left in common is a checkbox and a chip, too
>   little to share.
> - **`DestinationPickerDialog`, `previewKindOf` and the `BrowserAction`
>   vocabulary.** These move to Phase 4, where they first have a caller.
>   Wardrobe and Inventory transfers cannot pick a destination folder (the
>   server keeps the folder path), and neither has a link mode, so building
>   these now would be speculative.
>
> `GET /api/v1/wardrobe/transfers` lost its only UI caller; Phase 2 removed
> it.

> **Phase 2 as built (2026-10-31).** Shipped as specified:
> `lib/mount-index/item-folder-location.ts` (`ItemFolderLocation`,
> `ItemFolderKind`, the generic folder mutations and `moveItemsToFolderIn`),
> `lib/mount-index/item-folder-routes.ts` (`itemFolderActionHandlers` for
> `create-folder`, `rename-folder` and `delete-folder`) and
> `lib/wardrobe/transfers.ts`. One departure: `move-items` stays per kind
> alongside `copy-items`, because the Wardrobe's moves go through
> `fileItemsToFolder`, which can carry an outfit's components.

1. **Shared client library.**
   - Build `lib/folder-browser/`, `useFolderBrowserState`, `ItemActionMenu`,
     `ItemRowShell`, `DestinationPickerDialog`, `FolderBrowserShell` and
     `useContainerCatalogue`.
   - Move Wardrobe and Inventory onto them. Visible changes are limited to
     the fixes: Inventory "Copy to folder", Inventory's editor folder
     picker, keyboard menus, and Escape on folder rows.
   - Existing browser tests must pass unchanged, apart from selectors.
2. **Shared server folder layer.** `ItemFolderLocation`, the generic
   move/folder mutations, the shared route folder actions, and
   `lib/wardrobe/transfers.ts`. No behaviour change.
3. **Mount-point API gaps.** Listing fields, the links endpoint,
   unlink, folder copy and cross-mount move, recursive delete, docx render,
   realtime publishes, and query keys. Unit tests per verb.
4. **Scriptorium browser.**
   - Build `DocumentStoreBrowser` and `DocumentViewer` (with
     `FilePreviewDocx`) and put them in the store detail view.
   - Delete SVAR and `FileTable`.
   - Verify live on V4test with a database store and a filesystem store.
5. **Document Mode.** Picker browse step, read-only viewers in the pane, and
   `open-document` for non-text kinds.
6. **Docs.**
   - Help docs: `help/scriptorium*.md`, the Document Mode help, and the
     Wardrobe/Inventory notes for the new menu items.
   - `CHANGELOG`, `API.md`.
   - Remove the SVAR specs and the memory entry.

## Open questions

1. **docx rendering.** Proposed: mammoth to sanitised HTML on the server,
   read-only. The alternative is client-side `docx-preview`, which gives
   better fidelity but is a new dependency of about 300 KB.
2. **Editing docx.** Proposed: no; view only. Converting to Markdown loses
   formatting.
3. **Document-store folder rows in Document Mode.** Proposed: full ⋮ menus
   in the picker too. The alternative is navigate-only there, keeping the
   menus in the Scriptorium.
4. **Drag and drop.** None exists in Wardrobe/Inventory today. Proposed:
   out of scope for this pass. It would be a later addition to
   `FolderBrowserShell` that every browser gets at once.

## Phase 3 as built (2026-10-31)

Shipped as specified, with these details settled:

- **Action name.** The DOCX render is `?action=render-html`, not
  `?render=html`. The per-file GET now dispatches through `dispatchAction`
  (`links`, `render-html`, fallback: read).
- **Sanitising the DOCX HTML.** The server only neutralises link targets.
  Mammoth escapes text and emits no script, but a link can carry
  `javascript:`. Full sanitising happens in the client with DOMPurify
  (already a dependency) in Phase 4, because there is no server-side DOM.
- **Folder moves between stores** go file by file through `moveFile`, not
  copy-then-delete. A database → database move then keeps each link's
  identity and hard-link group.
- **Live updates** are published from the `db-store-events` emitters, which
  already describe themselves as feeding UI refresh, as well as from the
  file and folder operations.
- **Not yet covered:** a change made outside Quilltap to a filesystem store
  (picked up by the watcher or a rescan) does not publish yet.

## Phase 4 as built (2026-10-31)

Shipped as specified, with these details settled:

- **Where things live.** `components/document-browser/`: `useDocumentStoreSource`, `DocumentStoreBrowser`, `DocumentRow`, `DocumentDestinationDialog`, `DocumentFileDialogs` (where else / description) and `DocumentViewer`. `DocumentViewer` is the body alone, so Phase 5's Document pane can host it; `DocumentViewerModal` wraps it for the Scriptorium.
- **`DestinationPickerDialog`** is `ItemFolderPickerDialog` renamed and generalised: a `link` mode, a `container` slot above the tree, and `containerKey` to reset the highlight. The Wardrobe and Inventory pickers use it unchanged. Their transfer dialogs still pick a container only, because those transfers keep the folder path.
- **`BrowserAction`** lives in `lib/folder-browser/document-actions.ts` and is used only by document rows. Wardrobe and Inventory rows keep their own richer menus.
- **Links shown.** "Where else", Unlink and the chip are offered only for a deliberate hard link (`linkGroupId`). Files that merely share a content row (identical bytes, most often empty files) are independent and are not marked. The chip carries no count, because `linkCount` includes coincidental sharers.
- **Hard link targets.** Database ↔ database between any stores; filesystem only within one store (a cross-store link may cross devices, which `linkFile` refuses as `EXDEV`).
- **Viewers.** Images and PDFs read `?raw=1`; text reads `?encoding=utf-8` (a text file stored as a blob reads as base64 by default); `.docx` reads `?action=render-html` and is sanitised with DOMPurify in `FilePreviewDocx`.
- **Uploads** go into the current folder on any writable store. On a filesystem store a file of a kind the store does not index is written to disk but not listed.
- **Fixes found live:**
  - `ItemActionMenu` now focuses with `preventScroll`. In a workspace tab, the focus scrolled the pane, and the scroll closed the menu.
  - Filesystem folder move and delete now carry `doc_mount_folders` rows along. Before, a moved or deleted folder lingered in the listing.
- **Live check (V4test):**
  - Database stores: viewers for image, PDF, `.docx` and Markdown; hard link into another store; Where else → Go there; unlink; delete; folder rename, copy to another store, and recursive delete.
  - A temporary filesystem store: an inode-sharing hard link, a folder move, and a recursive delete.

## Phase 5 as built (2026-10-31)

Shipped as specified, with these details settled:

- **Picker.** `DocumentStoreBrowser` gained `onPickFile` (Open hands the file over instead of viewing it) and `footerActions(currentFolder)` (the picker's New document here). The picker's own store tree, breadcrumb and new-folder form are gone. The project and general libraries still use `FileBrowser`; retiring its mount mode is the separate clean-up named under "Retired".
- **Which files are viewed.** `documentViewTargetFor` treats any store file that is not a text file (by `isTextFile`) as read-only. That covers images, PDFs and `.docx`, plus any other binary, which shows the fallback viewer with a download. A file outside a store (the legacy project and general areas) has no view target, because the viewer reads through the mount-point API.
- **Wire shape.** `open-document` and `read-document` return `{ content: '', viewer }`, where `viewer` is a `DocumentViewTarget` (`lib/folder-browser/document-actions.ts`). The `open-document` action and the `chat_documents` row are unchanged, so the open set, reconcile and reload work as before. `write-document` refuses a viewed file.
- **Model exposure.** None through Document Mode: the open announcement names the file only, and characters still reach a PDF's or `.docx`'s text through `doc_read_file`.
- **Fix found live.** Nested dialogs: a `BaseModal` now ignores an outside click or Escape that belongs to another dialog (target or focus inside one, or any open `alertdialog`).
- **Known, not changed:** a Markdown or text file stored as a blob in a database store (an upload through the blob route) cannot be opened in the editor, because `readDatabaseDocument` reads only the documents table. This predates the folder browser.
- **Live check (V4test):** an image from a vault picked through the browser opened in a read-only tab and survived a reload. A PDF opened through the chat API rendered in its pane, and a write to it was refused with a 400. Both closed from their own Close buttons. In the picker: Copy to… stacked over it, Escape and inner clicks closed only that dialog, and a delete confirmation's Cancel and Escape left the picker open.
