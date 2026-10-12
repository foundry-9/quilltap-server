/**
 * What the wardrobe browser shows at one place in a folder tree — the pure
 * half of the browser's file-manager view, kept out of the component so the
 * rules are stated once:
 *
 *   - **folder rows** are the direct children of the folder being browsed,
 *     from the server's tree (empty folders included) unioned with the
 *     folders the listed items imply; a row's count is the live items
 *     directly inside, whatever filters are on;
 *   - **tier rows** (a character's container only) are the shared wardrobes
 *     the character borrows from — one per wardrobe that has items, never
 *     merged across tiers;
 *   - an item belongs to the view when its tier and folder both match.
 *
 * Client-safe: pure.
 *
 * @module lib/wardrobe/folder-view
 */

import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import {
  folderName,
  folderSegments,
  isSameFolder,
  isUnderFolder,
  joinFolder,
  type WardrobeFolder,
} from '@/lib/wardrobe/folders'
import {
  containerForListedItem,
  encodeWardrobeContainer,
  GENERAL_WARDROBE_NAME,
  type WardrobeOrigin,
} from '@/lib/wardrobe/wardrobe-container'

/** The tier key of a character's own closet in the browser's view. */
export const OWN_TIER = 'own'

type ViewItem = Pick<WardrobeItem, 'id' | 'characterId' | 'archivedAt'> & {
  folder?: string | null
  origin?: WardrobeOrigin | null
}

/** A folder row: one direct child of the folder being browsed. */
export interface FolderRowView {
  path: string
  name: string
  itemCount: number
}

/** A tier row: a shared wardrobe a character's view borrows from. */
export interface TierRowView {
  key: string
  label: string
  /** The scope, for the chip. */
  scope: WardrobeOrigin['scope']
  itemCount: number
}

/**
 * The tier an item sits in from a view: `own` for a manageable item (or any
 * item outside a character's merged view), otherwise the wardrobe it was
 * borrowed from.
 */
export function viewTierOf(item: ViewItem, manageable: boolean, characterView: boolean): string {
  if (!characterView || manageable) return OWN_TIER
  return encodeWardrobeContainer(containerForListedItem(item))
}

/** The label a tier row (and its crumb) carries. */
export function tierLabel(origin: WardrobeOrigin | null | undefined): string {
  if (!origin || origin.scope === 'general') return 'General'
  if (origin.scope === 'project') return `Project: ${origin.name}`
  if (origin.scope === 'group') return `Group: ${origin.name}`
  return origin.name || GENERAL_WARDROBE_NAME
}

/** The direct child of `current` that `folder` sits in (or is), or null. */
function childOf(folder: string, current: string): string | null {
  if (!folder || isSameFolder(folder, current) || !isUnderFolder(folder, current)) return null
  const depth = folderSegments(current).length
  const segments = folderSegments(folder)
  return joinFolder(current, segments[depth])
}

/**
 * The folder rows under `current`: the server's tree (when the view has one)
 * unioned with the folders `items` imply. Counts are live items directly
 * inside, from the server when it knows the folder, else from `items`.
 * Sorted by name, case-insensitively.
 */
export function childFolderRows(
  current: string,
  items: readonly ViewItem[],
  tree: readonly WardrobeFolder[] = [],
): FolderRowView[] {
  const rows = new Map<string, FolderRowView>()
  const serverCounts = new Map(tree.map((f) => [f.path.toLowerCase(), f.itemCount]))
  const add = (path: string) => {
    const key = path.toLowerCase()
    if (!rows.has(key)) rows.set(key, { path, name: folderName(path), itemCount: 0 })
  }
  for (const folder of tree) {
    const child = childOf(folder.path, current)
    if (child) add(child)
  }
  for (const item of items) {
    const child = childOf(item.folder ?? '', current)
    if (child) add(child)
  }
  for (const row of rows.values()) {
    const key = row.path.toLowerCase()
    row.itemCount =
      serverCounts.get(key) ??
      items.filter((i) => !i.archivedAt && isSameFolder(i.folder ?? '', row.path)).length
  }
  return Array.from(rows.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

/**
 * The tier rows of a character's view: one per borrowed wardrobe with items,
 * in the order the items first name them (the pool's own order — nearest
 * tier first). `tierOf` maps an item to its view tier.
 */
export function tierRows<T extends ViewItem>(
  items: readonly T[],
  tierOf: (item: T) => string,
): TierRowView[] {
  const rows = new Map<string, TierRowView>()
  for (const item of items) {
    const key = tierOf(item)
    if (key === OWN_TIER) continue
    const row = rows.get(key)
    const live = item.archivedAt ? 0 : 1
    if (row) {
      row.itemCount += live
      continue
    }
    rows.set(key, {
      key,
      label: tierLabel(item.origin),
      scope: item.origin?.scope ?? 'general',
      itemCount: live,
    })
  }
  return Array.from(rows.values())
}
