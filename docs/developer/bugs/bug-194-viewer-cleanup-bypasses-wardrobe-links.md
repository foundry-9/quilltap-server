# Bug 194 — the full-screen viewer's missing-picture cleanup bypasses wardrobe link cleanup

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-10-09, code audit for the [wardrobe refactor plan](../features/wardrobe-refactor.md) |
| **Fixed** | — |
| **Severity** | Medium — a wardrobe item is left pointing at a `files` row that no longer exists, and the dialog keeps showing the stale picture until something else refetches |
| **Who it bites** | anyone who opens a wardrobe picture whose bytes have gone missing and presses the placeholder's clean-up control |
| **Provenance** | Original to v4; introduced with the full-screen viewer (commit 01a83539d, 2026-10-09). `DeletedImagePlaceholder` predates wardrobe pictures and knows only avatars and overrides |
| **Defect site** | `components/images/FullScreenImageViewer.tsx:143` (`<DeletedImagePlaceholder … onCleanup={onClose}>`); `components/images/DeletedImagePlaceholder.tsx:34` (`DELETE /api/v1/images/${imageId}`); `app/api/v1/images/[id]/route.ts` (deletes the `files` row via `fileStorageManager.deleteFile`; never calls `deleteWardrobeItemImageLink`, never clears the item's `imageFileId`); the viewer's `onClose` invalidates no `queryKeys.wardrobe.*` key |
| **Fix site** | proposed: an `onMissingCleanup` override on `FullScreenImageViewer`; the wardrobe viewer passes its own `delete-image` action from `lib/wardrobe/item-images-client.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../bugs.md) |

---

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
