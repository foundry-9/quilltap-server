/**
 * Outfit Description Utility
 *
 * Single source of truth for converting equipped wardrobe slot values
 * into a human-readable description of what a character is wearing.
 *
 * Each slot holds an array of item titles. An empty array means nothing is
 * worn in that slot. Multiple titles in a slot represent layering (e.g.
 * t-shirt + sweater); they're listed in the order callers provided them
 * and the LLM is expected to figure out what shows.
 *
 * @module wardrobe/outfit-description
 */

/**
 * Slot values for describing an outfit. Each slot is an array of human-readable
 * item titles. Empty array means the slot is empty.
 */
export interface OutfitSlotValues {
  top: string[]
  bottom: string[]
  footwear: string[]
  accessories: string[]
}

/**
 * Produce a markdown description of what a character is wearing
 * based on their equipped wardrobe slots.
 *
 * Rules:
 * - All four empty → "- completely naked and unadorned"
 * - Top AND bottom empty → "- naked" (footwear/accessories listed separately)
 * - Only top empty → "- **top:** topless"
 * - Only bottom empty → "- **bottom:** bottomless"
 * - Footwear empty → "- **footwear:** barefoot"
 * - Accessories empty → "- **accessories:** no accessories"
 * - Multiple items in a slot → comma-joined under the slot label
 *
 * Slots that share the same value (e.g. a single multi-slot item equipped
 * across top/bottom/footwear/accessories) are collapsed to one line.
 */
export function describeOutfit(slots: OutfitSlotValues): string {
  const { top, bottom, footwear, accessories } = slots

  if (top.length === 0 && bottom.length === 0 && footwear.length === 0 && accessories.length === 0) {
    return '- completely naked and unadorned\n'
  }

  const lines: string[] = []
  const groups = new Map<string, string[]>()
  const addSlot = (slot: string, value: string) => {
    const existing = groups.get(value)
    if (existing) existing.push(slot)
    else groups.set(value, [slot])
  }

  const joinOrFallback = (items: string[], fallback: string): string =>
    items.length === 0 ? fallback : items.join(', ')

  if (top.length === 0 && bottom.length === 0) {
    lines.push('- naked')
  } else {
    addSlot('top', joinOrFallback(top, 'topless'))
    addSlot('bottom', joinOrFallback(bottom, 'bottomless'))
  }
  addSlot('footwear', joinOrFallback(footwear, 'barefoot'))
  addSlot('accessories', joinOrFallback(accessories, 'no accessories'))

  for (const [value, slotsForValue] of groups) {
    lines.push(`- **${slotsForValue.join(', ')}:** ${value}`)
  }

  return lines.join('\n') + '\n'
}
