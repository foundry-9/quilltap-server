/**
 * Theme hooks — the left rail (`components/layout/left-sidebar/`).
 *
 * @module lib/themes/hooks/sidebar
 */

import type { HookDef } from './types'

/** The rail's navigation items, as written in `data-nav` (`collapsed-nav.tsx`). */
export const SIDEBAR_NAV_IDS = [
  'home',
  'projects',
  'files',
  'scriptorium',
  'characters',
  'photos',
  'scenarios',
  'custom-tools',
  'chats',
] as const
export type SidebarNavId = (typeof SIDEBAR_NAV_IDS)[number]

/** The rail footer's buttons, as written in `data-nav` (`sidebar-footer.tsx`). */
export const SIDEBAR_ACTION_IDS = [
  'help',
  'brahma',
  'wardrobe',
  'inventory',
  'atlas',
  'document-mode',
  'settings',
  'themes',
  'quick-hide',
] as const

export const SIDEBAR_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-left-sidebar',
    surface: 'sidebar',
    label: 'Left rail',
    description: 'The permanent icon rail down the left of the window.',
    within: ['qt-app-layout'],
    states: [{ kind: 'class', className: 'qt-left-sidebar-collapsed', label: 'Collapsed (always, today: the rail has no expanded form)' }],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-content',
    surface: 'sidebar',
    label: 'Rail navigation area',
    within: ['qt-left-sidebar'],
    since: 1,
  },
  {
    className: 'qt-collapsed-nav',
    surface: 'sidebar',
    label: 'Rail navigation',
    within: ['qt-left-sidebar-content'],
    since: 1,
  },
  {
    className: 'qt-collapsed-nav-button',
    surface: 'sidebar',
    label: 'Rail navigation item',
    description: 'An icon link. Its name is in `title` / `aria-label`; there is no text label in the markup.',
    within: ['qt-collapsed-nav'],
    variants: [{ attribute: 'data-nav', values: SIDEBAR_NAV_IDS, description: 'Which item; `home` is the brand link at the top.' }],
    states: [
      {
        kind: 'aria',
        attribute: 'aria-current',
        values: ['page'],
        label: "The item for the focused workspace pane's active tab (none when nothing corresponds)",
      },
    ],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-footer',
    surface: 'sidebar',
    label: 'Rail footer',
    within: ['qt-left-sidebar'],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-footer-actions',
    surface: 'sidebar',
    label: 'Rail footer buttons',
    within: ['qt-left-sidebar-footer'],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-item',
    surface: 'sidebar',
    label: 'Rail footer button',
    within: ['qt-left-sidebar-footer-actions'],
    variants: [{ attribute: 'data-nav', values: SIDEBAR_ACTION_IDS, description: 'Which button.' }],
    states: [
      { kind: 'aria', attribute: 'aria-expanded', values: ['true', 'false'], label: 'Its popout is open (themes, quick-hide)' },
    ],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-item-icon',
    surface: 'sidebar',
    label: 'Rail footer button icon',
    within: ['qt-left-sidebar-item'],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-popout',
    surface: 'sidebar',
    label: 'Rail popout menu',
    description: 'The menu a footer button or the profile button opens (themes, quick-hide, profile).',
    within: ['qt-left-sidebar-footer'],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-profile',
    surface: 'sidebar',
    label: 'Profile button',
    within: ['qt-left-sidebar-footer'],
    states: [{ kind: 'aria', attribute: 'aria-expanded', values: ['true', 'false'], label: 'The profile menu is open' }],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-profile-avatar',
    surface: 'sidebar',
    label: 'Profile picture',
    within: ['qt-left-sidebar-profile'],
    since: 1,
  },
]
