/**
 * Conversation references for the research kit: which chats count as
 * conversations, and one resolver from an id or exact title to one.
 *
 * @module lib/research/conversations
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadata } from '@/lib/schemas/types'
import { foldName } from './text'

/** Conversation types an operator means by "conversations". */
export const CONVERSATION_CHAT_TYPES: ReadonlySet<string> = new Set(['salon', 'autonomous'])

/** Find a chat by id or exact (folded) title among conversations. */
export async function resolveConversationRef(ref: string): Promise<ChatMetadata | { ambiguous: ChatMetadata[] } | null> {
  const repos = getRepositories()
  const trimmed = ref.trim()
  try {
    const byId = await repos.chats.findById(trimmed)
    if (byId) return byId
  } catch {
    // Not an id.
  }
  const needle = foldName(trimmed)
  const all = (await repos.chats.findAll()).filter((c) => CONVERSATION_CHAT_TYPES.has(c.chatType ?? 'salon'))
  const exact = all.filter((c) => foldName(c.title || '') === needle)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return { ambiguous: exact }
  return null
}

