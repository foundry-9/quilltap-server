/**
 * Context Builder Service
 *
 * Handles building the LLM context for chat messages,
 * including message formatting, file attachments, and context management.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { buildContext, type MessageWithParticipant, type BuiltContext, type ProjectContext, type ContextCompressionResult } from '@/lib/chat/context-manager'
import type { SemanticSearchResult } from '@/lib/memory/memory-service'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import { modelSupportsPrefill } from '@/lib/plugins/provider-registry'
import { loadChatFilesForLLM } from '@/lib/chat-files-v2'
import { getErrorMessage } from '@/lib/errors'
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
  /** Project context if chat is in a project */
  projectContext?: ProjectContext | null
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
  /** Status change notifications to include in prompt */
  statusChangeNotifications?: string[]
  /** Outfit change notifications from manual sidebar changes */
  outfitChangeNotifications?: string[]
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
 * Walk the tail of the existingMessages array, picking out ASSISTANT messages
 * that carry image file IDs on their `attachments` array, up to a lookback
 * window. Returns the file IDs in chronological order (oldest first),
 * deduped, so they can be loaded as vision content for the next LLM turn.
 */
function collectRecentAssistantImageFileIds(
  existingMessages: Array<{ type: string; role?: string; attachments?: string[] | null }>,
  lookback: number,
): string[] {
  const collected: string[] = []
  const seen = new Set<string>()
  let scanned = 0
  for (let i = existingMessages.length - 1; i >= 0 && scanned < lookback; i--) {
    const msg = existingMessages[i]
    if (msg.type !== 'message' || msg.role !== 'ASSISTANT') continue
    scanned++
    const atts = msg.attachments
    if (!atts || atts.length === 0) continue
    for (const fileId of atts) {
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
  existingMessages: Array<{ type: string; role?: string; content?: string; id?: string; thoughtSignature?: string | null; participantId?: string | null; targetParticipantIds?: string[] | null; createdAt?: string; attachments?: string[] | null }>,
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
    projectContext,
    contextCompressionSettings,
    cheapLLMSelection,
    bypassCompression,
    cachedCompressionResult,
    cachedCompressionMessageCount,
    preSearchedMemories,
    generateMemoryRecap: requestMemoryRecap,
    uncensoredFallbackOptions,
  } = options

  // Build conversation messages
  const { conversationMessages, messagesWithParticipants } = buildConversationMessages(
    existingMessages,
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
    maxMemories: 18,
    minMemoryImportance: 0.5,
    // Multi-character context building options
    respondingParticipant: isMultiCharacter ? characterParticipant : undefined,
    allParticipants: isMultiCharacter ? chat.participants : undefined,
    participantCharacters: isMultiCharacter ? participantCharacters : undefined,
    messagesWithParticipants: isMultiCharacter ? messagesWithParticipants : undefined,
    // Tool instructions (native tool rules or text-block tool instructions)
    toolInstructions,
    // Timestamp injection
    timestampConfig,
    isInitialMessage,
    timezone,
    // Project context
    projectContext,
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
    // Status change notifications
    statusChangeNotifications: options.statusChangeNotifications,
    // Outfit change notifications
    outfitChangeNotifications: options.outfitChangeNotifications,
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

  // Additionally surface image attachments from recent ASSISTANT messages
  // (e.g. Lantern notifications announcing generated images). Without this,
  // vision-capable providers only see the announcement text but not the
  // actual image. We piggy-back on the existing attachments-on-last-user-turn
  // mechanism so non-vision providers still get the text fallback.
  const ASSISTANT_IMAGE_LOOKBACK = 6
  let mergedAttachmentsToSend: unknown[] = attachmentsToSend
  try {
    const recentAssistantImageFileIds = collectRecentAssistantImageFileIds(
      existingMessages,
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
  if (isMultiCharacter) {
    const prefillSupported = modelSupportsPrefill(
      connectionProfile.provider,
      connectionProfile.modelName
    )

    if (prefillSupported) {
      // Traditional approach: append an assistant prefill message to force
      // the LLM to continue as the designated character.
      formattedMessages.push({
        role: 'assistant',
        content: `[${character.name}]`,
        thoughtSignature: undefined,
        name: undefined,
      })
    } else {
      // For models that don't support assistant prefill (e.g., Claude 4.6),
      // add an explicit instruction to the system prompt instead.
      logger.debug('Model does not support assistant prefill, using system prompt instruction', {
        provider: connectionProfile.provider,
        model: connectionProfile.modelName,
        character: character.name,
      })
      const systemIdx = formattedMessages.findIndex(m => m.role === 'system')
      if (systemIdx >= 0) {
        formattedMessages[systemIdx] = {
          ...formattedMessages[systemIdx],
          content: formattedMessages[systemIdx].content +
            `\n\nIMPORTANT: You are ${character.name}. Always begin your response with [${character.name}] to identify yourself.`,
        }
      }
    }
  }

  return {
    builtContext,
    formattedMessages,
    isInitialMessage,
  }
}
