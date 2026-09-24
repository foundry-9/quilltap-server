# Bug 169 — in a narrow Salon pane, the first click inside the Scenario Builder closes it

| | |
|---|---|
| **Status** | OPEN |
| **Found** | 2026-09-24, the v5 port's review of its body-portaled builder dialogs (v5's P4.116, the `d1c06cd9d` smalls unification) |
| **Severity** | Medium — the dialog closes and an in-flight Host run is aborted, with no error shown; only in a narrow pane, but a split workspace pane is narrow on a desktop too |
| **Who it bites** | anyone who opens **Ask the Host to set the scene** (or its **Save as scenario…** dialog) from the Salon's chat sidebar while the chat pane is narrower than 640 px |
| **Provenance** | Original to v4. The narrow-pane overlay's outside-click collapse predates the Scenario Builder; the builder (`d1c06cd9d`) is the first dialog opened from inside the sidebar that portals out of it |
| **Defect site** | `components/chat/ChatSidebar.tsx:417-429` (the overlay's `pointerdown` handler) |
| **v5 status** | Fixed in v5 as a deliberate divergence (2026-09-24): `apps/web/src/app/chat/sidebar/chat-sidebar.ts` ignores a click whose target is inside a `.qt-dialog-overlay`; pinned by a unit spec and a live e2e beat at a 600 px viewport |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

In a Salon chat whose pane is narrower than 640 px, expand the chat sidebar (it opens as an
overlay), open the **Chat** card, and press **Ask the Host to set the scene**. The dialog opens.
Click anywhere in it, for example into the **Where** field, and the sidebar collapses to its strip
and the dialog disappears. If a build was running, it is aborted and no scene arrives. The
**Save as scenario…** dialog behaves the same way.

## Root cause

When the chat pane is narrow, `ChatSidebar` renders as an overlay and installs a capture-phase
`pointerdown` listener on `document` that collapses it on any click outside the panel:

```ts
if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) setNarrowOpen(false)
```

`ScenarioBuilderDialog` and `SaveScenarioDialog` are `BaseModal`s, and `BaseModal` renders through
`createPortal(…, document.body)` (`components/ui/BaseModal.tsx:100-125`). React portals keep
React-tree event bubbling, but the DOM `contains` check works on the real DOM. The dialog is a
child of `<body>`, not of the sidebar, so every click inside it counts as outside the panel.

Collapsing returns the `CollapsedStrip` early (`ChatSidebar.tsx:442`). That unmounts the expanded
sections, including `ChatScenarioControl` (`:1213`), which owns the dialog (`ChatScenarioControl.tsx:359`).
`useScenarioBuilderRun`'s unmount effect then aborts the run
(`components/scenario-builder/hooks/useScenarioBuilderRun.ts:51`).

## Why it survived

The builder was exercised in wide panes, where the sidebar is not an overlay and the listener is
not installed. Every other sidebar affordance renders inside the panel.

## The fix

Treat a click inside a dialog overlay as belonging to that dialog, not as a dismissal of the
sidebar:

```ts
const onPointerDown = (e: PointerEvent) => {
  const target = e.target as Node
  if (!sidebarRef.current || sidebarRef.current.contains(target)) return
  if (target instanceof Element && target.closest('.qt-dialog-overlay')) return
  setNarrowOpen(false)
}
```

`.qt-dialog-overlay` is `BaseModal`'s outermost element (`BaseModal.tsx:101`), so this covers the
dialog and its backdrop. A backdrop click still closes the dialog through `BaseModal`'s own
handler, and the sidebar stays open behind it.

## Verification

- Unit: with the sidebar forced into overlay mode, a `pointerdown` inside a body-level
  `.qt-dialog-overlay` leaves it open, and one elsewhere collapses it.
- Live: at a 600 px viewport, open the builder from the sidebar, fill **Where** and **When**,
  **Set the scene**, and confirm the review pane arrives with the sidebar still open. Then
  **Use this scene** fills the Chat card's custom box.

## Related, not fixed here

The overlay's `keydown` listener collapses the sidebar on **Escape** from anywhere, including
inside the dialog. `BaseModal` also closes on Escape, so the user sees the dialog close either
way, but the sidebar collapses with it. v5 keeps this behaviour, matching v4.
