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
import type { InterchangeInfo, RenderedConversation, ConversationMetadata } from '@/lib/schemas/scriptorium.types'

const logger = createServiceLogger('ScriptoriumRenderer')

/**
 * Format an ISO 8601 timestamp as a human-readable date and time.
 * Example: "April 11, 2026 at 3:45 PM"
 */
function formatDateTime(iso: string): string {
  try {
    const date = new Date(iso)
    const datePart = date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    const timePart = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
    return `${datePart} at ${timePart}`
  } catch {
    return iso
  }
}

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
 * @param metadata - Optional conversation metadata for header
 * @returns Rendered conversation with full markdown and structured interchange data
 */
export function renderConversationMarkdown(
  messages: ChatEvent[],
  participants: ChatParticipantBase[],
  characterNames: Map<string, string>,
  metadata?: ConversationMetadata,
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
    createdAt: string
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
        createdAt: m.createdAt,
      })
    } else {
      visibleMessages.push({
        id: m.id,
        role,
        content: m.content,
        participantId: m.participantId,
        createdAt: m.createdAt,
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

    // Render this message with timestamp
    const messageTimestamp = formatDateTime(msg.createdAt)
    const messageHeader = `### Message ${globalMessageIndex} (${displayName})`
    const messageBlock = `Past conversation message timestamp: ${messageTimestamp}\n\n${messageHeader}\n\n${msg.content}\n`

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

  // Build metadata header if metadata is provided
  let metadataHeader = ''
  if (metadata) {
    // Collect all unique participant display names
    const allParticipantNames = new Set<string>()
    for (const ic of interchanges) {
      for (const name of ic.participantNames) {
        allParticipantNames.add(name)
      }
    }

    // Derive conversation time span from first/last visible message timestamps
    const firstMessageTime = visibleMessages.length > 0 ? visibleMessages[0].createdAt : metadata.createdAt
    const lastMessageTime = visibleMessages.length > 0 ? visibleMessages[visibleMessages.length - 1].createdAt : metadata.lastUpdatedAt

    const firstDate = new Date(firstMessageTime)
    const lastDate = new Date(lastMessageTime)
    const sameDay = firstDate.toLocaleDateString('en-US') === lastDate.toLocaleDateString('en-US')

    const spanDatePart = firstDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const spanFromTime = firstDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const spanToTime = lastDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

    const spanText = sameDay
      ? `${spanDatePart} from ${spanFromTime} to ${spanToTime}`
      : `${formatDateTime(firstMessageTime)} to ${formatDateTime(lastMessageTime)}`

    const nowText = formatDateTime(new Date().toISOString())

    metadataHeader = [
      `# Conversation: ${metadata.title}`,
      '',
      '**Metadata:**',
      `- Conversation ID: ${metadata.conversationId}`,
      `- Created: ${formatDateTime(metadata.createdAt)}`,
      `- Last Updated: ${formatDateTime(metadata.lastUpdatedAt)}`,
      `- Participants: ${Array.from(allParticipantNames).join(', ') || 'None'}`,
      `- Message Count: ${globalMessageIndex}`,
      `- Interchange Count: ${interchanges.length}`,
      '',
      '---',
      '',
      `\u26A0\uFE0F ARCHIVE VIEW \u2014 This conversation occurred on ${spanText}.`,
      `Current time: ${nowText}. You are reading history, not in active conversation.`,
      '',
      '---',
      '',
    ].join('\n')

    // Prepend metadata header to interchange 0's content so it's embedded with chunk 0
    if (interchanges.length > 0) {
      interchanges[0] = {
        ...interchanges[0],
        content: metadataHeader + interchanges[0].content,
      }
    }
  }

  // Build the full markdown
  // When metadata is present, it's already in interchange 0's content,
  // so the join naturally includes it at the top
  const markdown = interchanges.map(ic => ic.content).join('\n')

  logger.debug('Rendered conversation', {
    interchangeCount: interchanges.length,
    totalMessages: globalMessageIndex,
    markdownLength: markdown.length,
    hasMetadata: !!metadata,
  })

  return { markdown, interchanges }
}
