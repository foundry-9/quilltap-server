'use client'

/**
 * Outfit Indicator Component
 *
 * Compact, collapsible outfit display for use inside ParticipantCard.
 * Shows what a character is currently wearing and allows changing
 * equipped items per slot via dropdown selectors.
 *
 * @module components/wardrobe/outfit-indicator
 */

import { useState, useCallback } from 'react'
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemSummary } from '@/app/salon/[id]/hooks/useOutfit'

// ============================================================================
// TYPES
// ============================================================================

export interface OutfitIndicatorProps {
  characterId: string
  equippedSlots: EquippedSlots | null
  /** Resolved item details keyed by slot name */
  equippedItems: Record<string, { title: string } | null>
  /** All wardrobe items for this character (for the change dropdown) */
  wardrobeItems: WardrobeItemSummary[]
  /** Callback when equipping/unequipping a slot */
  onEquipSlot: (slot: string, itemId: string | null) => void
  isLoading?: boolean
  /** Callback to open the gift wardrobe item modal for this character */
  onGiftItem?: () => void
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SLOT_LABELS: Record<WardrobeItemType, string> = {
  top: 'Top',
  bottom: 'Bottom',
  footwear: 'Footwear',
  accessories: 'Accessories',
}

const EMPTY_LABELS: Record<WardrobeItemType, string> = {
  top: '(none)',
  bottom: '(none)',
  footwear: '(barefoot)',
  accessories: '(none)',
}

// ============================================================================
// COMPONENT
// ============================================================================

export function OutfitIndicator({
  characterId,
  equippedSlots,
  equippedItems,
  wardrobeItems,
  onEquipSlot,
  isLoading = false,
  onGiftItem,
}: OutfitIndicatorProps) {
  const [expanded, setExpanded] = useState(false)
  const [changingSlot, setChangingSlot] = useState<WardrobeItemType | null>(null)

  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev)
    setChangingSlot(null)
  }, [])

  const handleSlotChange = useCallback((slot: WardrobeItemType, itemId: string | null) => {
    onEquipSlot(slot, itemId)
    setChangingSlot(null)
  }, [onEquipSlot])

  const getItemsForSlot = useCallback((slot: WardrobeItemType): WardrobeItemSummary[] => {
    return wardrobeItems.filter(item => item.types.includes(slot))
  }, [wardrobeItems])

  // Don't render if no outfit data and not loading
  if (!equippedSlots && !isLoading) {
    return null
  }

  return (
    <div className="mt-2">
      {/* Collapsible header with gift button */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex items-center gap-1 text-left qt-text-xs qt-text-secondary hover:qt-text-primary transition-colors"
          aria-expanded={expanded}
          aria-label="Toggle outfit display"
        >
          <svg
            className={`w-3 h-3 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>Outfit</span>
        </button>
        {isLoading && (
          <span className="qt-text-muted text-xs">(loading...)</span>
        )}
        {onGiftItem && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onGiftItem()
            }}
            className="ml-auto qt-text-secondary hover:qt-text-primary transition-colors p-0.5"
            title="Gift a wardrobe item to this character"
            aria-label="Gift wardrobe item"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && equippedSlots && (
        <div className="mt-1 ml-4 space-y-0.5">
          {WARDROBE_SLOT_TYPES.map((slot) => {
            const item = equippedItems[slot]
            const isChanging = changingSlot === slot
            const slotItems = getItemsForSlot(slot)

            return (
              <div key={slot} className="flex items-center gap-1 qt-text-xs">
                <span className="qt-text-secondary w-20 flex-shrink-0">
                  {SLOT_LABELS[slot]}:
                </span>

                {isChanging ? (
                  <select
                    value={equippedSlots[slot] || ''}
                    onChange={(e) => handleSlotChange(slot, e.target.value || null)}
                    onBlur={() => setChangingSlot(null)}
                    autoFocus
                    className="qt-select qt-select-sm flex-1 text-xs py-0 px-1"
                    aria-label={`Select ${SLOT_LABELS[slot]} item`}
                  >
                    <option value="">{EMPTY_LABELS[slot]}</option>
                    {slotItems.map((wi) => (
                      <option key={wi.id} value={wi.id}>
                        {wi.title}{wi.isDefault ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    onClick={() => setChangingSlot(slot)}
                    className="qt-text-primary hover:underline cursor-pointer text-left truncate flex-1"
                    title={item ? `${item.title} (click to change)` : `${EMPTY_LABELS[slot]} (click to change)`}
                  >
                    {item ? item.title : (
                      <span className="qt-text-muted italic">{EMPTY_LABELS[slot]}</span>
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
