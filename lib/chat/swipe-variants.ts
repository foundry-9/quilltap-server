/**
 * Which variant of a swipe group is the line the story kept.
 *
 * A regenerate appends a variant to the line's swipe group and leaves the
 * others stored beside it. The server keeps no record of which variant the
 * operator is looking at (that is the Salon's client state), and the Salon
 * shows the newest one by default, so the server reads the newest — highest
 * `swipeIndex`, later in stored order on a tie — as the line that stands.
 *
 * Pure and client-safe.
 *
 * @module lib/chat/swipe-variants
 */

interface SwipeVariant {
  id: string
  swipeGroupId?: string | null
  swipeIndex?: number | null
}

/**
 * The newest variant's id for every swipe group in `messages`.
 */
export function liveSwipeVariantIds<T extends SwipeVariant>(messages: readonly T[]): Map<string, string> {
  const live = new Map<string, { id: string; index: number }>()
  for (const m of messages) {
    if (!m.swipeGroupId) continue
    const index = m.swipeIndex ?? 0
    const current = live.get(m.swipeGroupId)
    if (!current || index >= current.index) live.set(m.swipeGroupId, { id: m.id, index })
  }
  return new Map([...live].map(([group, v]) => [group, v.id]))
}

/**
 * `messages` without the swipe variants a later regenerate replaced, order kept.
 * A message outside any swipe group is always kept.
 */
export function withoutSupersededSwipes<T extends SwipeVariant>(messages: readonly T[]): T[] {
  const live = liveSwipeVariantIds(messages)
  if (live.size === 0) return [...messages]
  return messages.filter(m => !m.swipeGroupId || live.get(m.swipeGroupId) === m.id)
}
