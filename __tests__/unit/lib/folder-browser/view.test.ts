/**
 * The shared folder-browser view rules (`lib/folder-browser/view`):
 * child folder rows union the server tree with the folders items imply, count
 * live items, and sort case-insensitively; tier rows skip the own tier and
 * count live borrowed items in first-seen order.
 */

import { OWN_TIER, childFolderRows, tierLabel, tierRows } from '@/lib/folder-browser/view'

const PROJECT = { scope: 'project' as const, id: 'p1', name: 'Quest' }
const GENERAL = { scope: 'general' as const, id: null, name: 'Quilltap General' }

describe('childFolderRows', () => {
  it('unions the tree with item folders, one row per direct child', () => {
    const rows = childFolderRows(
      '',
      [{ folder: 'formal/Evening' }, { folder: 'Casual' }, { folder: '' }],
      [{ path: 'Formal', itemCount: 4 }, { path: 'Empty', itemCount: 0 }],
    )
    expect(rows.map((r) => [r.path, r.itemCount])).toEqual([
      ['Casual', 1],
      ['Empty', 0],
      ['Formal', 4],
    ])
  })

  it('counts only live items directly inside when the server does not know the folder', () => {
    const rows = childFolderRows('Formal', [
      { folder: 'Formal/Evening' },
      { folder: 'Formal/Evening', archivedAt: '2026-01-01' },
      { folder: 'Formal/Evening/Gala' },
    ])
    expect(rows).toEqual([{ path: 'Formal/Evening', name: 'Evening', itemCount: 1 }])
  })
})

describe('tierRows', () => {
  it('skips the own tier and counts live borrowed items in first-seen order', () => {
    const items = [
      { id: 'a', origin: PROJECT },
      { id: 'b', origin: GENERAL },
      { id: 'c', origin: PROJECT, archivedAt: '2026-01-01' },
      { id: 'd', origin: PROJECT },
      { id: 'e' },
    ]
    const tierOf = (i: (typeof items)[number]) => (i.origin ? `${i.origin.scope}:${i.origin.id ?? ''}` : OWN_TIER)
    expect(tierRows(items, tierOf)).toEqual([
      { key: 'project:p1', label: 'Project: Quest', scope: 'project', itemCount: 2 },
      { key: 'general:', label: 'General', scope: 'general', itemCount: 1 },
    ])
  })

  it('labels each scope', () => {
    expect(tierLabel({ scope: 'group', id: 'g', name: 'Crew' })).toBe('Group: Crew')
    expect(tierLabel(null)).toBe('General')
  })
})
