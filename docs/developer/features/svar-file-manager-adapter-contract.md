# SVAR File Manager — Adapter Contract (backend-facing decisions)

**Status:** Phase 1 landing (library-independent backend decisions)
**Parent plan:** [svar-file-manager-implementation-plan.md](svar-file-manager-implementation-plan.md)
**Last updated:** 2026-06-10

This note pins the backend-side contracts the future SVAR adapter
(`components/files/svar/`, Phase 2) will target. They are deliberately
library-independent: none of this imports SVAR, and all of it is verifiable
without the file-manager UI. The adapter is the *only* place SVAR-specific code
may live; nothing outside `components/files/svar/` should import a `@svar-ui/*`
type.

---

## 1. Per-mount capability flags (Phase 1.1 — landed)

`GET /api/v1/mount-points/[id]` now returns a derived, **non-persisted**
`capabilities` block alongside `mountPoint`:

```jsonc
{
  "mountPoint": {
    "...": "…existing DocMountPoint fields…",
    "embeddedChunkCount": 0,
    "capabilities": {
      "canWrite": true,        // upload / save / write into this mount
      "canDelete": true,       // delete files or folders
      "canCreateFolder": true, // create new folders
      "canMoveIn": true,       // may be the DEST of a copy/move
      "canMoveOut": true,      // may be the SOURCE of a copy/move
      "canConvert": true       // offer convert (fs→db) / deconvert (db→fs) now
    }
  }
}
```

- **Single source of truth:** computed server-side by
  `deriveMountCapabilities()` in [`lib/mount-index/capabilities.ts`](../../../lib/mount-index/capabilities.ts).
  The client never re-derives — both costumes (heavy Scriptorium browser, light
  picker) consume the same block. The light costume forces navigate-only by
  ignoring every mutating flag.
- **Derivation:** a mount is *quiescent* when `enabled && conversionStatus ∉
  {converting, deconverting}`. All mutating verbs require quiescence;
  `canConvert` additionally requires `scanStatus !== 'scanning'`, mirroring the
  guards already enforced in `handleConvert` / `handleDeconvert`.
- `canMoveIn` / `canMoveOut` are split so cross-pane copy/paste can gate each
  pane independently (a destination mid-conversion must refuse a paste even if a
  read source would be tolerable). Both stay conservative for v1.
- **No DDL / export / `.qtap` / backup impact** — the block is derived at
  response time, not stored.
- A future persisted per-mount `readOnly` flag (currently deferred) threads
  through the same helper as `&& !mp.readOnly`; the helper stays the one place
  the policy lives.

## 2. Cross-mount copy ingest seam → adapter auto-reindex (Phase 1.2)

Cross-mount copy/move is **byte-preserving**, not a fresh `storeMountFile`
ingest. `writeDestBytes` (`lib/mount-index/file-ops.ts`) copies bytes without
transcode and does not itself enqueue extract/embed. The consequence:

- **fs→fs and db→fs** copy/move already call `processMountFile` on the
  destination, so extraction/embedding re-runs there — nothing extra needed.
- **fs→db** copy/move of an extractable type (`.pdf` / `.docx`) stores the blob
  **verbatim**, skipping the PDF/DOCX text-extract + embed that a fresh upload
  through `storeMountFile` would trigger. This is the only genuinely lossy path.

**Adapter responsibility (Phase 2):** after a successful `copy-file` /
`move-file` whose `result.strategy === 'byte-copy'` **and** whose destination
extension is extractable, fire `POST …/mount-points/<destId>?action=reindex`
with `{ path: <destRelativePath> }`, then `?action=embed` for the same path
(both verbs already accept a scoped `{ path, force }` —
`reindexLinks` / `enqueueEmbeddingJobsScoped`).

- Scope to the **dest path only** — never a mount-wide rebuild for one file.
- **Skip** `db-link` / `fs-link` / `rename` strategies (same content row / same
  inode — nothing to re-extract).
- **Fire-and-forget** with debug logging. A reindex failure must **not** roll
  back the copy — the bytes are already safely placed. Surface a non-blocking
  "indexing the copy…" affordance; the existing embed-status UI reports
  progress.
- **Dedup:** rely on the embedding scheduler's existing idempotency, not
  adapter-side in-flight tracking, so a fast second drag of the same dest path
  doesn't stack redundant jobs.

The extractable set is effectively `{.pdf, .docx}` for v1; keep the predicate in
one place in the adapter so the list can grow.

## 3. ID-stability keying contract (Phase 1.3 + Phase 3 correction)

DB mounts have stable file ids; filesystem mounts are addressed by path, and a
rename changes the path. SVAR's selection/drag state keys off item id, so the
adapter treats **every** mutating op (rename / move / delete / create) as
*invalidate-old + re-read listing*, never an in-place patch of SVAR's in-memory
tree by a "stable id".

**Node-id scheme (corrected in Phase 3):** SVAR builds its tree from the root by
splitting the id on `/`, so a node id is the **mount-relative path as a SVAR
absolute path** — `/Research/doc.pdf`, with top-level items as one-segment ids
under the "My files" root. The earlier `/<mountId>/<relativePath>` idea orphaned
the entire tree under a non-existent `<mountId>` folder. Identity is still
`(mountId, relativePath)`, but the **mount id rides in the costume's config**
(`AdapterConfig.mountId`), not in the id string; the adapter's resolver supplies
it. Consequence: the wired adapter is **single-mount** for v1. The pure
`event-route-map` remains cross-mount-capable (its resolver can return different
mount ids), so true cross-pane/cross-mount work is a later wiring change, not a
rewrite.

