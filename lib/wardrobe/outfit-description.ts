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

export type OutfitSlotName = keyof OutfitSlotValues

/**
 * Format resolved wardrobe leaf items as the title/description strings that
 * {@link describeOutfit} expects. Each item collapses to `"title"` or
 * `"title (description)"` depending on whether a description is present.
 */
export function decorateOutfitItems(
  items: ReadonlyArray<{ title: string; description?: string | null }>,
): string[] {
  return items.map(i => (i.description ? `${i.title} (${i.description})` : i.title))
}

export interface DescribeOutfitOptions {
  /**
   * Slots to leave out of the rendered description entirely. Omitted slots
   * produce no line and don't participate in the "all empty → naked" or
   * "top + bottom both empty → naked" fallbacks. Useful for portrait/avatar
   * prompts that only describe the upper body.
   */
  omit?: ReadonlyArray<OutfitSlotName>
}

/**
 * Produce a markdown description of what a character is wearing
 * based on their equipped wardrobe slots.
 *
 * Rules (apply only to non-omitted slots):
 * - All visible slots empty → "- completely naked and unadorned"
 * - Top AND bottom both visible and empty → "- naked" (footwear/accessories listed separately)
 * - Only top empty → "- **top:** topless"
 * - Only bottom empty → "- **bottom:** bottomless"
 * - Footwear empty → "- **footwear:** barefoot"
 * - Accessories empty → "- **accessories:** no accessories"
 * - Multiple items in a slot → comma-joined under the slot label
 *
 * Slots that share the same value (e.g. a single multi-slot item equipped
 * across top/bottom/footwear/accessories) are collapsed to one line.
 */
export function describeOutfit(slots: OutfitSlotValues, options: DescribeOutfitOptions = {}): string {
  const omit = new Set<OutfitSlotName>(options.omit ?? [])
  const visible = {
    top: omit.has('top') ? null : slots.top,
    bottom: omit.has('bottom') ? null : slots.bottom,
    footwear: omit.has('footwear') ? null : slots.footwear,
    accessories: omit.has('accessories') ? null : slots.accessories,
  }

  const allVisibleEmpty = (Object.values(visible) as (string[] | null)[])
    .every((v) => v === null || v.length === 0)

  if (allVisibleEmpty) {
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

  // The "naked" collapse only applies when both top and bottom are visible.
  const topVisible = visible.top !== null
  const bottomVisible = visible.bottom !== null
  if (topVisible && bottomVisible && visible.top!.length === 0 && visible.bottom!.length === 0) {
    lines.push('- naked')
  } else {
    if (topVisible) addSlot('top', joinOrFallback(visible.top!, 'topless'))
    if (bottomVisible) addSlot('bottom', joinOrFallback(visible.bottom!, 'bottomless'))
  }
  if (visible.footwear !== null) addSlot('footwear', joinOrFallback(visible.footwear, 'barefoot'))
  if (visible.accessories !== null) addSlot('accessories', joinOrFallback(visible.accessories, 'no accessories'))

  for (const [value, slotsForValue] of groups) {
    lines.push(`- **${slotsForValue.join(', ')}:** ${value}`)
  }

  return lines.join('\n') + '\n'
}
