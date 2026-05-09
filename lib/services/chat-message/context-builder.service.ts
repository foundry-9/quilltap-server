/**
 * Context Builder Service
 *
 * Handles building the LLM context for chat messages,
 * including message formatting, file attachments, and context management.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { buildContext, type MessageWithParticipant, type BuiltContext, type ContextCompressionResult } from '@/lib/chat/context-manager'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import { loadChatFilesForLLM } from '@/lib/chat-files-v2'
import { getErrorMessage } from '@/lib/error-utils'
import {
  processFileAttachmentFallback,
  formatFallbackAsMessagePrefix,
  type FallbackResult,
} from '@/lib/chat/file-attachment-fallback'
import { resolveTimezone } from '@/lib/chat/timestamp-utils'
import type { getRepositories } from '@/lib/repositories/factory'
import type {
  ChatMetadataBase,
  ChatParticipantBase,
  Character,
  ConnectionProfile,
  MessageEvent,
  TimestampConfig,
} from '@/lib/schemas/types'
import type { AttachedFile } from './types'

const logger = createServiceLogger('ContextBuilderService')

/**
 * Options for building message context
 */
export interface BuildMessageContextOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: ChatParticipantBase
  connectionProfile: ConnectionProfile
  userCharacter: { name: string; description: string } | null
  isMultiCharacter: boolean
  participantCharacters?: Map<string, Character>
  roleplayTemplate: { systemPrompt: string } | null
  chatSettings: { cheapLLMSettings?: Record<string, unknown>; defaultTimestampConfig?: TimestampConfig | null; timezone?: string | null } | null
  toolInstructions?: string
  newUserMessage?: string
  isContinueMode: boolean
  /** Context compression settings (if enabled) */
  contextCompressionSettings?: ContextCompressionSettings | null
  /** Cheap LLM selection for compression (required if compression is enabled) */
  cheapLLMSelection?: CheapLLMSelection | null
  /** Whether to bypass compression for this request */
  bypassCompression?: boolean
  /** Pre-computed compression result from async cache (avoids blocking on compression) */
  cachedCompressionResult?: ContextCompressionResult | null
  /**
   * Message count when the cached compression was computed.
   * Used to calculate dynamic window size when using a fallback cache.
   */
  cachedCompressionMessageCount?: number
  /** Pre-searched memories from proactive recall (skips internal memory search when provided) */
  preSearchedMemories?: SemanticSearchResult[]
  /** Whether to generate a memory recap for this character (chat start or character join) */
  generateMemoryRecap?: boolean
  /** Uncensored fallback options for memory recap in dangerous chats */
  uncensoredFallbackOptions?: UncensoredFallbackOptions
  /** Optional callback to emit status events during context building phases */
  onStatusChange?: (stage: string, message: string) => void
}

/**
 * Result of context building
 */
export interface MessageContextResult {
  builtContext: BuiltContext
  formattedMessages: Array<{
    role: string
    content: string
    attachments?: unknown[]
    name?: string
    thoughtSignature?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  }>
  isInitialMessage: boolean
}

/**
 * File processing result
 */
export interface FileProcessingResult {
  attachedFiles: AttachedFile[]
  fileAttachments: Awaited<ReturnType<typeof loadChatFilesForLLM>>
  fallbackResults: FallbackResult[]
  messageContentPrefix: string
  attachmentsToSend: Awaited<ReturnType<typeof loadChatFilesForLLM>>
}

/**
 * Load and process attached files for a message
 */
