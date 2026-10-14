# Bug 194 — the full-screen viewer's missing-picture cleanup bypasses wardrobe link cleanup

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-09)** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../../features/complete/wardrobe-refactor.md) |
| **Fixed** | 2026-10-09, v4.10-dev |
| **Severity** | Medium — a wardrobe item is left pointing at a `files` row that no longer exists, and the dialog keeps showing the stale picture until something else refetches |
| **Who it bites** | anyone who opens a wardrobe picture whose bytes have gone missing and presses the placeholder's clean-up control |
| **Provenance** | Original to v4; introduced with the full-screen viewer (commit 01a83539d, 2026-10-09). `DeletedImagePlaceholder` predates wardrobe pictures and knows only avatars and overrides |
| **Defect site** | `components/images/FullScreenImageViewer.tsx:143` (`<DeletedImagePlaceholder … onCleanup={onClose}>`); `components/images/DeletedImagePlaceholder.tsx:34` (`DELETE /api/v1/images/${imageId}`); `app/api/v1/images/[id]/route.ts` (deletes the `files` row via `fileStorageManager.deleteFile`; never calls `deleteWardrobeItemImageLink`, never clears the item's `imageFileId`); the viewer's `onClose` invalidates no `queryKeys.wardrobe.*` key |
| **Fix site** | `components/images/FullScreenImageViewer.tsx` (new `onMissingCleanup` prop, handed to `DeletedImagePlaceholder` as `onRemove`); `components/images/DeletedImagePlaceholder.tsx` (`onRemove` override of the generic delete); `components/wardrobe/wardrobe-image-viewer.tsx` (passes `deleteWardrobeItemImage` from `lib/wardrobe/item-images-client.ts` and invalidates `queryKeys.wardrobe.all`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-09).** `FullScreenImageViewer` takes an `onMissingCleanup` override, which it
hands to `DeletedImagePlaceholder` as `onRemove`; with it set, the placeholder's Remove runs that instead
of `DELETE /api/v1/images/{id}`. `WardrobeImageViewer` passes its own: the images route's `delete-image`
action (`deleteWardrobeItemImage` in `item-images-client.ts`), which drops the mount link and the `files`
row and moves the item's `imageFileId` to the next-newest picture, then invalidates
`queryKeys.wardrobe.all`. Every other viewer keeps the generic delete. The default export of
`wardrobe-image-viewer.tsx` was removed. Tests in
`__tests__/unit/components/wardrobe/wardrobe-image-viewer.missing-cleanup.test.tsx`.

## Symptom

A wardrobe picture's blob is gone (a restore that lost files, a hand-pruned
store). The viewer shows the deleted-image placeholder with its clean-up
control. Pressing it removes the `files` row through the generic images
route. The item's `imageFileId` still names that row, its doc-mount link is
still there, and the dialog's thumbnail still tries to load it.

## Root cause

The generic viewer reuses `DeletedImagePlaceholder`, whose cleanup is
hard-wired to the images route. Wardrobe pictures have their own ownership
(a link in the item's container, a current-picture pointer on the item) and
their own delete action (`deleteWardrobeItemImage`), which the viewer has no
way to be told about.

## Why it survived

New code; the case needs a missing blob to reach.

## Fix (proposed)

`FullScreenImageViewer` accepts `onMissingCleanup?: () => Promise<void>`;
when present the placeholder calls it instead of the images route. The
wardrobe viewer passes `() => deleteWardrobeItemImage(container, itemId,
fileId)` and invalidates `queryKeys.wardrobe.images(…)` on success.

## How to verify

Delete a wardrobe picture's blob by hand on V4test, open it in the viewer,
run the cleanup: the item's `imageFileId` must be null and its link row gone.
