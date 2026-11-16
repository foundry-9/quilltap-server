/**
 * Theme hooks — dialogs (`components/ui/BaseModal.tsx`).
 *
 * @module lib/themes/hooks/dialog
 */

import type { HookDef } from './types'

export const DIALOG_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-dialog-overlay',
    surface: 'dialog',
    label: 'Dialog backdrop',
    since: 1,
  },
  {
    className: 'qt-dialog',
    surface: 'dialog',
    label: 'Dialog',
    description: 'The dialog panel. Also carries `data-qt-modal` and `role="dialog"` or `role="alertdialog"`.',
    within: ['qt-dialog-overlay'],
    states: [
      { kind: 'class', className: 'qt-dialog-wide', label: 'Page-width dialog' },
      { kind: 'aria', attribute: 'aria-busy', values: ['true'], label: 'Working; Escape and the close button wait' },
    ],
    since: 1,
  },
  {
    className: 'qt-dialog-header',
    surface: 'dialog',
    label: 'Dialog header',
    within: ['qt-dialog'],
    since: 1,
  },
  {
    className: 'qt-dialog-title',
    surface: 'dialog',
    label: 'Dialog title',
    within: ['qt-dialog-header'],
    since: 1,
  },
  {
    className: 'qt-dialog-description',
    surface: 'dialog',
    label: 'Dialog subtitle',
    within: ['qt-dialog-header'],
    since: 1,
  },
  {
    className: 'qt-dialog-close',
    surface: 'dialog',
    label: 'Dialog close button',
    within: ['qt-dialog-header'],
    since: 1,
  },
  {
    className: 'qt-dialog-body',
    surface: 'dialog',
    label: 'Dialog body',
    description: 'Always present, and unstyled: the default padding is `qt-dialog-body-default`, which a dialog drops when it lays out its own body.',
    within: ['qt-dialog'],
    states: [{ kind: 'class', className: 'qt-dialog-body-default', label: 'Default padding (the dialog lays out nothing of its own)' }],
    since: 1,
  },
  {
    className: 'qt-dialog-footer',
    surface: 'dialog',
    label: 'Dialog footer',
    description: 'Always present when there are actions, and unstyled: the default look is `qt-dialog-footer-default`.',
    within: ['qt-dialog'],
    states: [{ kind: 'class', className: 'qt-dialog-footer-default', label: 'Default footer look' }],
    since: 1,
  },
  {
    className: 'qt-floating-dialog',
    surface: 'dialog',
    label: 'Floating dialog',
    description:
      'A non-modal dialog that floats over the page (the Inform dialog, among others). Modal dialogs are `qt-dialog`.',
    since: 1,
  },
  {
    className: 'qt-slide-over-panel',
    surface: 'dialog',
    label: 'Slide-over panel',
    description: 'A panel that slides in from the edge of the window.',
    since: 1,
  },
]