export async function loadAndProcessFiles(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  fileIds?: string[]
): Promise<FileProcessingResult> {
  if (!fileIds || fileIds.length === 0) {
    return {
      attachedFiles: [],
      fileAttachments: [],
      fallbackResults: [],
      messageContentPrefix: '',
      attachmentsToSend: [],
    }
  }

  // Use the repository to find files linked to the chat
  const chatFiles = await repos.files.findByLinkedTo(chatId)
  const matched = chatFiles.filter(file => fileIds.includes(file.id))

  const attachedFiles: AttachedFile[] = matched.map(file => ({
    id: file.id,
    filepath: `api/files/${file.id}`,
    filename: file.originalFilename,
    mimeType: file.mimeType,
    size: file.size,
  }))

  // Load file data for LLM with provider-aware image resizing
  const fileAttachments = await loadChatFilesForLLM(
    attachedFiles.map(f => f.id),
    { provider: connectionProfile.provider }
  )

  // Process file attachment fallbacks if provider doesn't support them
  const fallbackResults: FallbackResult[] = []
  let messageContentPrefix = ''

  for (let i = 0; i < fileAttachments.length; i++) {
    const fileAttachment = fileAttachments[i]
    const fileMetadata = attachedFiles[i]

    const fallbackResult = await processFileAttachmentFallback(
      fileMetadata,
      fileAttachment,
      connectionProfile,
      repos,
      userId
    )

    fallbackResults.push(fallbackResult)

    // Add fallback content to message prefix
    const fallbackPrefix = formatFallbackAsMessagePrefix(fallbackResult)
    if (fallbackPrefix) {
      messageContentPrefix += fallbackPrefix
    }
  }

  // Filter out attachments that were processed via fallback
  const attachmentsToSend = fileAttachments.filter((_, idx) => {
    const fallback = fallbackResults[idx]
    return !fallback || (fallback.type !== 'text' && fallback.type !== 'image_description')
  })

  return {
    attachedFiles,
    fileAttachments,
    fallbackResults,
    messageContentPrefix,
    attachmentsToSend,
  }
}

/**
 * Walk the tail of existingMessages and collect Lantern-image file IDs that
 * the given character has not yet seen, so they can be loaded as vision
 * content on the character's next LLM turn. A Lantern image is any image
 * file ID attached to an ASSISTANT-role message (story background, avatar
 * regeneration, or a `generate_image` tool invocation — all three pipelines
 * write the announcement through postLanternImageNotification).
 *
 * The walk stops at the character's own most recent ASSISTANT message —
 * anything older than that was already surfaced on a previous turn and
 * must not be re-delivered. A `historyCutoff` (ISO timestamp) can be
 * supplied for a joining character with no history access; images older
 * than the cutoff are skipped even on the character's first turn.
 *
 * `lookback` caps how many ASSISTANT messages we scan before giving up
 * (safety bound for very long chats).
 *
 * Returns file IDs in chronological order (oldest first), deduped.
 *
 * Exported for unit testing.
 */
export function collectLanternImageFileIdsForCharacter(
  existingMessages: Array<{ type: string; role?: string; attachments?: string[] | null; participantId?: string | null; createdAt?: string }>,
  characterParticipantId: string,
  isMultiCharacter: boolean,
  historyCutoff: string | null,
  lookback: number,
): string[] {
  const collected: string[] = []
  const seen = new Set<string>()
  let scanned = 0
  for (let i = existingMessages.length - 1; i >= 0 && scanned < lookback; i--) {
    const msg = existingMessages[i]
    if (msg.type !== 'message' || msg.role !== 'ASSISTANT') continue

    const atts = msg.attachments
    const hasAttachments = Array.isArray(atts) && atts.length > 0

    // Detect the character's own previous ASSISTANT turn. Anything older than
    // that was already delivered, so we stop the walk there.
    //
    // Multi-character chats set `participantId` on every character response,
    // while Lantern notifications leave it null — a direct id match is enough.
    //
    // Single-character chats don't populate participantId on character
    // responses, so we fall back to the structural signal: Lantern
    // notifications always carry image attachments, character responses
    // don't. An ASSISTANT message without attachments is therefore the
    // character's own prior turn.
    const isOwnPriorResponse = isMultiCharacter
      ? msg.participantId === characterParticipantId
      : !hasAttachments
    if (isOwnPriorResponse) break

    scanned++

    if (!hasAttachments) continue

    // History-access guard: a participant joining mid-chat without history
    // access must not see images from before they joined.
    if (historyCutoff && msg.createdAt && msg.createdAt < historyCutoff) continue

    for (const fileId of atts!) {
      if (typeof fileId === 'string' && !seen.has(fileId)) {
        seen.add(fileId)
        collected.push(fileId)
      }
    }
  }
  return collected.reverse()
}

/**
 * Build conversation messages for context
 */
