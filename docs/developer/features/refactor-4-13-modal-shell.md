# Refactor 4.13 — One modal shell

**Status:** Proposed (2026-11-10), written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #171 and closes the class behind bugs 40, 99 and 229.

Counts and line numbers are the audit's and will drift. Re-run the greps in §4 before starting and correct them here.

## 1. The problem

CLAUDE.md's accessibility rule: a new modal is `BaseModal`, or a hand-built overlay with `role="dialog"`, `aria-modal`, `aria-labelledby`, `useDialogFocus`, closing on Escape. The memory note on workspace overlays adds: `.qt-workspace` has `isolation: isolate`, which traps a modal's z-index under the sticky toolbar unless it portals to `document.body`.

62 files use `BaseModal`. 52 files (about 57 dialogs) still hand-spell the overlay: `useId` + `useDialogFocus` + `useEscapeKey` + overlay markup + role and aria attributes. They disagree on every point the rule leaves to the author:

| Point | Hand-built dialogs today |
|---|---|
| Portal to `document.body` | 20 of 52. The other 32 paint under `.qt-page-toolbar` (z-30) inside the workspace. |
| Escape with stacked dialogs | Only `BaseModal` has "topmost answers" (`components/ui/BaseModal.tsx:98-102`). |
| Backdrop click closes | About half. |
| Click-outside with a child dialog open | Per-dialog guards; `AddCharacterDialog` guards the NPC dialog but not Summon from Lore (#171). |
| z-index | z-40 up to z-[100]. |
| Busy guard on close | Some; `backup-dialog.tsx` has none where its siblings do. |

Two with controls in the top strip are the worst affected by the missing portal: `components/files/FilePreview/FilePreviewModal.tsx:139-150` (its action bar is the top row; also no Escape and no `useDialogFocus`) and `PhotoDetailModal` in `app/photos/PhotosView.tsx:473-656` (no `useDialogFocus`; its window Escape listener fires while the tab is hidden).

A sub-family repeats a further 35 lines each: six tools dialogs spell the same wizard shell (`export-dialog.tsx:91-135`, `import-dialog.tsx:95-135`, `backup-dialog.tsx:81-115`, `restore/RestoreDialog.tsx:184-225`, `capabilities-report-dialog.tsx`, `delete-data-card.tsx:187ff`), with the cluster `qt-dialog-overlay !p-0 border-none cursor-default z-40` in five of them.

## 2. Goal

Every dialog in the app is `BaseModal` or a named variant of it. The shell owns portal, focus, Escape stacking, backdrop behaviour and z-index; a dialog supplies a title, a body and a footer.

## 3. Non-goals

- The two startup gates in `components/startup/*` (outside the workspace, before providers exist).
- Popovers, menus and typeaheads. They are not dialogs.
- Lightboxes: `components/chat/ImageModal.tsx` and `images/image-detail/ImageDetailModal.tsx` should fold into `images/FullScreenImageViewer.tsx`, but that is a different shell; listed in the [index](refactor-4-13.md) as a small follow-up.
- Restyling. A dialog looks the same after it moves.

## 4. Known state

Re-measure with:

```bash
ggrep -lE "fixed inset-0|qt-dialog-overlay" -r app components --include=*.tsx
ggrep -lE "createPortal|BaseModal" -r app components --include=*.tsx
```

The first list minus the second is the set this spec is about. Verified by reading (2026-11-10): `AddCharacterDialog.tsx:182-185` enables `useClickOutside` on `isOpen && !isCreateNPCOpen` and its close-reset (`:118-127`) does not reset `isSummonOpen`.

## 5. Design

### 5.1 What `BaseModal` needs first

`components/ui/BaseModal.tsx:19-43` today lacks what the hand-built dialogs use. Add, each as a prop with the current behaviour as default:

- `role?: 'dialog' | 'alertdialog'` (nine files use `alertdialog` for destructive confirms);
- `subtitle?` slot;
- `busy?: boolean`: while true, Escape, backdrop and the close button do nothing;
- `size: '5xl'`;
- `headerless?` variant for dialogs that draw their own header;
- `closeOnBackdrop?: boolean`, default settled in §8.

A child dialog opened from inside a `BaseModal` must not count as "outside" its parent. The shell's stack (the same one that makes Escape topmost-only) answers that: a click is outside only for the topmost dialog. That removes per-dialog `enabled: isOpen && !isChildOpen` guards and fixes #171's class.

### 5.2 `WizardModal`

A thin wrapper over `BaseModal` for the six tools dialogs: step indicator, body, back / next / close footer, busy guard. Removes the five copies of the overlay cluster.

### 5.3 Migration order

1. `AddCharacterDialog` (#171), `FilePreviewModal`, `PhotoDetailModal`: user-visible defects.
2. The six tools dialogs onto `WizardModal`.
3. The `alertdialog` confirms.
4. The remainder, by directory, in batches small enough to check in a browser.

Each migrated file should delete its `useId` / `useDialogFocus` / `useEscapeKey` / overlay markup and gain nothing but a `BaseModal` element.

### 5.4 A gate so it stays done

A lint script beside `scripts/check-qt-classes.mjs`, wired into `npm run lint`: a `.tsx` file under `app/` or `components/` that contains `qt-dialog-overlay` or `fixed inset-0` and neither imports `BaseModal` nor appears in a short allowlist (the startup gates, the lightbox viewer) fails. Update CLAUDE.md's accessibility paragraph to say a modal is `BaseModal`, with the allowlist as the only exception.

## 6. Tests and gates

- `BaseModal` tests for each new prop, for stacking (Escape closes only the topmost; a click inside a child is not outside the parent), and for `busy`.
- A component test for #171: with Summon from Lore open, a mousedown inside it does not close Add Character.
- Browser check on V4test in both a workspace tab and a plain route: each migrated dialog opens above the toolbar, traps focus, restores focus on close.
- `/release-checklist-13-ui` is the full accessibility check; run its dialog section.
- Expected size: 600–800 lines removed; low risk per dialog, which is why the batches are small.
- CHANGELOG cites `#171`. No help-doc change.

## 7. Decisions for the human

1. Backdrop click: closes by default with `busy` and dirty forms opting out (proposed), or never closes?
2. One z-index for all dialogs, with stacking by DOM order (proposed), or keep a higher tier for confirms?
