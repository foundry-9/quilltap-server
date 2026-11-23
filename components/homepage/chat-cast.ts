/**
 * Who is in a chat, as the home page shows it.
 *
 * @module components/homepage/chat-cast
 */

import type { RecentChat } from './types'

export type CastMember = NonNullable<RecentChat['participants'][number]['character']>

/** How many names a cast line spells out before it counts the rest. */
const CAST_NAMES_SHOWN = 4

/** The chat's active characters, in seat order. */
export function activeCast(chat: RecentChat): CastMember[] {
  return chat.participants
    .filter(p => p.type === 'CHARACTER' && p.isActive && p.character)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(p => p.character!)
}

/** "Amy + Laura", or "Amy + Laura + Abigail + Friday + 2 more" for a crowd. */
export function castNames(cast: CastMember[]): string {
  if (cast.length === 0) return 'Unknown'
  if (cast.length <= CAST_NAMES_SHOWN) return cast.map(c => c.name).join(' + ')
  const shown = cast.slice(0, CAST_NAMES_SHOWN).map(c => c.name).join(' + ')
  return `${shown} + ${cast.length - CAST_NAMES_SHOWN} more`
}

/** Every character tag in the chat: what quick-hide asks about. */
export function chatCharacterTags(chat: RecentChat): string[] {
  return chat.participants.flatMap(p => p.character?.tags ?? [])
}

/** "1 message" / "93 messages". */
export function messageCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'message' : 'messages'}`
}
