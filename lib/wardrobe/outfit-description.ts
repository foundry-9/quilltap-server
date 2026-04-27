/**
 * Outfit Description Utility
 *
 * Single source of truth for converting equipped wardrobe slot values
 * into a human-readable description of what a character is wearing.
 *
 * A null slot means the slot is empty — nothing is worn there.
 * Defaults are set at chat startup, not inferred.
 *
 * @module wardrobe/outfit-description
 */

/**
 * Slot values for describing an outfit. Each value is either a
 * human-readable item description (e.g. "silk blouse") or null
 * meaning the slot is empty.
 */
export interface OutfitSlotValues {
  top: string | null
  bottom: string | null
  footwear: string | null
  accessories: string | null
}

/**
 * Produce a markdown description of what a character is wearing
 * based on their equipped wardrobe slots.
 *
 * Rules:
 * - All four null → "- completely naked and unadorned"
 * - Top AND bottom null → "- naked" (footwear/accessories listed separately)
 * - Only top null → "- **top:** topless"
 * - Only bottom null → "- **bottom:** bottomless"
 * - Footwear null → "- **footwear:** barefoot"
 * - Accessories null → "- **accessories:** no accessories"
 * - Non-null → "- **{slot}:** {value}"
 *
 * Slots that share the same value (e.g. a single multi-slot item equipped
 * across top/bottom/footwear/accessories) are collapsed to one line:
 * "- **top, bottom, footwear, accessories:** {value}".
 */
export function describeOutfit(slots: OutfitSlotValues): string {
  const { top, bottom, footwear, accessories } = slots

  if (top === null && bottom === null && footwear === null && accessories === null) {
    return '- completely naked and unadorned\n'
  }

  const lines: string[] = []
  const groups = new Map<string, string[]>()
  const addSlot = (slot: string, value: string) => {
    const existing = groups.get(value)
    if (existing) existing.push(slot)
    else groups.set(value, [slot])
  }

  if (top === null && bottom === null) {
    lines.push('- naked')
  } else {
    addSlot('top', top ?? 'topless')
    addSlot('bottom', bottom ?? 'bottomless')
  }
  addSlot('footwear', footwear ?? 'barefoot')
  addSlot('accessories', accessories ?? 'no accessories')

  for (const [value, slotsForValue] of groups) {
    lines.push(`- **${slotsForValue.join(', ')}:** ${value}`)
  }

  return lines.join('\n') + '\n'
}
