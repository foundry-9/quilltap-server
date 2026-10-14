/**
 * Narrow-pane sidebar overlay: which pointer-downs dismiss it.
 *
 * The overlay collapses on a click outside its panel. Dialogs opened from inside
 * the sidebar (the Scenario Builder, Save as scenario…) are `BaseModal`s, which
 * portal to `<body>`, so the DOM `contains` check alone calls every click in them
 * "outside" — collapsing the sidebar unmounts the dialog's owner and aborts any
 * run in flight (bug 169). A click inside a `.qt-dialog-overlay` belongs to that
 * dialog, not to the page behind the sidebar.
 */

/** `BaseModal`'s outermost element — covers the dialog and its backdrop. */
export const DIALOG_OVERLAY_SELECTOR = '.qt-dialog-overlay'

export function shouldDismissSidebarOverlay(panel: Node | null, target: EventTarget | null): boolean {
  if (!panel || !(target instanceof Node)) return false
  if (panel.contains(target)) return false
  const element = target instanceof Element ? target : target.parentElement
  return !element?.closest(DIALOG_OVERLAY_SELECTOR)
}
