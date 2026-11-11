# Refactor 4.13 — One modal shell

**Status:** Implemented (2026-11-11) on `claude/ecstatic-thompson-8r7d62`; as built in §8. Browser verification not yet done. Proposed 2026-11-10, written against `HEAD` = 167d06503. Part of the [4.13 refactor set](refactor-4-13.md). Fixes #171 and closes the class behind bugs 40, 99 and 229.

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

## 8. As built (2026-11-11)

**Decisions taken** (§7): the proposed answers. Backdrop click closes by default; `busy` and dialogs holding typed input opt out (`closeOnClickOutside={false}`). One z-index for every dialog, stacking by DOM order — with one exception: `lib/alert.tsx`'s alert and prompt are raised to `z-[100]`, because they are summoned imperatively and a confirm asked from inside the `ImageModal` lightbox (z-[100]) must paint above it.

**Re-measured scope.** 41 un-portaled files plus 20 portaled hand-built ones (not 52); about 57 dialogs. All moved; `node scripts/check-modal-shell.mjs` reports none left.

**The shell** (`components/ui/BaseModal.tsx`):

- Props added as in §5.1: `role`, `subtitle`, `busy`, sizes `5xl` / `6xl` / `7xl` / `wide`, `headerless`. The backdrop knob kept its existing name, `closeOnClickOutside` (48 call sites), rather than becoming `closeOnBackdrop`. Also added: `headerActions`, `bodyClassName` / `footerClassName` (replace the defaults, for split panes and dialogs whose own layout did not fit), `data-testid`.
- `headerless` dialogs name themselves with `<ModalTitle>`, which reads the shell's title id from context. A title that was an `h3` is now an `h2` with the same classes.
- **The stack is the DOM order of open modals** (`data-qt-modal`). Every modal paints at the same z-index, so the one later in the document is on top; nothing keeps a list. Only the topmost answers Escape or an outside click. Focus or a click still in a BaseModal beneath does not make it the owner — that is what lets a child that has not yet taken focus answer Escape. A non-BaseModal dialog (a lightbox, the floating Brahma console) or an open `alertdialog` still owns events as before.
- **A modal stands down while its kept-alive workspace tab is hidden** (`useWorkspaceTabVisible`). Portaling to the body would otherwise float a dialog opened in one tab over the tab the user moved to. The caller's state is untouched, so the dialog returns with the tab. Not in the spec; found while migrating the Photos detail dialog.
- The overlay carries `p-4`, so a dialog keeps a margin on a phone; most hand-built overlays had it.

**`WizardModal`** (`components/ui/WizardModal.tsx`): step line, busy guard, Back / Cancel / forward footer, `done` → one Close. Export, import, restore, backup and delete data use it. The Almanack and the import wizard are plain `BaseModal`s (the Almanack is a viewer; the import wizard shows no footer at all while working). `footer={null}` means no footer.

**Fallout fixed alongside:** `lib/alert.tsx` mounted a second backdrop root under its dialogs (gone; test updated); `FilePreviewActions` answered Escape from a window listener that ignored the stack (Escape removed there; arrows stay); the file preview's `aria-labelledby` pointed at nothing; `MemoryCascadeDialog` used an undefined `qt-dialog-content` class and drew no box.

**Look changes, deliberate or unavoidable:** delete data, the Workbench conflict prompt, the destination picker and the progression editor now wear the standard `qt-dialog` surface instead of one-off `qt-card` boxes; the Almanack is `h-[90vh]` and lost its hand-rolled body scroll lock; the import wizard's step indicator moved from the header to the top of the body; several dialogs went from `max-h-[85vh]` to the shell's 90vh; `WardrobeModeChangePrompt` from 420px to `md`.

**Tests:** `__tests__/unit/components/ui/BaseModal-shell.test.tsx` (portal, labels, `alertdialog`, `headerless`, `busy`, Escape without backdrop, the stack: child click, Escape before focus moves, backdrop with a child open; `WizardModal`), the existing `BaseModal-layered.test.tsx`, and `__tests__/unit/components/chat/AddCharacterDialog-summon.test.tsx` for #171 (real Add Character and Summon from Lore).

**Still owed:**

- The browser check of §6 on V4test (workspace tab and plain route: above the toolbar, focus trapped and restored) and `/release-checklist-13-ui`'s dialog section.
- Shell wishes from the migration, not done: a `maxHeight` prop (five dialogs use `!max-h-[80vh]` / `!max-h-[92vh]`), an arbitrary width (the photo gallery uses `!max-w-[90vw]`), an optional body scroll lock.
- `FullScreenImageViewer` never takes focus and is not in the stack, so `PhotoGalleryModal` keeps a `closeOnEscape={!childOpen}` guard. Folding the lightboxes into one viewer (the follow-up in the index) should mark it as a stack member.
- `ItemControlDialogShell`'s `overlayOpen` lock is now redundant with the stack; harmless, left alone.
