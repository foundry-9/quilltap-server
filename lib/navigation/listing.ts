/**
 * The navigation registry as the Electron shell reads it
 * (`GET /api/v1/system/navigation`).
 *
 * Ids, labels, kinds and hrefs only: no icon, no tab kind, no activator. The
 * shell builds one native menu per group and a "Go" menu for the plain
 * buttons; a menu click sends the item id back through
 * `window.quilltap.onNavigate`, and the page runs the same activator a rail
 * click runs. `href` is the shell's fallback when the page has registered no
 * handler (a destination loads it; an action does nothing).
 *
 * @module lib/navigation/listing
 */

import { NAV_GROUPS, NAV_PINNED, NAV_PROFILE, NAV_TOP, type NavItem } from './registry'

/** Raised only when an existing field changes meaning or goes away. */
export const NAVIGATION_LISTING_VERSION = 1

export type NavigationListingItem =
  | { id: string; label: string; type: 'destination'; href: string }
  | { id: string; label: string; type: 'action' }

export interface NavigationListing {
  version: number
  top: NavigationListingItem[]
  groups: { id: string; label: string; items: NavigationListingItem[] }[]
  pinned: NavigationListingItem[]
}

function listItem(item: NavItem): NavigationListingItem {
  return item.target.type === 'destination'
    ? { id: item.id, label: item.label, type: 'destination', href: item.target.href }
    : { id: item.id, label: item.label, type: 'action' }
}

export function buildNavigationListing(): NavigationListing {
  return {
    version: NAVIGATION_LISTING_VERSION,
    top: NAV_TOP.map(listItem),
    groups: NAV_GROUPS.map((group) => ({ id: group.id, label: group.label, items: group.items.map(listItem) })),
    // A menu bar has no profile button: its rows join the pinned items.
    pinned: [...NAV_PINNED, ...NAV_PROFILE.items].map(listItem),
  }
}
