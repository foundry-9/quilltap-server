/**
 * Theme hooks — the left rail (`components/layout/left-sidebar/`).
 *
 * The `data-nav` values are derived from the navigation registry
 * (`lib/navigation/registry.ts`), never hand-listed.
 *
 * @module lib/themes/hooks/sidebar
 */

import { NAV_GROUP_IDS, NAV_GROUPS, NAV_PINNED, NAV_PROFILE, NAV_TOP } from '@/lib/navigation/registry'
import type { HookDef } from './types'

/** The rail's top buttons (Home, Characters) and its four group buttons, as written in `data-nav` (`collapsed-nav.tsx`). */
export const SIDEBAR_NAV_IDS: readonly string[] = [...NAV_TOP.map((item) => item.id), ...NAV_GROUP_IDS]

/** The rail footer's pinned buttons, as written in `data-nav` (`sidebar-footer.tsx`). */
export const SIDEBAR_ACTION_IDS: readonly string[] = NAV_PINNED.map((item) => item.id)

/** Every navigation item, as written in `data-nav` on its flyout row (`nav-flyout.tsx`). */
export const SIDEBAR_MENU_ITEM_IDS: readonly string[] = [...NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id)), ...NAV_PROFILE.items.map((item) => item.id)]

/** Every flyout, as written in `data-nav-menu`: the four groups, the profile menu and the two panels. */
export const SIDEBAR_MENU_IDS: readonly string[] = [...NAV_GROUP_IDS, NAV_PROFILE.id, 'themes', 'quick-hide']

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
    label: 'Rail navigation button',
    description:
      'An icon link (Home, Characters) or a group button that opens its flyout menu (Conversations, Objects, Library, Studio). Its name is in `title` / `aria-label`; the text label is in the flyout.',
    within: ['qt-collapsed-nav'],
    variants: [{ attribute: 'data-nav', values: SIDEBAR_NAV_IDS, description: 'Which button; `home` is the brand link at the top.' }],
    states: [
      {
        kind: 'aria',
        attribute: 'aria-current',
        values: ['page'],
        label: "The button for the focused workspace pane's active tab — for a group, when one of its rows is (none when nothing corresponds)",
      },
      { kind: 'aria', attribute: 'aria-expanded', values: ['true', 'false'], label: "A group button's flyout is open" },
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
    description: 'A pinned button: Help, Quick-hide, Settings.',
    within: ['qt-left-sidebar-footer-actions'],
    variants: [{ attribute: 'data-nav', values: SIDEBAR_ACTION_IDS, description: 'Which button.' }],
    states: [
      { kind: 'aria', attribute: 'aria-expanded', values: ['true', 'false'], label: 'Its flyout is open (quick-hide)' },
      { kind: 'aria', attribute: 'aria-current', values: ['page'], label: "Settings, when it is the focused pane's active tab" },
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
    label: 'Rail flyout',
    description:
      'The flyout a rail button opens: a group menu, the profile menu, or a panel (theme, quick-hide). Portalled to `<body>`, beside the rail; at phone width a sheet along the bottom of the screen.',
    variants: [{ attribute: 'data-nav-menu', values: SIDEBAR_MENU_IDS, description: 'Which flyout.' }],
    states: [{ kind: 'class', className: 'qt-left-sidebar-popout-sheet', label: 'Shown as a bottom sheet (phone width)' }],
    since: 1,
  },
  {
    className: 'qt-left-sidebar-menu-heading',
    surface: 'sidebar',
    label: 'Rail flyout heading',
    description: "The flyout's name: the group's label, Profile, Theme or Quick-hide.",
    within: ['qt-left-sidebar-popout'],
    since: 2,
  },
  {
    className: 'qt-left-sidebar-menu',
    surface: 'sidebar',
    label: 'Rail flyout menu',
    description: 'The `role="menu"` list of rows in a group or profile flyout.',
    within: ['qt-left-sidebar-popout'],
    since: 2,
  },
  {
    className: 'qt-left-sidebar-menu-item',
    surface: 'sidebar',
    label: 'Rail flyout row',
    description: 'One navigation item: an icon and a text label. A destination is a link, an action a button.',
    within: ['qt-left-sidebar-menu'],
    variants: [{ attribute: 'data-nav', values: SIDEBAR_MENU_ITEM_IDS, description: 'Which item.' }],
    states: [{ kind: 'aria', attribute: 'aria-disabled', values: ['true'], label: 'Not available now (Brahma with no connection profile); the reason is shown under the label' }],
    since: 2,
  },
  {
    className: 'qt-left-sidebar-menu-item-icon',
    surface: 'sidebar',
    label: 'Rail flyout row icon',
    within: ['qt-left-sidebar-menu-item'],
    since: 2,
  },
  {
    className: 'qt-left-sidebar-menu-item-text',
    surface: 'sidebar',
    label: 'Rail flyout row text',
    description: 'Holds the label and, when the row is disabled, its reason.',
    within: ['qt-left-sidebar-menu-item'],
    since: 2,
  },
  {
    className: 'qt-left-sidebar-menu-item-label',
    surface: 'sidebar',
    label: 'Rail flyout row label',
    within: ['qt-left-sidebar-menu-item-text'],
    since: 2,
  },
  {
    className: 'qt-left-sidebar-menu-item-reason',
    surface: 'sidebar',
    label: 'Rail flyout row disabled reason',
    description: 'Why a disabled row cannot be chosen, in text under its label.',
    within: ['qt-left-sidebar-menu-item-text'],
    since: 2,
  },
  {
    className: 'qt-left-sidebar-profile',
    surface: 'sidebar',
    label: 'Profile button',
    within: ['qt-left-sidebar-footer'],
    variants: [{ attribute: 'data-nav', values: [NAV_PROFILE.id], description: 'Always `profile-menu`: the flyout it opens.' }],
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
