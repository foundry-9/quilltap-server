/**
 * Scriptorium Markdown Renderer
 *
 * Deterministic (no LLM) renderer that converts chat messages into
 * numbered, structured Markdown organized by interchanges.
 *
 * @module scriptorium/markdown-renderer
 */

import { stripToolArtifacts } from '@/lib/memory/cheap-llm-tasks/chat-tasks'
import { createServiceLogger } from '@/lib/logging/create-logger'
import type { ChatEvent, ChatParticipantBase } from '@/lib/schemas/types'
import type { InterchangeInfo, RenderedConversation } from '@/lib/schemas/scriptorium.types'

const logger = createServiceLogger('ScriptoriumRenderer')

/**
 * Renders a chat conversation into numbered, structured Markdown.
 *
 * Messages are filtered to visible content (type='message', role USER or ASSISTANT),
 * tool artifacts are stripped from assistant messages, and the result is organized
 * into interchanges (a new interchange starts at each USER message).
 *
 * @param messages - Raw chat events from the conversation
 * @param participants - Chat participant metadata
 * @param characterNames - Map of participantId to display name
 * @returns Rendered conversation with full markdown and structured interchange data
 */
export function renderConversationMarkdown(
  messages: ChatEvent[],
  participants: ChatParticipantBase[],
  characterNames: Map<string, string>,
): RenderedConversation {
  logger.debug('Rendering conversation markdown', {
    messageCount: messages.length,
    participantCount: participants.length,
    characterNameCount: characterNames.size,
  })

  // Filter to visible messages and prepare for rendering
  const visibleMessages: Array<{
    id: string
    role: string
    content: string
    participantId: string | null | undefined
  }> = []

  for (const m of messages) {
    if (m.type !== 'message') continue
    const role = (m.role || '').toUpperCase()
    if (role !== 'USER' && role !== 'ASSISTANT') continue
    if (!m.content) continue

    if (role === 'ASSISTANT') {
      const cleaned = stripToolArtifacts(m.content)
      if (!cleaned) continue
      visibleMessages.push({
        id: m.id,
        role,
        content: cleaned,
        participantId: m.participantId,
      })
    } else {
      visibleMessages.push({
        id: m.id,
        role,
        content: m.content,
        participantId: m.participantId,
      })
    }
  }

  logger.debug('Filtered to visible messages', { visibleCount: visibleMessages.length })

  // Resolve display name for a message
  function resolveDisplayName(role: string, participantId: string | null | undefined): string {
    if (participantId && characterNames.has(participantId)) {
      return characterNames.get(participantId)!
    }
    if (role === 'USER') return 'User'
    // For ASSISTANT without a mapped name, fall back to 'Assistant'
    return 'Assistant'
  }

  // Group into interchanges: a new interchange starts at each USER message
  const interchanges: InterchangeInfo[] = []
  let currentInterchange: {
    messageIds: string[]
    participantNames: Set<string>
    lines: string[]
  } | null = null
  let interchangeIndex = 0
  let globalMessageIndex = 0

  for (const msg of visibleMessages) {
    const displayName = resolveDisplayName(msg.role, msg.participantId)

    // Start a new interchange at each USER message, or for the very first message
    if (msg.role === 'USER' || currentInterchange === null) {
      // Finalize previous interchange if any
      if (currentInterchange !== null) {
        interchanges.push({
          index: interchangeIndex,
          messageIds: currentInterchange.messageIds,
          participantNames: Array.from(currentInterchange.participantNames),
          content: currentInterchange.lines.join('\n'),
        })
        interchangeIndex++
      }

      currentInterchange = {
        messageIds: [],
        participantNames: new Set(),
        lines: [`## Interchange ${interchangeIndex}`, ''],
      }
    }

    // Render this message
    const messageHeader = `### Message ${globalMessageIndex} (${displayName})`
    const messageBlock = `${messageHeader}\n\n${msg.content}\n`

    currentInterchange.messageIds.push(msg.id)
    currentInterchange.participantNames.add(displayName)
    currentInterchange.lines.push(messageBlock)

    globalMessageIndex++
  }

  // Finalize the last interchange
  if (currentInterchange !== null) {
    interchanges.push({
      index: interchangeIndex,
      messageIds: currentInterchange.messageIds,
      participantNames: Array.from(currentInterchange.participantNames),
      content: currentInterchange.lines.join('\n'),
    })
  }

  // Build the full markdown
  const markdown = interchanges.map(ic => ic.content).join('\n')

  logger.debug('Rendered conversation', {
    interchangeCount: interchanges.length,
    totalMessages: globalMessageIndex,
    markdownLength: markdown.length,
  })

  return { markdown, interchanges }
}
