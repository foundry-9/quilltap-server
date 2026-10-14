'use client'

/**
 * Outfit Quick Pick
 *
 * The "Wear an outfit" pull-down that sits above the slot rows in the
 * composer. Lists every composed outfit (composite) in the character's
 * wearable pool; picking one wears it the same way the slot pickers wear a
 * garment — flag-driven through the parent's `onWear`, so an additive bundle
 * layers and one marked `replace` clears the slots it lands in.
 *
 * Composed outfits appear *only* here. The per-slot pickers list garments, so
 * a three-slot bundle no longer shows up in three separate slot menus.
 *
 * Renders nothing when the pool holds no composed outfits.
 *
 * @module components/wardrobe/outfit-quick-pick
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { Icon } from '@/components/ui/icon'
import { selectComposedOutfits } from '@/lib/wardrobe/composed-outfits'
import { formatSlotLabels } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import { wardrobeOriginLabel, type ListedWardrobeItem } from '@/lib/wardrobe/wardrobe-container'
import { WardrobeItemThumbnail } from './wardrobe-item-thumbnail'

export interface OutfitQuickPickProps {
  /** The character's full wearable pool (garments and composed outfits). */
  items: ListedWardrobeItem[]
  /** Wear the chosen outfit. The parent applies the usual equip rules. */
  onWear: (item: WardrobeItem) => void
}

export function OutfitQuickPick({ items, onWear }: OutfitQuickPickProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const outfits = useMemo(() => selectComposedOutfits(items), [items])

  // Close on an outside click or Escape — the Escape swallowed in the
  // capture phase so the enclosing dialog stays open.
  const closeOnOutsideClick = useCallback(() => setOpen(false), [])
  const closeOnEscape = useCallback(() => {
    setOpen(false)
    setSearch('')
  }, [])
  useClickOutside(containerRef, closeOnOutsideClick, {
    enabled: open,
    onEscape: closeOnEscape,
    escapeCapture: true,
  })

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return outfits
    return outfits.filter((o) => o.title.toLowerCase().includes(term))
  }, [outfits, search])

  if (outfits.length === 0) return null

  return (
    <div className="relative mb-2" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="qt-button-secondary qt-button-sm flex w-full items-center justify-between gap-2"
        title="Put on a whole outfit at once"
      >
        <span>Wear an outfit…</span>
        <Icon
          name="chevron-down"
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 rounded border qt-border-default qt-bg-default shadow-md max-h-64 overflow-y-auto"
        >
          <div className="p-2">
            <input
              type="search"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search outfits…"
              className="qt-input qt-input-sm w-full"
            />
          </div>
          {candidates.length === 0 ? (
            <div className="px-3 py-2 qt-text-xs qt-text-secondary">No matching outfits.</div>
          ) : (
            <ul className="divide-y qt-border-default">
              {candidates.map((outfit) => {
                const originLabel = wardrobeOriginLabel(outfit.origin)
                return (
                <li key={outfit.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      onWear(outfit)
                      setOpen(false)
                      setSearch('')
                    }}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:qt-bg-muted"
                  >
                    <WardrobeItemThumbnail fileId={outfit.imageFileId} size={28} />
                    <span className="min-w-0 flex-1 break-words text-sm text-foreground">
                      {outfit.title}
                    </span>
                    <span className="shrink-0 max-w-[45%] text-right qt-text-xs qt-text-secondary">
                      {formatSlotLabels(outfit.types)}
                      {outfit.replace ? ' · replaces' : ''}
                      {originLabel ? ` · ${originLabel}` : ''}
                    </span>
                  </button>
                </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
