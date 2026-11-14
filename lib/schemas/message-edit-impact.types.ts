/**
 * What editing a Salon line would disturb — the shape `GET
 * /api/v1/messages/[id]?action=edit-impact` returns and the Salon's editor
 * reads. Computed by `assessMessageEditImpact`
 * (`lib/services/chat-message/message-edit-impact.ts`). Client-safe.
 */

/** The path that formed an edited line's memories. */
export type EditedMessageMemorySourceKind = 'turn' | 'carina' | 'established-fact'

export interface MessageEditImpact {
  /** A model has (very probably) read this line since it landed. */
  seenByLlm: boolean
  /** Logged model calls in this chat since the line landed, the line's own generation excepted. */
  laterLlmCalls: number
  /** Character lines posted after this one — the fallback signal when logging is off. */
  laterCharacterLines: number
  /** Memories formed from this line (for a conversation line: from its turn). */
  memoryCount: number
  /** The path that formed them; null when the line feeds no memories. */
  memorySource: EditedMessageMemorySourceKind | null
  /** Whether a regenerate can run: memories exist and there is a profile to extract with. */
  canRegenerateMemories: boolean
}
