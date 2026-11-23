/**
 * The navigation registry — every place the left rail, the shell's native
 * menu bar and the help pages can send the operator.
 *
 * Pure data: no React, no Node built-ins, safe on the client and safe to
 * serialise as JSON (`GET /api/v1/system/navigation`, via `./listing.ts`).
 * The rail renders it (`components/layout/left-sidebar/`), a click is mapped
 * to behaviour by item id in `components/layout/left-sidebar/activators.ts`,
 * and the theme hook catalogue derives its `data-nav` values from it
 * (`lib/themes/hooks/sidebar.ts`). Nothing else may keep a list of rail
 * destinations (a grep-test holds it).
 *
 * Adding a destination is one entry here (and, for an action, one activator).
 * An item id is written as `data-nav`; it is stable and never reused.
 *
 * Design of record: docs/developer/features/complete/navigation-menus.md.
 *
 * @module lib/navigation/registry
 */

import type { TabKind } from '@/lib/workspace/types'
import type { IconName } from '@/components/ui/icons/icon-registry'

/** Things a rail item does that are not a tab. Each has an activator. */
export const NAV_ACTION_IDS = ['help', 'new-chat', 'open-document', 'themes', 'quick-hide'] as const
export type NavActionId = (typeof NAV_ACTION_IDS)[number]

export type NavTarget =
  | { type: 'destination'; href: string; tabKind: TabKind }
  | { type: 'action'; action: NavActionId }

export interface NavItem<Id extends string = string> {
  /** Written as `data-nav`; stable, never reused. */
  id: Id
  /** Menu and flyout text (and the plain button's accessible name). */
  label: string
  icon: IconName
  target: NavTarget
  /** Tab kinds this item stands for, for `aria-current`. Defaults to `[target.tabKind]`. */
  tabKinds?: readonly TabKind[]
}

export interface NavGroup<Id extends string = string, ItemId extends string = string> {
  id: Id
  label: string
  icon: IconName
  items: readonly NavItem<ItemId>[]
}

export type NavDestination = Extract<NavTarget, { type: 'destination' }>

const destination = (href: string, tabKind: TabKind): NavDestination => ({ type: 'destination', href, tabKind })
const action = (id: NavActionId): NavTarget => ({ type: 'action', action: id })

/** The plain buttons at the top of the rail. */
export const NAV_TOP = [
  { id: 'home', label: 'Home', icon: 'brand', target: destination('/', 'home') },
  {
    id: 'characters',
    label: 'Characters',
    icon: 'characters',
    target: destination('/aurora', 'aurora'),
    tabKinds: ['aurora', 'character', 'character-new'],
  },
] as const satisfies readonly NavItem[]