This is already supported by the backend, no change required:

- `PATCH …/files/[...path] { rename }` returns the **new** `relativePath` in its
  response (`app/api/v1/mount-points/[id]/files/[...path]/route.ts`), and already
  logs the `from → to` transition at info level.
- After any mutation the adapter re-reads `GET …/files` (which returns
  `{ files, folders }`, folders enumerated so empty folders stay visible) and
  rebuilds the keyed node set.

## 4. Light-costume picker integration (Phase 4 audit)

The light costume is built: `components/files/svar/SvarFilePicker.tsx` (readonly
`<Filemanager>`, navigate + select, reports the pick via `wirePickerSelection`
on `select-file` single-click and `open-file` double-click). Wiring is
unit-tested; full real-click interaction is a Playwright item (the preview's
synthetic clicks don't trigger SVAR's pointer-based grid selection). Theme bridge
promoted to `components/files/svar/svar-theme-bridge.css` (co-located + unlayered
+ `:root .wx-willow-theme` specificity, so it beats SVAR's unlayered CSS — a
`@layer components` file would *lose*).

**Why the two picker swaps are staged, not done blind:**

- **`FolderPicker.tsx`** (1 call site, `MoveToProjectModal.tsx`) is a `<select>`
  over the **legacy** `/api/v1/files/folders?projectId=` + `/api/v1/projects/[id]/files`
  APIs — NOT mount-points. Replacing it with `SvarFilePicker select="folder"`
  needs (a) the project's `mountId` (post project-store-cutover the project has
  an official store), and (b) `MoveToProjectModal`'s move to target that mount
  rather than the legacy file API. Blocked on those two decisions + live verify.

- **`DocumentPickerModal.tsx`** (807 lines, 1 call site, `app/salon/[id]/page.tsx`)
  is a **two-step** modal: a rich SOURCE picker (character vaults, group files,
  recent docs, project library, db + fs stores) → a BROWSE step. Only the BROWSE
  step is a file browser; the SOURCE step is bespoke and must stay. Recommended
  surgical integration: drop `SvarFilePicker` into the BROWSE step for a chosen
  mount/store (replacing the custom folder-tree at ~lines 642-792), preserving
  the `onSelectDocument(params)` contract and the SOURCE step. Stage behind the
  same opt-in pattern as the heavy costume; do NOT retire `FileBrowser.tsx` until
  the picker's `project`/`general` (legacy `/api/v1/files`) scopes are migrated to
  mounts or kept as a fallback. This is a critical user surface (chat) — verify
  live before flipping the default.

## 5. Search routing — deferred out of v1

Scriptorium search differs by backend (db mounts: `grep` over extracted text +
semantic chunks; fs mounts: filename `find` + on-disk content). For v1 the file
manager gets **no** search box — the existing Scriptorium chrome / client-side
`FileTable` filter stays. Documented here as a deferred thread, not a gap.

## 6. Status, remaining work, and deferred items (Phase 5)

**Landed + verified (unit + throwaway browser harness):** the dependency (MIT,
pinned), the `capabilities` block, the adapter pure layer + the wired heavy
costume (`SvarFileManager`, behind the opt-in "New file manager (beta)" toggle on
`/scriptorium/[id]`), the light costume (`SvarFilePicker`), and the promoted
theme bridge. 56 adapter unit tests; `tsc` clean.

**Remaining — needs a running instance + a real mount:**
- **In-Next render verification** of both costumes (the harness proves the React
  + SVAR + adapter integration, not Next's bundling). If Next's bundler balks at
  SVAR's ESM/CSS, add `transpilePackages: ['@svar-ui/react-filemanager', …]` to
  `next.config.js`. The opt-in + lazy (`ssr:false`) mounting means the default
  `FileTable` path is unaffected regardless.
- **Playwright** for the heavy costume (navigate/create/rename/delete/drag-move/
  mtime-conflict) and the light costume's real-click selection (the preview's
  synthetic clicks don't trigger SVAR's pointer-based grid selection — the
  selection *logic* is unit-tested via `wirePickerSelection`).
- **Picker swaps** (`FolderPicker`, `DocumentPickerModal`) — staged per §4;
  entangled with legacy `/api/v1/files` + the bespoke source picker. Flip behind
  an opt-in and verify live before retiring anything.

**Deferred (out of v1):**
- **User help docs** for the new file manager / picker are deliberately deferred
  until the feature is verified in-Next and promoted out of "beta" — writing
  user-facing help for an unverified opt-in preview would mislead. The conversation
  Scriptorium help (`help/scriptorium.md`, url `/settings?tab=chat`) covers
  Document Mode + the *current* Open Document picker; it should be revised only
  when the light costume actually replaces that picker.
- **Retire `FileBrowser.tsx` / `FileBrowserGrid` / `FileBrowserList`** only after
  the picker swaps land and parity is confirmed (it still serves `/files`,
  Prospero project Files cards, and the library picker over the legacy API).
- **EmbeddedPhotoGallery** consolidation — image-viewer UX, not file management.
- **In-file-manager search** (§5) and **cross-mount split-pane** (the route-map
  is ready; the wiring is single-mount for v1).

**Throwaway:** `spike/svar-bridge/` (the esbuild harness — theme sweep, real
component, picker smoke tests) is development-only and must not merge to `main`;
its `dist/` + generated CSS are git-ignored. Only `_svar-bridge.css`'s content
graduated (now `components/files/svar/svar-theme-bridge.css`).
