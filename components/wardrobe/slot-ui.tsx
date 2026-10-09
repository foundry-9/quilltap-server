'use client'

/**
 * Slot chips and slot checkboxes — the one spelling of a wardrobe slot in the
 * wardrobe UI. Labels and colours come from `WARDROBE_SLOT_META`, so every row,
 * card, picker and form names a slot the same way.
 *
 * @module components/wardrobe/slot-ui
 */

import { WARDROBE_SLOT_META, WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types'
import type { WardrobeItemType } from '@/lib/schemas/wardrobe.types'

/** A slot's coloured chip, labelled with the slot's display name. */
export function SlotBadge({ slot, className }: { slot: WardrobeItemType; className?: string }) {
  const meta = WARDROBE_SLOT_META[slot]
  return (
    <span className={`qt-badge ${meta.badgeClass}${className ? ` ${className}` : ''}`}>
      {meta.label}
    </span>
  )
}

export interface SlotCheckboxGroupProps {
  /** Checked slots. */
  value: readonly WardrobeItemType[]
  onToggle: (slot: WardrobeItemType) => void
  /** Slots shown checked and not toggleable (e.g. covered by a component). */
  locked?: readonly WardrobeItemType[]
  /** Tooltip on a locked slot. */
  lockedTitle?: string
  /** Fired when focus leaves the group (validation touch). */
  onBlur?: () => void
}

/** One checkbox per slot, in canonical order. */
export function SlotCheckboxGroup({
  value,
  onToggle,
  locked = [],
  lockedTitle,
  onBlur,
}: SlotCheckboxGroupProps) {
  return (
    <div className="flex flex-wrap gap-3" onBlur={onBlur}>
      {WARDROBE_SLOT_TYPES.map((slot) => {
        const isLocked = locked.includes(slot)
        return (
          <label
            key={slot}
            className={`inline-flex items-center gap-2 ${
              isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
            }`}
            title={isLocked ? lockedTitle : undefined}
          >
            <input
              type="checkbox"
              className="qt-checkbox"
              checked={isLocked || value.includes(slot)}
              disabled={isLocked}
              onChange={() => onToggle(slot)}
            />
            <span className="text-sm text-foreground">{WARDROBE_SLOT_META[slot].label}</span>
          </label>
        )
      })}
    </div>
  )
}
