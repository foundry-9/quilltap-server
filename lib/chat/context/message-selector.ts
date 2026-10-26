/**
 * Message Selector
 *
 * Selects recent messages to fit within token budget.
 * Supports both single-character and multi-character message formats.
 */

import type { Provider } from '@/lib/schemas/types'
import { countMessageTokens, estimateTokens } from '@/lib/tokens/token-counter'

/**
 * Extended message type with optional participant info
 */
export interface SelectableMessage {
  role: string
  content: string
  id?: string
  thoughtSignature?: string | null
  name?: string
  participantId?: string | null
}

/**
 * Result of selecting recent messages
 */
export interface MessageSelectionResult {
  messages: SelectableMessage[]
  tokenCount: number
  truncated: boolean
}

/**
 * Select recent messages to fit within token budget
 * Supports both single-character and multi-character message formats
 */
export function selectRecentMessages(
  messages: SelectableMessage[],
  maxTokens: number,
  provider: Provider
): MessageSelectionResult {
  if (messages.length === 0) {
    return { messages: [], tokenCount: 0, truncated: false }
  }

  const selectedMessages: SelectableMessage[] = []
  let totalTokens = 0
  let truncated = false

  // Work backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const msgTokens = selectableMessageTokens(msg, provider)

    if (totalTokens + msgTokens > maxTokens) {
      truncated = true
      break
    }

    selectedMessages.unshift(keepFields(msg))
    totalTokens += msgTokens
  }

  // Ensure we have at least the last message if possible
  if (selectedMessages.length === 0 && messages.length > 0) {
    const lastMsg = messages[messages.length - 1]
    selectedMessages.push(keepFields(lastMsg))
    totalTokens = selectableMessageTokens(lastMsg, provider)
    truncated = true
  }

  return {
    messages: selectedMessages,
    tokenCount: totalTokens,
    truncated,
  }
}

/**
 * A history message's cost in the request: the shared per-message rule
 * (`countMessageTokens`, which the pre-send check also uses) plus the name
 * prefix a provider without a `name` field renders it under.
 */
export function selectableMessageTokens(msg: SelectableMessage, provider: Provider): number {
  const nameOverhead = msg.name ? estimateTokens(`[${msg.name}] `, provider) : 0
  return countMessageTokens(msg, provider) + nameOverhead
}

/**
 * Every field the request needs, `id` included: it is the source chat_messages
 * row, which the attachment anchor uses to tell the user's own turn from a
 * staff whisper wearing role=user (bug 95).
 */
function keepFields(msg: SelectableMessage): SelectableMessage {
  return {
    role: msg.role,
    content: msg.content,
    id: msg.id,
    thoughtSignature: msg.thoughtSignature,
    name: msg.name,
    participantId: msg.participantId,
  }
}