/** The four menus, in rail (and menu bar) order. */
export const NAV_GROUPS = [
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'chat',
    items: [
      { id: 'chats', label: 'Chats', icon: 'chat', target: destination('/salon', 'salon-list'), tabKinds: ['salon-list', 'salon'] },
      { id: 'new-chat', label: 'New Chat…', icon: 'plus', target: action('new-chat') },
      { id: 'scenarios', label: 'Scenarios', icon: 'scenarios', target: destination('/scenarios', 'scenarios') },
      { id: 'brahma', label: 'Brahma Console', icon: 'brahma-console', target: destination('/workspace?open=brahma', 'brahma') },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: 'inventory',
    items: [
      { id: 'wardrobe', label: 'Wardrobe', icon: 'wardrobe', target: destination('/workspace?open=wardrobe', 'wardrobe') },
      { id: 'inventory', label: 'Inventory', icon: 'inventory', target: destination('/workspace?open=inventory', 'inventory') },
      { id: 'atlas', label: 'The Atlas', icon: 'atlas', target: destination('/workspace?open=atlas', 'atlas') },
      { id: 'custom-tools', label: "Pascal's Workbench", icon: 'wrench', target: destination('/custom-tools', 'custom-tools') },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    icon: 'scriptorium',
    items: [
      { id: 'projects', label: 'Projects', icon: 'projects', target: destination('/prospero', 'prospero') },
      { id: 'files', label: 'Files', icon: 'files', target: destination('/files', 'files') },
      { id: 'scriptorium', label: 'The Scriptorium', icon: 'scriptorium', target: destination('/scriptorium', 'scriptorium') },
      { id: 'photos', label: 'My Photos', icon: 'photos', target: destination('/photos', 'photos') },
      { id: 'document-mode', label: 'Open Document…', icon: 'file-plus', target: action('open-document'), tabKinds: ['document-standalone'] },
    ],
  },
  {
    id: 'studio',
    label: 'Studio',
    icon: 'themes',
    items: [
      { id: 'generate-image', label: 'Generate Image', icon: 'image', target: destination('/generate-image', 'generate-image') },
      { id: 'atelier', label: 'The Atelier', icon: 'pencil', target: destination('/calliope', 'theme-editor') },
      { id: 'theme-gallery', label: 'Theme Gallery', icon: 'layers', target: destination('/calliope/specimens', 'theme-specimens') },
      { id: 'themes', label: 'Theme…', icon: 'themes', target: action('themes') },
    ],
  },
] as const satisfies readonly NavGroup[]

/** The bottom of the rail: one click each, because a lost or worried operator needs them. */
export const NAV_PINNED = [
  { id: 'help', label: 'Help', icon: 'help', target: action('help') },
  { id: 'quick-hide', label: 'Quick-hide', icon: 'eye-off', target: action('quick-hide') },
  { id: 'settings', label: 'Settings', icon: 'settings', target: destination('/settings', 'settings'), tabKinds: ['settings', 'settings-wizard'] },
] as const satisfies readonly NavItem[]

/** The profile button's menu, the last thing on the rail. */
export const NAV_PROFILE = {
  id: 'profile-menu',
  label: 'Profile',
  icon: 'profile',
  items: [
    { id: 'profile', label: 'Profile', icon: 'profile', target: destination('/profile', 'profile') },
    { id: 'about', label: 'About', icon: 'info', target: destination('/about', 'about') },
  ],
} as const satisfies NavGroup

export type NavGroupId = (typeof NAV_GROUPS)[number]['id']
export type NavItemId =
  | (typeof NAV_TOP)[number]['id']
  | (typeof NAV_GROUPS)[number]['items'][number]['id']
  | (typeof NAV_PINNED)[number]['id']
  | (typeof NAV_PROFILE)['items'][number]['id']

/** Every item, in rail order: top, each group's rows, pinned, then the profile menu. */
export const NAV_ITEMS: readonly NavItem<NavItemId>[] = [
  ...NAV_TOP,
  ...NAV_GROUPS.flatMap((group): readonly NavItem<NavItemId>[] => group.items),
  ...NAV_PINNED,
  ...NAV_PROFILE.items,
]

/** Ids of every item, as written in `data-nav`. */
export const NAV_ITEM_IDS: readonly NavItemId[] = NAV_ITEMS.map((item) => item.id)
/** Ids of the four menus, as written in `data-nav` on their buttons. */
export const NAV_GROUP_IDS: readonly NavGroupId[] = NAV_GROUPS.map((group) => group.id)

const ITEMS_BY_ID = new Map<string, NavItem<NavItemId>>(NAV_ITEMS.map((item) => [item.id, item]))

/** Narrow an untrusted string (a bridge message, a test) to an item id. */
export function isNavItemId(id: string): id is NavItemId {
  return ITEMS_BY_ID.has(id)
}

export function findNavItem(id: string): NavItem<NavItemId> | undefined {
  return ITEMS_BY_ID.get(id)
}

/** The tab kinds an item stands for (empty for an action with none declared). */
export function navItemTabKinds(item: NavItem): readonly TabKind[] {
  if (item.tabKinds) return item.tabKinds
  return item.target.type === 'destination' ? [item.target.tabKind] : []
}

/** The menu holding the item that stands for `kind`, or null when none does. */
export function navGroupForTabKind(kind: TabKind): NavGroupId | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => navItemTabKinds(item).includes(kind))) return group.id
  }
  return null
}

/** The menu an item sits in, or null for a top, pinned or profile item. */
export function navGroupOfItem(id: string): NavGroupId | null {
  for (const group of NAV_GROUPS) {
    if (group.items.some((item) => item.id === id)) return group.id
  }
  return null
}
