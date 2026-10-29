/**
 * Shared helpers for the MessageRow subcomponents.
 */

import type { Message } from '../../types'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import { diagramStyleOrDefault, type DiagramStyle } from '@/lib/markdown/diagrams'

/** The message's image attachments (filtered by image/* MIME type). */
export function getImageAttachments(message: Message) {
  return (message.attachments || []).filter(a => a.mimeType.startsWith('image/'))
}

/**
 * Whose hand a message's diagrams are drawn in. A character's line — an
 * ASSISTANT turn, or a USER line spoken through a user-controlled character —
 * takes that character's `diagramStyle` (absent reads as hand-drawn). The
 * operator speaking as no one, and every Staff sender, draw `clean`.
 */
export function resolveMessageDiagramStyle(
  message: Pick<Message, 'participantId' | 'systemSender'>,
  participants: ReadonlyArray<Pick<ParticipantData, 'id' | 'character'>>,
): DiagramStyle {
  if (message.systemSender) return 'clean'
  if (!message.participantId) return 'clean'
  const character = participants.find((p) => p.id === message.participantId)?.character
  return character ? diagramStyleOrDefault(character.diagramStyle) : 'clean'
}
