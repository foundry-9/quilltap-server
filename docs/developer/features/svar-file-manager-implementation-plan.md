# SVAR File Manager — Implementation Plan

**Status:** Planning
**Author:** Charlie + Ariadne
**Last updated:** 2026-06-10
**Supersedes:** the early-May landscape survey (Chonky / Cubone / commercial rule-out → SVAR)

---

## What changed since the May conversation

The May plan assumed the SVAR interceptors would target a *to-be-built* file API.
That assumption is now mostly false. Commit **c528dba4** ("Canonical mount-point
file write pipeline + per-file REST item route", merged 2026-06-10) landed the
backend the interceptors need:

- **Per-file item route** `app/api/v1/mount-points/[id]/files/[...path]` —
  `GET` (utf-8 / base64 / raw / line-window), `PUT` (json or multipart),
  `DELETE`, `PATCH` (rename and/or description).
- **Action-dispatch verbs** on `POST /api/v1/mount-points/[id]?action=…`:
  `move-file`, `copy-file`, `link-file`, `write-file`, `delete-file`,
  `delete-folder`, `move-folder`, plus `scan` / `convert` / `deconvert` /
  `reindex` / `embed`.
- **Listing** `GET /api/v1/mount-points/[id]/files` returns `{ files, folders }`
  (folders enumerated from `doc_mount_folders` for database mounts and from disk
  for filesystem/obsidian mounts, so empty folders are visible).
- **Folder create** `POST /api/v1/mount-points/[id]/folders`.
- **Canonical ingest** `lib/mount-index/store-file.ts` (`storeMountFile`) with
  three collision strategies, mount-type-aware routing, transcode + extract +
  embed, dedup, mtime concurrency.
- Error model: `FileOpError` / `DatabaseStoreError` with codes mapped to HTTP by
  `lib/mount-index/file-op-status.ts` (`fileOpStatus`).

**Consequence:** the interceptor adapter is now mostly a *mapping* exercise (SVAR
events → existing REST calls), not a backend build. The bulk of remaining risk
moves to (1) the CSS variable bridge and (2) a handful of API-design gaps the
new routes don't yet cover (see Phase 1).

SVAR is **not yet in `package.json`** — first install happens in Phase 0.

---

## Architecture recap (unchanged from May, confirmed against code)

- **One component, two costumes.** `@svar-ui/react-filemanager` used twice:
  - *Heavy* — the Scriptorium page (`app/scriptorium/[id]/page.tsx`), full Finder
    chrome: split-pane, cross-pane copy/cut/paste, CRUD, drag-and-drop.
  - *Light* — the attach-a-file picker (replacing `FolderPicker.tsx` /
    `DocumentPickerModal.tsx` usage), constrained: navigate + select, no mutation.
- **Event-bus interceptor as the sole arbiter.** SVAR emits semantic ops
  (`rename-file`, `move-files`, `copy-files`, `delete-files`, …) via
  `api.intercept()`. A Quilltap adapter layer translates each to the REST calls
  above and decides filesystem-vs-database behaviour. The component stays
  agnostic; **all SVAR-specific code is quarantined in the adapter** (mitigates
  SVAR's youth — under a year of public history).
- **DB-primary IDs.** SVAR items are keyed by **mount-point id + relative path**,
  matching the item route's addressing (`/files/[...path]`). This is why Cubone's
  path-string-as-identity model was rejected and why SVAR's adapter pattern fits:
  we map, we don't adopt its identity model.

---

## Phase 0 — CSS variable bridge spike (2–3 days, throwaway)

**Goal:** prove `qt-*` tokens can restyle SVAR cleanly enough that `.qtap-theme`
bundles work **without per-theme SVAR overrides**. This is the single highest
uncertainty; it gates everything else.

**Do:**
1. `npm i @svar-ui/react-filemanager` (record exact version; pin it).
2. Drop a bare SVAR file manager into a throwaway Storybook story
   (`packages/theme-storybook`) wired to static mock data — no API.
3. Inventory SVAR's own CSS custom properties / class surface. Build a single
   bridge stylesheet mapping SVAR vars → `qt-*` semantic tokens (colors, radii,
   spacing, fonts, focus ring). **No hard-coded values** — only `qt-*` references,
   per the CLAUDE.md token rule.
4. Render under **all 6 bundled themes** (Art Deco, Earl Grey, Great Estate,
   Madman's Box, Old School, Rains) plus dark/light where the theme supports it.
   Madman's Box (dark-only, warm walnut/brass) is the stress case.

**Success criteria (decide go/no-go):**
- Every bundled theme renders SVAR legibly with **zero per-theme override CSS**.
- Split-pane, selection, drag affordance, and focus states all pick up theme
  tokens.
- Any SVAR surface that *can't* be reached by a `qt-*` var is enumerated — if the
  list is short and static, acceptable; if it's deep/structural, that's a
  red flag to revisit before Phase 2.

**Throwaway location:** spike story + bridge CSS live in a `spike/` branch;
nothing merges from Phase 0 except the documented findings and (if green) the
pinned dependency + the bridge stylesheet promoted into Phase 4.

---

## Phase 1 — API-design decisions (library-independent; can run parallel to Phase 0)

These are gaps the new routes don't fully close. Resolve as small backend PRs so
the adapter has a stable target.

1. **Per-mount capability flags.** The UI needs to know, per mount, what's
   allowed before it offers a verb (e.g. hide "paste" on a read-only mount,
   disable "convert" mid-conversion). Today the client must infer from
   `mountType` / `conversionStatus`. **Decision needed:** add a derived
   `capabilities` block to `GET /api/v1/mount-points/[id]` (e.g.
   `{ canWrite, canDelete, canMoveOut, canConvert, canCreateFolder }`) computed
   server-side from mount type + conversion status + (future) read-only flag.
   Single source of truth on the server; the light costume consumes the same
   block to gate to navigate-only.

2. **Cross-mount operation semantics.** `move-file`/`copy-file`/`link-file`
   already take `destMountPointId`. Define and document the matrix the adapter
   surfaces for split-pane cross-pane ops:
   - fs→fs same device: `fs-link`/`rename`; cross-device: `byte-copy` (already in
     `file-ops.ts`).
   - db→db: `db-link`.
   - fs↔db copy/move: routes through the cross-storage byte-copy branch in
     `file-ops.ts` (`writeDestBytes`), **not** a raw byte link.
   - **DECIDED (Charlie, 2026-06-10):** db→fs drag is **allowed**, surfaced as
     copy-with-extraction.

   **VERIFIED against `lib/mount-index/file-ops.ts` (2026-06-10):**
   - `linkFile` **already refuses** fs↔db: throws
     `FileOpError(..., 'UNSUPPORTED')` — "Cannot hard-link across storage types
     (filesystem ↔ database). Use copy instead." (file-ops.ts:598–603). It also
     throws `UNSUPPORTED` on cross-device fs→fs (`EXDEV`, 582–588). **No silent
     byte-copy fallback** — the doc comment states this refusal "is the whole
     point of `link` versus `copy`." → **Adapter responsibility:** on a link
     gesture, the UI must catch `UNSUPPORTED` and offer **copy** as the fallback;
     the backend will not paper over it.
   - `copyFile` cross-storage (fs↔db) byte-copies via `writeDestBytes`
     (file-ops.ts:379–385), routing db-destined native text → documents and
     binaries → blobs. This matches the db→fs "allow as copy" decision.

   **⚠ Ingest seam (new finding — fold into adapter + help docs):**
   Cross-mount copy/move is **byte-preserving**, NOT a fresh `storeMountFile`
   ingest. `writeDestBytes` does no transcode and does not itself enqueue
   extract/embed:
   - **fs→fs / fs→db copy:** dest-side `processMountFile` re-indexes the new
     path, so extraction/embedding does re-run on the fs side; but a fs→**db**
     copy stores the blob verbatim **without** the PDF/DOCX extract+embed that
     `storeMountFile` would trigger on a fresh upload.
   - **db→fs copy:** bytes land on disk; `processMountFile` re-extracts there.
   So "copy a PDF between mounts" and "upload that same PDF" can produce
   different extraction/embedding states.

   **DECIDED (Charlie, 2026-06-10):** the adapter **auto-reindexes** after a
   cross-mount copy/move whose dest is an extractable type. Implementation
   notes:
   - After a successful `copy-file` / `move-file` whose `result.strategy` is
     `byte-copy` (the cross-storage path) AND whose dest extension is extractable
     (`.pdf` / `.docx` / others `storeMountFile` would extract), the adapter
     fires `POST …/mount-points/<destId>?action=reindex` with
     `{ path: destRelativePath }`, then `?action=embed` for the same path
     (reindex re-extracts + re-chunks; embed enqueues the vectors — both are
     scoped by `path`, per the route).
   - Scope it to the **dest path only**, not the whole mount, so a drag of one
     file doesn't trigger a mount-wide rebuild.
   - Skip for `db-link` / `fs-link` / `rename` strategies (same content row or
     same inode — nothing to re-extract).
   - Fire-and-forget with debug logging; a reindex failure must NOT roll back the
     copy (the bytes are already safely placed). Surface a non-blocking "indexing
     the copy…" affordance and let the existing embed-status UI report progress.
   - Edge case: a fast second drag of the same dest path should not stack
     redundant reindex jobs — rely on the embedding scheduler's existing
     dedup/idempotency rather than the adapter tracking in-flight jobs.

3. **ID stability for filesystem-backed mounts.** DB mounts have stable file ids;
   fs mounts are addressed by path, and a rename changes the path. SVAR's
   selection/drag state keys off item id. **Decision needed:** the adapter keys
   items by `mountId:relativePath` and treats a rename as
   *invalidate-old + insert-new* in SVAR's model, re-reading the listing after
   any mutating op rather than trying to patch SVAR's in-memory tree by stable
   id. Confirms with the PATCH-rename response shape (returns new
   `relativePath`).

4. **Search routing per mount type.** Scriptorium search differs by backend:
   db mounts have `grep` over extracted text + semantic chunks; fs mounts have
   filename `find` + on-disk content. **Decision needed:** does the SVAR view get
   a search box at all in v1, or does search stay in the existing Scriptorium
   chrome outside the file manager? Recommend: **out of scope for v1** — keep the
   existing search UI, ship file-manager CRUD first. Documented as a deferred
   thread.

Each decision lands as: a short note in `docs/developer/` + the backend change +
debug logging on the new path (per CLAUDE.md logging rule) + help-file update if
user-visible + DDL/export check if any schema touches data.

---

## Phase 2 — Interceptor adapter layer (the core build)

Quarantine everything SVAR-specific here.

**New module:** `lib/scriptorium/svar-adapter/` (or `components/files/svar/`),
exporting:
- A factory that, given a mount-point id (+ capabilities), returns a configured
  SVAR `api` with `intercept()` handlers wired.
- A pure translation table: SVAR event → `{ method, url, body }` against the v1
  routes. No JSX here; unit-testable in isolation.
- A listing→SVAR-tree mapper: `{ files, folders }` from
  `GET …/files` → SVAR's expected node shape, keyed `mountId:relativePath`.
- Error translation: `FileOpError.code` → user-facing message (steampunk voice
  in any UI string, per the writing-style rule) + which SVAR op to roll back.

**Event → route map (draft):**

| SVAR event        | Route |
|-------------------|-------|
| read/open file    | `GET …/files/<path>` (utf-8 or raw) |
| create/upload     | `PUT …/files/<path>` or `POST …?action=write-file` (multipart) |
| save edit         | `PUT …/files/<path>` (with `expected_mtime`) |
| rename            | `PATCH …/files/<path>` `{ rename }` |
| delete file       | `DELETE …/files/<path>` |
| move (drag)       | `POST …?action=move-file` |
| copy (cross-pane) | `POST …?action=copy-file` |
| create folder     | `POST …/folders` |
| delete folder     | `POST …?action=delete-folder` |
| move folder       | `POST …?action=move-folder` |

**Concurrency:** plumb `expected_mtime` through save so the editor honours the
item route's optimistic-concurrency contract; surface 409 (`DEST_EXISTS`/
`CONFLICT`) as a "file changed on disk" prompt.

**Tests:** the translation table and tree mapper are pure → Jest unit tests with
no SVAR runtime. Integration happens in Phase 3.

---

## Phase 3 — Heavy costume: Scriptorium page

Replace the homegrown browser on `app/scriptorium/[id]/page.tsx`.

- Mount the SVAR component in split-pane mode wired to the Phase-2 adapter.
- Gate verbs by the Phase-1 `capabilities` block.
- Cross-pane copy/cut/paste across two mounts (the deciding feature) → the
  cross-mount op matrix from Phase 1.2.
- Retire `components/files/FileBrowser.tsx` (31 KB), `FileBrowserGrid.tsx`,
  `FileBrowserList.tsx` **only after** parity is confirmed. Keep `FilePreview/`,
  `FileThumbnail.tsx`, and the upload hooks unless SVAR subsumes them.
- Playwright coverage for: navigate, create folder, rename, delete, drag-move,
  cross-pane copy, edit+save with mtime conflict.

---

## Phase 4 — Light costume: attach-a-file picker + theme bridge promotion

- Reuse the **same** SVAR component, capability-gated to navigate + select, no
  mutation. **DECIDED (Charlie, 2026-06-10):** replace **both**
  `FolderPicker.tsx` *and* `DocumentPickerModal.tsx` with the light costume.
  Audit all call sites of each before retiring them.
- Promote the Phase-0 bridge stylesheet into the real theme layer; ensure it
  ships with the app and that `.qtap-theme` bundles override it through `qt-*`
  with **no per-theme SVAR CSS**.
- Reflect any new `qt-*` tokens in: the stylebook, `packages/theme-storybook`,
  `packages/create-quilltap-theme`, and the 6 bundled themes (per CLAUDE.md).

---

## Phase 5 — Docs, help, and cleanup

- Help files (`help/*.md`) for the new Scriptorium file manager and the picker,
  with correct `url` frontmatter + matching `help_navigate` call, in the
  steampunk/Wodehouse voice.
- Developer docs: update API.md (already documents the file API) with the
  adapter contract; document the SVAR-isolation boundary so future devs know not
  to leak SVAR types past the adapter.
- `docs/CHANGELOG.md` entries (terse, plain American English — the changelog
  exception to the writing style).
- EmbeddedPhotoGallery (`components/images/…`): decide separately whether the
  gallery folds into SVAR's grid view or stays its own thing. **Recommend
  deferring** — it's image-viewer UX, not file management; out of v1 scope.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| SVAR immaturity (<1yr public) | All SVAR code quarantined in Phase-2 adapter; pinned version; pure translation layer swappable if SVAR is abandoned. |
| Theme bridge can't cover SVAR's CSS surface | Phase-0 spike is explicitly go/no-go before any real integration. |
| fs↔db cross-mount semantics surprise users | Phase-1.2 defines the matrix; `link-file` must refuse fs↔db with a clear code. |
| Rename invalidating SVAR selection state | Adapter re-reads listing after mutations rather than patching by stable id (Phase 1.3). |
| Scope creep (search, gallery) | Both explicitly deferred out of v1. |

## Deferred out of v1
- In-file-manager search (search stays in existing Scriptorium chrome).
- EmbeddedPhotoGallery consolidation.
- Per-mount read-only flag as first-class persisted field (capabilities derived
  for now; persist later if a use case demands it).

## Resolved (Charlie, 2026-06-10)
1. db→fs drag: **allow** as copy-with-extraction. ✓
2. Light costume: replace **both** `FolderPicker` and `DocumentPickerModal`. ✓
3. `link-file` fs↔db: **verified** it refuses with `UNSUPPORTED` (no silent
   copy). Adapter must offer copy as the fallback on a link gesture. ✓

## Resolved (Charlie, 2026-06-10) — cont'd
4. Cross-mount copy ingest seam: adapter **auto-reindexes** the dest path after
   a cross-storage (`byte-copy`) copy/move of an extractable type. Scoped to the
   dest path, fire-and-forget, skipped for link/rename strategies. ✓

## Still open for Charlie
1. Phase 1 (API decisions) before Phase 0, or parallel? (Plan assumes parallel;
   the spike doesn't need the capability flags.)
