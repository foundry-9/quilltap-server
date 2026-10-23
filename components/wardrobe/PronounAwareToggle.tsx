'use client'

/**
 * The "Pronoun-aware" checkbox the Wardrobe lists and outfit composers share.
 * Renders nothing when the character has no standard pronouns (nothing could
 * be hidden). Shows how many items the filter is holding back while it is on.
 *
 * @module components/wardrobe/PronounAwareToggle
 */

import type { PronounGuidanceFilter } from '@/lib/hooks/use-pronoun-guidance-filter'

export interface PronounAwareToggleProps {
  filter: PronounGuidanceFilter
  /** The pool the count is taken over. */
  items: readonly { pronounGuidance?: readonly string[] | null }[]
}

export function PronounAwareToggle({ filter, items }: PronounAwareToggleProps) {
  if (!filter.applies) return null
  const heldBack = filter.countHeldBack(items)
  return (
    <label
      className="flex items-center gap-2 qt-text-xs qt-text-secondary"
      title="Offer only pieces whose pronoun guidance suits this character (pieces without guidance are always offered)"
    >
      <input
        type="checkbox"
        checked={filter.aware}
        onChange={(e) => filter.setAware(e.target.checked)}
        className="qt-checkbox"
      />
      Pronoun-aware
      {filter.aware && heldBack > 0 && <span>({heldBack} hidden)</span>}
    </label>
  )
}