export function buildConversationMessages(
  existingMessages: Array<{ type: string; role?: string; content?: string; id?: string; thoughtSignature?: string | null; participantId?: string | null; targetParticipantIds?: string[] | null; createdAt?: string }>,
  isMultiCharacter: boolean
): {
  conversationMessages: Array<{ role: string; content: string; id?: string; thoughtSignature?: string | null }>
  messagesWithParticipants?: MessageWithParticipant[]
} {
  // Filter existing messages to include USER, ASSISTANT, and TOOL messages (exclude SYSTEM)
  const conversationMessages = existingMessages
    .filter(msg => msg.type === 'message')
    .filter(msg => {
      const role = msg.role
      return role === 'USER' || role === 'ASSISTANT' || role === 'TOOL'
    })
    .map(msg => {
      // For TOOL messages, parse the content and format as a user message
      if (msg.role === 'TOOL') {
        try {
          const toolData = JSON.parse(msg.content || '{}')
          const resultText = toolData.result || 'No result'
          // Handle both LLM-initiated (toolName) and user-initiated (tool) field names
          const toolName = toolData.toolName || toolData.tool || 'Unknown'

          return {
            role: 'USER' as const,
            content: `[Tool Result: ${toolName}]\n${resultText}`,
            id: msg.id,
          }
        } catch {
          return null
        }
      }

      return {
        role: msg.role as string,
        content: msg.content as string,
        id: msg.id,
        thoughtSignature: msg.role === 'ASSISTANT' ? msg.thoughtSignature : undefined,
      }
    })
    .filter((msg): msg is NonNullable<typeof msg> => msg !== null)

  // Build messages with participant info for multi-character context
  let messagesWithParticipants: MessageWithParticipant[] | undefined

  if (isMultiCharacter) {
    messagesWithParticipants = existingMessages
      .filter(msg => msg.type === 'message')
      .filter(msg => {
        const role = msg.role
        return role === 'USER' || role === 'ASSISTANT' || role === 'TOOL'
      })
      .map(msg => {
        if (msg.role === 'TOOL') {
          try {
            const toolData = JSON.parse(msg.content || '{}')
            const resultText = toolData.result || 'No result'
            // Handle both LLM-initiated (toolName) and user-initiated (tool) field names
            const toolName = toolData.toolName || toolData.tool || 'Unknown'

            return {
              role: 'USER' as const,
              content: `[Tool Result: ${toolName}]\n${resultText}`,
              id: msg.id,
              createdAt: msg.createdAt,
              participantId: null,
            }
          } catch {
            return null
          }
        }

        return {
          role: msg.role as string,
          content: msg.content as string,
          id: msg.id,
          thoughtSignature: msg.role === 'ASSISTANT' ? msg.thoughtSignature : undefined,
          participantId: msg.participantId,
          targetParticipantIds: (msg as any).targetParticipantIds || null,
          createdAt: msg.createdAt,
        }
      })
      .filter((msg): msg is NonNullable<typeof msg> => msg !== null)
  }

  return { conversationMessages, messagesWithParticipants }
}

/**
 * Build the full message context for the LLM
 */
