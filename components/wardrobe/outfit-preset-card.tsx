'use client'

import type { OutfitPreset, WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'

interface OutfitPresetCardProps {
  preset: OutfitPreset
  /** Map of item IDs to their details, for rendering slot summaries */
  itemMap: Record<string, WardrobeItem>
  onApply?: (preset: OutfitPreset) => void
  onEdit: (preset: OutfitPreset) => void
  onDelete: (id: string) => void
  isDeleting?: boolean
  /** Whether the Apply button should be shown (requires chat context) */
  showApply?: boolean
}

const SLOT_LABELS: Record<WardrobeItemType, string> = {
  top: 'Top',
  bottom: 'Bottom',
  footwear: 'Footwear',
  accessories: 'Accessories',
}

export function OutfitPresetCard({
  preset,
  itemMap,
  onApply,
  onEdit,
  onDelete,
  isDeleting,
  showApply = false,
}: OutfitPresetCardProps) {
  const slotSummary = WARDROBE_SLOT_TYPES
    .filter((slot) => preset.slots[slot])
    .map((slot) => {
      const itemId = preset.slots[slot]
      const item = itemId ? itemMap[itemId] : null
      return `${SLOT_LABELS[slot]}: ${item?.title || 'Unknown'}`
    })
    .join(', ')

  return (
    <div className="qt-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="qt-text-primary truncate">{preset.name}</h3>
          {preset.description && (
            <p className="qt-text-small qt-text-secondary mt-1">
              {preset.description}
            </p>
          )}
          {slotSummary ? (
            <p className="qt-text-xs qt-text-muted mt-1">{slotSummary}</p>
          ) : (
            <p className="qt-text-xs qt-text-muted mt-1 italic">No slots assigned</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showApply && onApply && (
            <button
              onClick={() => onApply(preset)}
              className="qt-button-sm qt-button-primary"
              title="Apply preset"
            >
              Apply
            </button>
          )}

          <button
            onClick={() => onEdit(preset)}
            className="p-2 text-primary hover:bg-accent rounded"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          <button
            onClick={() => onDelete(preset.id)}
            disabled={isDeleting}
            className="p-2 qt-text-destructive hover:qt-bg-destructive/10 rounded disabled:opacity-50"
            title="Delete"
          >
            {isDeleting ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
