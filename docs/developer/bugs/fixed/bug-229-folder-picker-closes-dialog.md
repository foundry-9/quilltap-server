# Bug 229 — A click inside the Move-to-folder picker closes the whole wardrobe dialog

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-12)** |
| **Found** | 2026-10-12, live on `V4test` during the wardrobe-folders walkthrough (spec §6 C.4): in a chat's wardrobe dialog, ticking two items, choosing **Move to folder…** and clicking a folder in the picker closed the picker *and* the wardrobe; nothing moved |
| **Fixed** | 2026-10-12, v4.10-dev |
| **Severity** | Medium — no data is touched, but filing items into folders from a chat's wardrobe (the bulk move and the row ⋮ *Move to folder…*) cannot be done with a mouse at all |
| **Who it bites** | anyone moving wardrobe items to a folder from the floating wardrobe dialog. The Prospero Wardrobe card and the workspace Wardrobe tab render without a modal and were unaffected |
| **Provenance** | Original to v4. Came in with wardrobe folders (PR 85), which added the picker |
| **Defect site** | `components/wardrobe/WardrobeBrowser.tsx` (picker state held locally); `components/wardrobe/hooks/useWardrobeItemActions.ts` (`overlayOpen` did not count it); `components/wardrobe/wardrobe-control-dialog.tsx:397` (`closeOnClickOutside={!overlayOpen && !confirming}`) |
| **Fix site** | `components/wardrobe/hooks/useWardrobeItemActions.ts`, `components/wardrobe/WardrobeBrowser.tsx` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-12).** The picker's state moved into `useWardrobeItemActions` beside the
editor, transfer and image overlays (`folderPicker`, `openFolderPicker`, `closeFolderPicker`), and
`overlayOpen` now counts it, so the wardrobe dialog stops listening for outside clicks while the
picker is up. `WardrobeBrowser` reads and drives the picker through `actions`. Test:
`__tests__/unit/components/wardrobe/wardrobe-browser.folders.test.tsx` ("a click inside the picker
does not close the dialog around the browser"), which fails with `overlayOpen` forced false.

## Symptom

Open a chat's wardrobe, enter a folder, press **Select**, tick items, press **Move to folder…**. The
picker opens. Click any row in it (or **New folder…**, **Cancel**, **Move**): both the picker and the
wardrobe dialog vanish, and the items stay where they were.

## Root cause

`BaseModal` closes on a `mousedown` outside its own panel (`useClickOutside`). Every modal portals to
`document.body`, so a modal opened from inside another is, as far as the DOM is concerned, *outside*
it. The wardrobe dialog handles this by turning its click-outside off while any child overlay is
open — `closeOnClickOutside={!overlayOpen && !confirming}` — where `overlayOpen` comes from
`useWardrobeItemActions` (editor, transfer, image viewer) plus the dialog's own import-from-image
flag. The folder picker was added with its state in `WardrobeBrowser` (`useState` `picker`), so
`overlayOpen` stayed false while it was open. The `mousedown` of any click inside the picker reached
the wardrobe dialog's handler, which closed the dialog and unmounted the picker with it.

## Why it survived

The browser's RTL tests open the picker and check its rows with `fireEvent.click`, which dispatches
no `mousedown`, and they rendered the browser bare, with no enclosing modal. The live walkthrough for
the picker (spec §6 C.4) had not been run.

## Fix

One owner for "an overlay is open": the picker joins the hook's overlays rather than the dialog
growing a second channel for the browser to report through. The regression test renders the browser
inside a `BaseModal` wired as the dialog wires it and sends a real `mousedown` to a picker row.

## Verify

On `V4test`, open a chat's wardrobe, tick two items, **Move to folder…**, click a folder and **Move**:
the items move, the picker closes, the wardrobe stays open.