export async function buildMessageContext(
  options: BuildMessageContextOptions,
  existingMessages: Array<{ type: string; role?: string; content?: string; id?: string; thoughtSignature?: string | null; participantId?: string | null; targetParticipantIds?: string[] | null; createdAt?: string; attachments?: string[] | null; systemSender?: string | null }>,
  attachmentsToSend: unknown[]
): Promise<MessageContextResult> {
  const {
    userId,
    chat,
    character,
    characterParticipant,
    connectionProfile,
    userCharacter,
    isMultiCharacter,
    participantCharacters,
    roleplayTemplate,
    chatSettings,
    toolInstructions,
    newUserMessage,
    contextCompressionSettings,
    cheapLLMSelection,
    bypassCompression,
    cachedCompressionResult,
    cachedCompressionMessageCount,
    preSearchedMemories,
    generateMemoryRecap: requestMemoryRecap,
    uncensoredFallbackOptions,
  } = options

  // Drop persisted Commonplace Book whispers from LLM context. They live in
  // the transcript for UI visibility, but recall is recomputed per turn and
  // inlined into the new user message body — past whispers piling up across
  // turns would just bloat the context window with stale recall. This filter
  // applies regardless of system transparency.
  const cmpbStrippedCount = existingMessages.filter(m => m.systemSender === 'commonplaceBook').length
  const messagesWithoutCmpb = cmpbStrippedCount > 0
    ? existingMessages.filter(m => m.systemSender !== 'commonplaceBook')
    : existingMessages
  if (cmpbStrippedCount > 0) {
  }

  // Drop TOOL whispers the responding character isn't a target of. Operator-
  // only Prospero runs (run-tool with `private: true`) target the userId, so
  // no character participant ever matches and the message is filtered out of
  // every context. Multi-character mode also runs `filterWhisperMessages`
  // downstream — this filter just makes sure single-character context honors
  // the same rule.
  const respondingParticipantId = characterParticipant?.id
  const messagesAfterWhisperFilter = respondingParticipantId
    ? messagesWithoutCmpb.filter(m => {
        if (m.role !== 'TOOL') return true
        const targets = m.targetParticipantIds
        if (!targets || targets.length === 0) return true
        if (m.participantId === respondingParticipantId) return true
        return targets.includes(respondingParticipantId)
      })
    : messagesWithoutCmpb

  // System transparency: opaque characters (systemTransparency != true) still
  // need the *content* of remaining Staff (Lantern/Aurora/Librarian/Prospero/
  // Host) messages — scenario, status, etc. drive the conversation forward —
  // but they should not see the Staff *attribution*. For opaque characters we
  // strip the systemSender field so the LLM reads these as generic assistant
  // messages. The salon UI is unaffected (the human user always sees Staff-
  // attributed messages with their avatars).
  const filteredExistingMessages = character.systemTransparency === true
    ? messagesAfterWhisperFilter
    : messagesAfterWhisperFilter.map(m => m.systemSender ? { ...m, systemSender: null } : m)
  if (character.systemTransparency !== true) {
    const stripped = messagesAfterWhisperFilter.filter(m => m.systemSender).length
    if (stripped > 0) {
    }
  }

  // Build conversation messages
  const { conversationMessages, messagesWithParticipants } = buildConversationMessages(
    filteredExistingMessages,
    isMultiCharacter
  )

  // Determine if this is the first user message (for timestamp START_ONLY mode)
  const isInitialMessage = conversationMessages.filter(m => m.role === 'user' || m.role === 'USER').length === 0

  // Detect if this is the first time this character is responding in this chat
  // (either it's the very first message, or this character just joined an existing chat)
  const isCharacterFirstResponse = isInitialMessage || (
    isMultiCharacter &&
    characterParticipant &&
    !characterParticipant.hasHistoryAccess &&
    messagesWithParticipants !== undefined &&
    !messagesWithParticipants.some(
      m => m.participantId === characterParticipant.id &&
           (m.role === 'assistant' || m.role === 'ASSISTANT')
    )
  )

  // Generate memory recap on first message or character join, unless explicitly overridden
  const shouldGenerateRecap = requestMemoryRecap ?? isCharacterFirstResponse

  // Get timestamp config from chat or user defaults
  const timestampConfig = chat.timestampConfig || chatSettings?.defaultTimestampConfig || null

  // Resolve timezone from fallback chain: per-chat → Salon settings → QUILLTAP_TIMEZONE env var → system default
  const timezone = resolveTimezone(
    timestampConfig?.timezone,
    chatSettings?.timezone
  )

  // Build context with intelligent token management
  const builtContext = await buildContext({
    provider: connectionProfile.provider,
    modelName: connectionProfile.modelName,
    userId,
    character,
    userCharacter,
    chat,
    existingMessages: conversationMessages,
    newUserMessage,
    roleplayTemplate,
    embeddingProfileId: undefined, // always use default embedding profile
    skipMemories: false,
    minMemoryImportance: 0.5,
    // Multi-character context building options
    // Phase H: pass the responding participant in both single- and multi-
    // character chats so the system-prompt compiler cache can hit on
    // single-char chats too.
    respondingParticipant: characterParticipant,
    allParticipants: isMultiCharacter ? chat.participants : undefined,
    participantCharacters: isMultiCharacter ? participantCharacters : undefined,
    messagesWithParticipants: isMultiCharacter ? messagesWithParticipants : undefined,
    // Tool instructions (native tool rules or text-block tool instructions)
    toolInstructions,
    // Timestamp injection
    timestampConfig,
    isInitialMessage,
    timezone,
    // Connection profile (for budget-driven compression)
    connectionProfile,
    // Context compression
    contextCompressionSettings,
    cheapLLMSelection,
    bypassCompression,
    cachedCompressionResult,
    cachedCompressionMessageCount,
    // Proactive memory recall
    preSearchedMemories,
    // Memory recap (chat start or character join)
    generateMemoryRecap: shouldGenerateRecap,
    uncensoredFallbackOptions,
    // Status callback for streaming events
    onStatusChange: options.onStatusChange,
  })

  // Log context building results for debugging
  if (builtContext.warnings.length > 0) {
    logger.warn('Context Manager warnings', { warnings: builtContext.warnings })
  }

  // Apply provider-aware message formatting for multi-character support
  const formattedContextMessages = isMultiCharacter
    ? formatMessagesForProvider(
        builtContext.messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          name: msg.name,
          thoughtSignature: msg.thoughtSignature,
        })),
        connectionProfile.provider,
        character.name
      )
    : builtContext.messages

  // Additionally surface image attachments from Lantern notifications
  // (story background, avatar regeneration, or the generate_image tool).
  // Without this, vision-capable providers would only see the announcement
  // text but not the actual image. We piggy-back on the existing
  // attachments-on-last-user-turn mechanism so non-vision providers still
  // get the text fallback, and the collector scopes the set to images this
  // character hasn't seen yet so they aren't re-delivered every turn.
  const ASSISTANT_IMAGE_LOOKBACK = 6
  let mergedAttachmentsToSend: unknown[] = attachmentsToSend
  try {
    // If this is a joining character without history access and they have
    // not yet responded, clamp the walk to messages posted after they joined.
    // Use the filtered set so opaque characters never reach Staff (Lantern et
    // al.) image attachments either — symmetric with their text-side filter.
    const hasPriorResponse = filteredExistingMessages.some(
      m => m.type === 'message' && m.role === 'ASSISTANT' && m.participantId === characterParticipant.id
    )
    const historyCutoff = (isMultiCharacter && !characterParticipant.hasHistoryAccess && !hasPriorResponse)
      ? (characterParticipant.createdAt ?? null)
      : null

    const recentAssistantImageFileIds = collectLanternImageFileIdsForCharacter(
      filteredExistingMessages,
      characterParticipant.id,
      isMultiCharacter,
      historyCutoff,
      ASSISTANT_IMAGE_LOOKBACK,
    )
    if (recentAssistantImageFileIds.length > 0) {
      const extra = await loadChatFilesForLLM(recentAssistantImageFileIds, {
        provider: connectionProfile.provider,
      })
      if (extra.length > 0) {
        mergedAttachmentsToSend = [...attachmentsToSend, ...extra]
      }
    }
  } catch (err) {
    logger.warn('Failed to load recent assistant image attachments for vision', {
      error: getErrorMessage(err),
    })
  }

  // Prepare final messages for LLM
  const formattedMessages = formattedContextMessages.map((msg, idx) => {
    if (idx === formattedContextMessages.length - 1 && msg.role === 'user' && mergedAttachmentsToSend.length > 0) {
      return {
        role: msg.role,
        content: msg.content,
        attachments: mergedAttachmentsToSend,
        name: msg.name,
      }
    }
    return {
      role: msg.role,
      content: msg.content,
      thoughtSignature: msg.thoughtSignature ?? undefined,
      name: msg.name,
    }
  })

  // In multi-character chats, anchor the model's response to the correct
  // character identity. The [Name] prefix is stripped by
  // stripCharacterNamePrefix() downstream.
  //
  // Anthropic 4.6+ rejects requests that end with an assistant message, and
  // older Claude models follow a system instruction reliably enough that we
  // use the same path for every Anthropic model rather than maintain a
  // per-model allowlist.
  if (isMultiCharacter) {
    if (connectionProfile.provider === 'ANTHROPIC') {
      const systemIdx = formattedMessages.findIndex(m => m.role === 'system')
      if (systemIdx >= 0) {
        formattedMessages[systemIdx] = {
          ...formattedMessages[systemIdx],
          content: formattedMessages[systemIdx].content +
            `\n\nIMPORTANT: You are ${character.name}. Always begin your response with [${character.name}] to identify yourself.`,
        }
      }
    } else {
      formattedMessages.push({
        role: 'assistant',
        content: `[${character.name}]`,
        thoughtSignature: undefined,
        name: undefined,
      })
    }
  }

  return {
    builtContext,
    formattedMessages,
    isInitialMessage,
  }
}
