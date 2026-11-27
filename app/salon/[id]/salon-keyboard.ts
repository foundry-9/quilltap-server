/**
 * Who answers the Salon's document-level keyboard shortcuts.
 *
 * The workspace keeps hidden Salon tabs mounted, and each mounted Salon
 * registers its own `document` keydown listeners, so without a gate one
 * Cmd+Shift+T opened a terminal in every open chat (#263). A Salon answers a
 * shortcut only while the focused pane is showing it, or one of its own child
 * tabs (its terminal or a document it opened). Outside the workspace (the
 * single-chat route) there is only one Salon, and it always answers.
 *
 * Escape belongs to whatever dialog it was pressed in: `BaseModal` closes on a
 * bubbling `document` listener too, so the Salon's Escape handlers would
 * otherwise also drop a maximized pane back to split (#304).
 *
 * @module app/salon/[id]/salon-keyboard
 */

import type { WorkspaceState } from '@/lib/workspace/types'

export function salonOwnsKeyboard(
  state: WorkspaceState | null | undefined,
  salonTabId: string | null,
): boolean {
  if (!state || !salonTabId) return true
  const pane = state.panes[state.focusedPane] ?? state.panes.left
  const activeId = pane?.activeTabId
  if (!activeId) return false
  if (activeId === salonTabId) return true
  return state.tabs[activeId]?.parentTabId === salonTabId
}

/** True when the key event came from inside an open dialog. */
export function isFromDialog(event: KeyboardEvent): boolean {
  const target = event.target
  if (!target || typeof (target as Element).closest !== 'function') return false
  return (target as Element).closest('[role="dialog"],[role="alertdialog"]') !== null
}
