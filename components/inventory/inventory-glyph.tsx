'use client'

/**
 * An Inventory object's glyph and picture.
 *
 * The glyph is what every row, chip and pane shows: the object's SVG (drawn
 * through an `<img>` data URI, so it is an icon and nothing inside it can
 * run), else its emoji, else a default glyph (or, where asked, an
 * abbreviation of its name). **Never the picture** — the
 * picture is for choosing (spec §2), shown only by `InventoryPicture` in the
 * pickers, the editor and the viewer.
 *
 * @module components/inventory/inventory-glyph
 */

import { Icon } from '@/components/ui/icon'
import { inventorySvgDataUri } from '@/lib/inventory/svg'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'

type GlyphItem = Pick<ResolvedInventoryItem, 'svg' | 'emoji' | 'kind' | 'name' | 'title'>

/** `Pocket Watch` → `PW`, `lantern` → `LA`: up to two letters for an object with no SVG or emoji. */
export function inventoryAbbreviation(label: string): string {
  const words = label.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
  if (words.length === 0) return '?'
  const initial = (w: string) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? ''
  const letters = words.length === 1
    ? (words[0].match(/[\p{L}\p{N}]/gu) ?? []).slice(0, 2).join('')
    : initial(words[0]) + initial(words[1])
  return letters.toUpperCase()
}

export function InventoryGlyph({
  item,
  size = 'md',
  fallback = 'icon',
}: {
  item: GlyphItem
  size?: 'sm' | 'md'
  /** What to draw with neither SVG nor emoji: the default icon, or the name's abbreviation. */
  fallback?: 'icon' | 'abbreviation'
}) {
  const box = size === 'sm' ? 'w-5 h-5 text-sm' : 'w-8 h-8 text-lg'
  const label = item.title || item.name
  if (item.svg) {
    return (
      <img
        src={inventorySvgDataUri(item.svg)}
        alt=""
        aria-hidden
        className={`${box} flex-shrink-0 object-contain`}
        data-testid="inventory-glyph-svg"
      />
    )
  }
  if (item.emoji) {
    return (
      <span className={`${box} flex-shrink-0 inline-flex items-center justify-center`} aria-hidden data-testid="inventory-glyph-emoji">
        {item.emoji}
      </span>
    )
  }
  if (fallback === 'abbreviation') {
    return (
      <span
        className={`${box} flex-shrink-0 inline-flex items-center justify-center rounded border qt-border-default qt-bg-muted qt-text-secondary font-semibold text-[10px] leading-none`}
        aria-hidden
        data-testid="inventory-glyph-abbreviation"
      >
        {inventoryAbbreviation(label)}
      </span>
    )
  }
  return (
    <span className={`${box} flex-shrink-0 inline-flex items-center justify-center qt-text-secondary`} aria-hidden data-testid="inventory-glyph-default">
      <Icon name={item.kind === 'kit' ? 'layers' : 'tag'} className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'} />
    </span>
  )
}

/** The object's current picture, for choosing — or its glyph when it has none. */
export function InventoryPicture({ item, size = 48 }: { item: GlyphItem & Pick<ResolvedInventoryItem, 'imageFileId'>; size?: number }) {
  if (!item.imageFileId) {
    return (
      <span
        className="inline-flex items-center justify-center rounded border qt-border-default qt-bg-muted flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <InventoryGlyph item={item} />
      </span>
    )
  }
  return (
    <img
      src={`/api/v1/files/${item.imageFileId}?action=thumbnail`}
      alt={`Picture of ${item.title || item.name}`}
      className="rounded border qt-border-default object-cover flex-shrink-0"
      style={{ width: size, height: size }}
      data-testid="inventory-picture"
    />
  )
}
