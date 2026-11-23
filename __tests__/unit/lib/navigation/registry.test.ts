/**
 * The navigation registry (navigation-menus §3, §9): one table for the rail,
 * the shell's menu bar, the theme hooks and the help pages.
 */

import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'
import {
  NAV_ACTION_IDS,
  NAV_GROUP_IDS,
  NAV_GROUPS,
  NAV_ITEM_IDS,
  NAV_ITEMS,
  NAV_PINNED,
  NAV_PROFILE,
  NAV_TOP,
  findNavItem,
  isNavItemId,
  navGroupForTabKind,
  navGroupOfItem,
  navItemTabKinds,
} from '@/lib/navigation/registry'
import { ACTION_ACTIVATORS, DESTINATION_ACTIVATORS } from '@/components/layout/left-sidebar/activators'
import {
  SIDEBAR_ACTION_IDS,
  SIDEBAR_MENU_IDS,
  SIDEBAR_MENU_ITEM_IDS,
  SIDEBAR_NAV_IDS,
} from '@/lib/themes/hooks/sidebar'
import { TAB_KINDS, type TabKind } from '@/lib/workspace/types'

/** The tab an href opens: a route through parseHrefToIntent, or a `/workspace?open=` intent. */
function tabKindOf(href: string): TabKind | null {
  const intent = parseHrefToIntent(href)
  if (intent) return intent.kind
  const [path, query = ''] = href.split('?')
  if (path !== '/workspace') return null
  const open = new URLSearchParams(query).get('open')
  return open && (TAB_KINDS as readonly string[]).includes(open) ? (open as TabKind) : null
}

describe('navigation registry', () => {
  it('gives every item and menu a unique id', () => {
    const ids = [...NAV_ITEM_IDS, ...NAV_GROUP_IDS, NAV_PROFILE.id]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps the rail to ten buttons or fewer', () => {
    // Top buttons, group buttons, pinned buttons and the profile button.
    expect(NAV_TOP.length + NAV_GROUPS.length + NAV_PINNED.length + 1).toBeLessThanOrEqual(10)
  })

  it('has the four groups in rail order', () => {
    expect(NAV_GROUP_IDS).toEqual(['conversations', 'objects', 'library', 'studio'])
  })

  it.each(NAV_ITEMS.filter((item) => item.target.type === 'destination').map((item) => [item.id, item] as const))(
    '%s: its href opens its declared tab kind',
    (_id, item) => {
      if (item.target.type !== 'destination') throw new Error('not a destination')
      expect(tabKindOf(item.target.href)).toBe(item.target.tabKind)
      expect(navItemTabKinds(item)).toContain(item.target.tabKind)
    },
  )

  it('has an activator for every action, and overrides only destinations', () => {
    for (const id of NAV_ACTION_IDS) expect(typeof ACTION_ACTIVATORS[id]).toBe('function')
    for (const item of NAV_ITEMS.filter((i) => i.target.type === 'action')) {
      if (item.target.type === 'action') expect(NAV_ACTION_IDS).toContain(item.target.action)
    }
    for (const id of Object.keys(DESTINATION_ACTIVATORS)) {
      expect(findNavItem(id)?.target.type).toBe('destination')
    }
  })

  it('gives every item a data-nav hook value', () => {
    const hookValues = new Set([...SIDEBAR_NAV_IDS, ...SIDEBAR_ACTION_IDS, ...SIDEBAR_MENU_ITEM_IDS])
    for (const id of NAV_ITEM_IDS) expect(hookValues.has(id)).toBe(true)
    for (const id of NAV_GROUP_IDS) expect(SIDEBAR_NAV_IDS).toContain(id)
    expect(SIDEBAR_MENU_IDS).toEqual(expect.arrayContaining([...NAV_GROUP_IDS, NAV_PROFILE.id, 'themes', 'quick-hide']))
  })

  it('keeps every data-nav value the rail wore before the groups', () => {
    const before = [
      'home', 'projects', 'files', 'scriptorium', 'characters', 'photos', 'scenarios', 'custom-tools', 'chats',
      'help', 'brahma', 'wardrobe', 'inventory', 'atlas', 'document-mode', 'settings', 'themes', 'quick-hide',
    ]
    for (const id of before) expect(isNavItemId(id)).toBe(true)
  })

  it('places items as the spec decides', () => {
    expect(navGroupOfItem('scenarios')).toBe('conversations')
    expect(navGroupOfItem('brahma')).toBe('conversations')
    expect(navGroupOfItem('custom-tools')).toBe('objects')
    expect(navGroupOfItem('themes')).toBe('studio')
    expect(navGroupOfItem('characters')).toBeNull()
    expect(navGroupOfItem('quick-hide')).toBeNull()
  })

  it('finds the group for a tab kind', () => {
    expect(navGroupForTabKind('salon')).toBe('conversations')
    expect(navGroupForTabKind('atlas')).toBe('objects')
    expect(navGroupForTabKind('document-standalone')).toBe('library')
    expect(navGroupForTabKind('theme-specimens')).toBe('studio')
    expect(navGroupForTabKind('character')).toBeNull()
  })

  it('serialises as plain JSON', () => {
    expect(JSON.parse(JSON.stringify({ NAV_TOP, NAV_GROUPS, NAV_PINNED, NAV_PROFILE }))).toEqual({
      NAV_TOP, NAV_GROUPS, NAV_PINNED, NAV_PROFILE,
    })
  })
})
