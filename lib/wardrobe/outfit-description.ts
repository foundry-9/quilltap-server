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
 */
export function describeOutfit(slots: OutfitSlotValues): string {
  const { top, bottom, footwear, accessories } = slots

  // All four null — completely naked
  if (top === null && bottom === null && footwear === null && accessories === null) {
    return '- completely naked and unadorned\n'
  }

  const lines: string[] = []

  // Top + bottom
  if (top === null && bottom === null) {
    lines.push('- naked')
  } else {
    if (top !== null) {
      lines.push(`- **top:** ${top}`)
    } else {
      lines.push('- **top:** topless')
    }
    if (bottom !== null) {
      lines.push(`- **bottom:** ${bottom}`)
    } else {
      lines.push('- **bottom:** bottomless')
    }
  }

  // Footwear
  if (footwear !== null) {
    lines.push(`- **footwear:** ${footwear}`)
  } else {
    lines.push('- **footwear:** barefoot')
  }

  // Accessories
  if (accessories !== null) {
    lines.push(`- **accessories:** ${accessories}`)
  } else {
    lines.push('- **accessories:** no accessories')
  }

  return lines.join('\n') + '\n'
}
