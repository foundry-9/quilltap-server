/**
 * Context Manager
 * Sprint 5: Context Management
 * Phase 3: Multi-Character Context Building
 *
 * Intelligently builds LLM context within token budgets.
 * Handles system prompts, memory injection, conversation summaries,
 * and message selection to stay within model limits.
 *
 * Multi-character support:
 * - Formats messages with participant attribution (name field or prefix fallback)
 * - Respects hasHistoryAccess for late-joining participants
 * - Includes other participants in system prompt for context
 */

import { Provider, Character, ChatParticipantBase, ChatMetadataBase, TimestampConfig } from '@/lib/schemas/types'
import { estimateTokens, countMessagesTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { getModelContextLimit, getRecommendedContextAllocation, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { searchMemoriesSemantic, type SemanticSearchResult } from '@/lib/memory/memory-service'
import { generateMemoryRecap, type MemoryRecapResult } from '@/lib/memory/memory-recap'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks'

// Import from extracted modules
import {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  type OtherParticipantInfo,
  type ProjectContext,
} from './context/system-prompt-builder'
import {
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatSummaryForContext,
  type DebugMemoryInfo,
} from './context/memory-injector'
import {
  filterMessagesByHistoryAccess,
  filterWhisperMessages,
  getParticipantName,
  attributeMessagesForCharacter,
  findUserParticipantName,
  type MessageWithParticipant,
} from './context/message-attribution'
import {
  selectRecentMessages,
  type SelectableMessage,
} from './context/message-selector'
import {
  shouldApplyCompression,
  splitMessagesForCompression,
  applyContextCompression,
  buildCompressedSystemMessage,
  type ContextCompressionOptions,
  type ContextCompressionResult,
} from './context/compression'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'

// Re-export types from extracted modules for backwards compatibility
export type { OtherParticipantInfo, ProjectContext } from './context/system-prompt-builder'
export type { MessageWithParticipant } from './context/message-attribution'
export type { SelectableMessage } from './context/message-selector'
export type { ContextCompressionOptions, ContextCompressionResult } from './context/compression'

// Re-export functions from extracted modules for backwards compatibility
export {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatSummaryForContext,
  filterMessagesByHistoryAccess,
  filterWhisperMessages,
  getParticipantName,
  attributeMessagesForCharacter,
  selectRecentMessages,
}

/**
 * Message format expected by the context manager
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** Optional metadata for the message */
  metadata?: {
    messageId?: string
    tokenCount?: number
    isInjected?: boolean
  }
  /** Google Gemini thought signature for thinking models (e.g., gemini-3-pro) */
  thoughtSignature?: string | null
  /** Optional name for multi-character chats (provider-dependent support) */
  name?: string
}

/**
 * Context budget allocation
 */
export interface ContextBudget {
  /** Total context window size for the model */
  totalLimit: number
  /** Tokens allocated for system prompt */
  systemPromptBudget: number
  /** Tokens allocated for memories */
  memoryBudget: number
  /** Tokens allocated for conversation summary */
  summaryBudget: number
  /** Tokens allocated for recent messages */
  recentMessagesBudget: number
  /** Tokens reserved for response */
  responseReserve: number
}

/**
 * Result of context building
 */
export interface BuiltContext {
  /** Messages ready to send to LLM */
  messages: ContextMessage[]
  /** Token usage breakdown */
  tokenUsage: {
    systemPrompt: number
    memories: number
    summary: number
    recentMessages: number
    total: number
  }
  /** Context budget that was used */
  budget: ContextBudget
  /** Whether a conversation summary was included */
  includedSummary: boolean
  /** Number of memories included */
  memoriesIncluded: number
  /** Number of messages included */
  messagesIncluded: number
  /** Whether messages were truncated to fit */
  messagesTruncated: boolean
  /** Warnings generated during context building */
  warnings: string[]
  /** Debug info: the actual memories that were included */
  debugMemories?: Array<{ summary: string; importance: number; score: number; effectiveWeight: number }>
  /** Debug info: the conversation summary that was included */
  debugSummary?: string
  /** Debug info: the system prompt that was built (may be compressed) */
  debugSystemPrompt?: string
  /** Original uncompressed system prompt (for async pre-compression of next message) */
  originalSystemPrompt?: string
  /** Whether context compression was applied */
  compressionApplied?: boolean
  /** Details about the compression (if applied) */
  compressionDetails?: {
    originalMessageCount: number
    compressedMessageCount: number
    windowMessageCount: number
    originalHistoryTokens: number
    compressedHistoryTokens: number
    originalSystemPromptTokens: number
    compressedSystemPromptTokens: number
    totalSavings: number
  }
}

/**
 * Options for building context
 */
export interface BuildContextOptions {
  /** Provider for token estimation */
  provider: Provider
  /** Model name for context limit lookup */
  modelName: string
  /** User ID for memory access */
  userId: string
  /** Character for system prompt (the character who will respond) */
  character: Character
  /** Persona information (optional) */
  persona?: { name: string; description: string } | null
  /** Chat metadata */
  chat: ChatMetadataBase
  /** Existing messages in the conversation */
  existingMessages: Array<{ role: string; content: string; id?: string; thoughtSignature?: string | null }>
  /** New user message being sent (optional for continue mode) */
  newUserMessage?: string
  /** Custom system prompt override */
  systemPromptOverride?: string | null
  /** Roleplay template for formatting instructions (prepended to system prompt) */
  roleplayTemplate?: { systemPrompt: string } | null
  /** Embedding profile ID for semantic search */
  embeddingProfileId?: string
  /** Skip memory retrieval */
  skipMemories?: boolean
  /** Maximum memories to retrieve */
  maxMemories?: number
  /** Minimum importance for memories */
  minMemoryImportance?: number

  // ============================================================================
  // Multi-Character Context Building (Phase 3)
  // ============================================================================

  /** The participant who will respond (required for multi-character chats) */
  respondingParticipant?: ChatParticipantBase
  /** All active participants in the chat */
  allParticipants?: ChatParticipantBase[]
  /** Map of participant ID -> Character data (for characters) */
  participantCharacters?: Map<string, Character>
  /** Extended messages with participantId for attribution */
  messagesWithParticipants?: MessageWithParticipant[]

  // ============================================================================
  // Participant Status Notifications
  // ============================================================================

  /** Status change notifications since the responding character's last turn */
  statusChangeNotifications?: string[]

  // ============================================================================
  // Tool Instructions (native tool rules or text-block tool instructions)
  // ============================================================================

  /** Tool instructions injected into system prompt (native tool rules or text-block tool instructions) */
  toolInstructions?: string

  // ============================================================================
  // Timestamp Injection
  // ============================================================================

  /** Timestamp configuration (from chat or user settings) */
  timestampConfig?: TimestampConfig | null
  /** Whether this is the first user message in the conversation */
  isInitialMessage?: boolean
  /** Resolved IANA timezone name for timestamp formatting */
  timezone?: string

  // ============================================================================
  // Project Context
  // ============================================================================

  /** Project context to inject into system prompt (if chat is in a project) */
  projectContext?: ProjectContext | null

  // ============================================================================
  // Context Compression
  // ============================================================================

  /** Context compression settings */
  contextCompressionSettings?: ContextCompressionSettings | null
  /** Cheap LLM selection for compression (required if compression is enabled) */
  cheapLLMSelection?: CheapLLMSelection | null
  /** Whether to bypass compression for this request (e.g., requestFullContextOnNextMessage flag) */
  bypassCompression?: boolean
  /** Pre-computed compression result from async cache (avoids blocking on compression) */
  cachedCompressionResult?: ContextCompressionResult | null
  /**
   * Message count when the cached compression was computed.
   * Used to calculate dynamic window size when using a fallback cache.
   * If the cache was computed for fewer messages than we currently have,
   * the effective window must be larger to include all messages since
   * the compression point.
   */
  cachedCompressionMessageCount?: number

  // ============================================================================
  // Proactive Memory Recall
  // ============================================================================

  /** Pre-searched memories from proactive recall (skips internal memory search when provided) */
  preSearchedMemories?: SemanticSearchResult[]

  // ============================================================================
  // Memory Recap (Chat Start / Character Join)
  // ============================================================================

  /** Whether to generate a memory recap for this character (first message or character join) */
  generateMemoryRecap?: boolean
  /** Uncensored fallback options for memory recap in dangerous chats */
  uncensoredFallbackOptions?: UncensoredFallbackOptions
}

/**
 * Calculate context budget based on model limits
 */
export function calculateContextBudget(
  provider: Provider,
  modelName: string
): ContextBudget {
  const allocation = getRecommendedContextAllocation(provider, modelName)

  return {
    totalLimit: allocation.totalLimit,
    systemPromptBudget: allocation.systemPrompt,
    memoryBudget: allocation.memories,
    summaryBudget: allocation.conversationSummary,
    recentMessagesBudget: allocation.recentMessages,
    responseReserve: allocation.responseReserve,
  }
}

/**
 * Main context building function
 * Assembles all components into a context that fits within token limits
 * Supports both single-character and multi-character scenarios
 */
export async function buildContext(options: BuildContextOptions): Promise<BuiltContext> {
  const {
    provider,
    modelName,
    userId,
    character,
    persona,
    chat,
    existingMessages,
    newUserMessage,
    systemPromptOverride,
    roleplayTemplate,
    embeddingProfileId,
    skipMemories = false,
    maxMemories = 10,
    minMemoryImportance = 0.3,
    // Multi-character options (Phase 3)
    respondingParticipant,
    allParticipants,
    participantCharacters,
    messagesWithParticipants,
    // Tool instructions (native tool rules or text-block tool instructions)
    toolInstructions,
    // Project context
    projectContext,
  } = options

  const warnings: string[] = []
  const budget = calculateContextBudget(provider, modelName)

  // Determine if this is a multi-character chat
  const isMultiCharacter = !!(
    respondingParticipant &&
    allParticipants &&
    allParticipants.length > 1 &&
    participantCharacters &&
    messagesWithParticipants
  )

  // 1. Build system prompt (with multi-character info if applicable)
  let otherParticipantsInfo: OtherParticipantInfo[] | undefined
  if (isMultiCharacter && respondingParticipant && allParticipants && participantCharacters) {
    otherParticipantsInfo = buildOtherParticipantsInfo(
      respondingParticipant.id,
      allParticipants,
      participantCharacters
    )
  }

  // Get the selectedSystemPromptId from the responding participant
  const selectedSystemPromptId = respondingParticipant?.selectedSystemPromptId

  const systemPrompt = buildSystemPrompt(
    character,
    persona,
    systemPromptOverride,
    otherParticipantsInfo,
    roleplayTemplate,
    toolInstructions,
    selectedSystemPromptId,
    options.timestampConfig,
    options.isInitialMessage,
    projectContext,
    options.timezone,
    options.statusChangeNotifications,
    respondingParticipant?.status as 'active' | 'silent' | 'absent' | 'removed' | undefined
  )
  const systemPromptTokens = estimateTokens(systemPrompt, provider)

  // Log multi-character context info for debugging identity confusion
  if (isMultiCharacter && respondingParticipant) {
    logger.info('[ContextManager] Multi-character context built', {
      respondingCharacterName: character.name,
      respondingParticipantId: respondingParticipant.id,
      otherParticipantNames: otherParticipantsInfo?.map(p => p.name) || [],
      systemPromptContainsIdentity: systemPrompt.includes(`You are ${character.name}`),
    })
  }

  // Check if system prompt exceeds budget
  let finalSystemPrompt = systemPrompt
  if (systemPromptTokens > budget.systemPromptBudget) {
    warnings.push(`System prompt (${systemPromptTokens} tokens) exceeds budget (${budget.systemPromptBudget}). Truncating.`)
    finalSystemPrompt = truncateToTokenLimit(systemPrompt, budget.systemPromptBudget, provider)
  }
  const finalSystemPromptTokens = estimateTokens(finalSystemPrompt, provider)

  // ============================================================================
  // Context Compression (Sliding Window)
  // ============================================================================

  // Extract compression options
  const { contextCompressionSettings, cheapLLMSelection, bypassCompression = false } = options

  // Determine if compression should be applied
  const compressionEnabled = !!(
    contextCompressionSettings &&
    cheapLLMSelection &&
    shouldApplyCompression(
      existingMessages.length,
      contextCompressionSettings,
      bypassCompression
    )
  )

  // Initialize compression result
  let compressionResult: ContextCompressionResult | undefined
  let useCompressedContext = false

  if (compressionEnabled && contextCompressionSettings && cheapLLMSelection) {
    logger.info('[ContextManager] Context compression enabled', {
      messageCount: existingMessages.length,
      windowSize: contextCompressionSettings.windowSize,
      bypassCompression,
    })

    // Check for cached compression result first (async pre-compression)
    const { cachedCompressionResult } = options
    if (cachedCompressionResult && cachedCompressionResult.compressionApplied) {
      logger.info('[ContextManager] Using cached compression result (async pre-compression)', {
        messageCount: existingMessages.length,
        cachedSavings: cachedCompressionResult.compressionDetails?.totalSavings,
      })
      compressionResult = cachedCompressionResult
      useCompressedContext = true

      if (compressionResult.warnings.length > 0) {
        warnings.push(...compressionResult.warnings.map(w => `[Compression] ${w}`))
      }
    } else {
      // No cached result - perform synchronous compression
      logger.info('[ContextManager] No cached compression, performing sync compression', {
        messageCount: existingMessages.length,
        hasCachedResult: !!cachedCompressionResult,
      })

      // Get user/persona name for compression prompt
      const userName = persona?.name || 'User'

      // Apply compression
      try {
        compressionResult = await applyContextCompression(
          extractVisibleConversation(existingMessages),
          finalSystemPrompt,
          {
            enabled: contextCompressionSettings.enabled,
            windowSize: contextCompressionSettings.windowSize,
            compressionTargetTokens: contextCompressionSettings.compressionTargetTokens,
            systemPromptTargetTokens: contextCompressionSettings.systemPromptTargetTokens,
            selection: cheapLLMSelection,
            userId,
            chatId: chat.id,
            characterName: character.name,
            userName,
          }
        )

        useCompressedContext = compressionResult.compressionApplied

        if (compressionResult.warnings.length > 0) {
          warnings.push(...compressionResult.warnings.map(w => `[Compression] ${w}`))
        }

        logger.info('[ContextManager] Compression result', {
          compressionApplied: compressionResult.compressionApplied,
          compressionDetails: compressionResult.compressionDetails,
        })
      } catch (error) {
        warnings.push(`Failed to apply context compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
        logger.error('[ContextManager] Context compression error', {}, error instanceof Error ? error : undefined)
      }
    }
  }

  // If using compressed context, replace system prompt and filter messages
  let effectiveSystemPrompt = finalSystemPrompt
  let effectiveMessages = existingMessages

  if (useCompressedContext && compressionResult) {
    // Build the compressed system message (includes compressed history)
    effectiveSystemPrompt = buildCompressedSystemMessage(
      compressionResult.compressedHistory,
      undefined,  // System prompt compression disabled — always use fresh per-character prompt
      finalSystemPrompt
    )

    // Only keep window messages (the ones that weren't compressed)
    // Extract visible messages first since we need the count for dynamic window sizing
    const visibleMessages = extractVisibleConversation(existingMessages)

    // Calculate effective window size
    // When using a fallback cache (older compression), we need to include all
    // messages since the compression point, not just the standard windowSize.
    // This ensures no messages are lost when the async compression wasn't ready.
    const standardWindowSize = contextCompressionSettings?.windowSize || 5
    const { cachedCompressionMessageCount } = options

    let effectiveWindowSize = standardWindowSize
    if (cachedCompressionMessageCount !== undefined && cachedCompressionMessageCount < visibleMessages.length) {
      // Cache was computed for fewer visible messages than we have now
      // The compressed history covers messages up to (cachedCount - standardWindowSize)
      // So we need to include all messages after that point
      // Use visibleMessages.length to match the count domain used by triggerAsyncCompression
      const messagesSinceCache = visibleMessages.length - cachedCompressionMessageCount
      effectiveWindowSize = standardWindowSize + messagesSinceCache

      logger.info('[ContextManager] Using dynamic window size for fallback cache', {
        standardWindowSize,
        cachedMessageCount: cachedCompressionMessageCount,
        currentVisibleMessageCount: visibleMessages.length,
        messagesSinceCache,
        effectiveWindowSize,
      })
    }
    const { windowMessages } = splitMessagesForCompression(
      visibleMessages,
      effectiveWindowSize
    )

    // Map back to the original format with all metadata
    // We need to find the corresponding existingMessages for the window
    // Walk backwards through existingMessages to find the last N visible messages
    const windowCount = windowMessages.length
    let found = 0
    let windowStartIndex = existingMessages.length
    for (let i = existingMessages.length - 1; i >= 0 && found < windowCount; i--) {
      const msg = existingMessages[i]
      const role = (msg.role || '').toUpperCase()
      const isVisible = (msg as { type?: string }).type === undefined || (msg as { type?: string }).type === 'message'
      if (isVisible && (role === 'USER' || role === 'ASSISTANT')) {
        found++
        windowStartIndex = i
      }
    }
    effectiveMessages = existingMessages.slice(windowStartIndex)

  }

  // Update system prompt token count for compressed version
  const effectiveSystemPromptTokens = useCompressedContext
    ? estimateTokens(effectiveSystemPrompt, provider)
    : finalSystemPromptTokens

  // 1b. Generate memory recap on chat start or character join
  let memoryRecapContent = ''
  let memoryRecapTokens = 0

  if (options.generateMemoryRecap && character.id && options.cheapLLMSelection) {
    try {
      const recapResult = await generateMemoryRecap(
        character.id,
        character.name,
        options.cheapLLMSelection,
        userId,
        chat.id,
        options.uncensoredFallbackOptions
      )

      if (recapResult.content) {
        memoryRecapContent = recapResult.content
        memoryRecapTokens = estimateTokens(memoryRecapContent, provider)

        logger.debug('[ContextManager] Memory recap generated', {
          characterName: character.name,
          memoriesUsed: recapResult.memoriesUsed,
          recapTokens: memoryRecapTokens,
          usage: recapResult.usage,
        })
      }
    } catch (error) {
      warnings.push(`Failed to generate memory recap: ${error instanceof Error ? error.message : 'Unknown error'}`)
      logger.error('[ContextManager] Memory recap generation failed', {
        characterId: character.id,
      }, error instanceof Error ? error : undefined)
    }
  }

  // 2. Retrieve and format relevant memories
  let memoryContent = ''
  let memoryTokens = 0
  let memoriesIncluded = 0
  let debugMemories: DebugMemoryInfo[] = []

  // In continue mode (no newUserMessage), use the last message content for memory search
  // or skip memory search if there are no messages
  const memorySearchQuery = newUserMessage ||
    (existingMessages.length > 0 ? existingMessages[existingMessages.length - 1].content : '')

  if (!skipMemories && character.id) {
    if (options.preSearchedMemories && options.preSearchedMemories.length > 0) {
      // Use proactively recalled memories (skips internal search)
      try {
        const formatted = formatMemoriesForContext(
          options.preSearchedMemories,
          budget.memoryBudget,
          provider
        )

        memoryContent = formatted.content
        memoryTokens = formatted.tokenCount
        memoriesIncluded = formatted.memoriesUsed
        debugMemories = formatted.debugMemories

      } catch (error) {
        warnings.push(`Failed to format pre-searched memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    } else if (memorySearchQuery) {
      // Default: search using user message (or last message in continue mode)
      try {
        const memoryResults = await searchMemoriesSemantic(
          character.id,
          memorySearchQuery,
          {
            userId,
            embeddingProfileId,
            limit: maxMemories * 2, // Get more to filter
            minImportance: minMemoryImportance,
          }
        )

        const formatted = formatMemoriesForContext(
          memoryResults.slice(0, maxMemories),
          budget.memoryBudget,
          provider
        )

        memoryContent = formatted.content
        memoryTokens = formatted.tokenCount
        memoriesIncluded = formatted.memoriesUsed
        debugMemories = formatted.debugMemories
      } catch (error) {
        warnings.push(`Failed to retrieve memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }

  // 2b. Retrieve inter-character memories in multi-character chats
  let interCharacterMemoryContent = ''
  let interCharacterMemoryTokens = 0
  let interCharacterMemoriesIncluded = 0

  if (!skipMemories && isMultiCharacter && character.id && participantCharacters && allParticipants) {
    try {
      const repos = getRepositories()

      // Get IDs of other characters in this chat (excluding the responding character)
      const otherCharacterIds: string[] = []
      const otherCharacterNames = new Map<string, string>()

      for (const participant of allParticipants) {
        if (participant.type === 'CHARACTER' && participant.characterId && participant.characterId !== character.id) {
          const otherCharacter = participantCharacters.get(participant.characterId)
          if (otherCharacter) {
            otherCharacterIds.push(otherCharacter.id)
            otherCharacterNames.set(otherCharacter.id, otherCharacter.name)
          }
        }
      }

      if (otherCharacterIds.length > 0) {
        // Fetch memories this character has about other characters
        const interCharacterMemories = await repos.memories.findByCharacterAboutCharacters(
          character.id,
          otherCharacterIds
        )

        // Use half the remaining memory budget for inter-character memories
        const interCharacterBudget = Math.floor((budget.memoryBudget - memoryTokens) / 2)

        if (interCharacterMemories.length > 0 && interCharacterBudget > 0) {
          const formatted = formatInterCharacterMemoriesForContext(
            interCharacterMemories,
            otherCharacterNames,
            interCharacterBudget,
            provider
          )

          interCharacterMemoryContent = formatted.content
          interCharacterMemoryTokens = formatted.tokenCount
          interCharacterMemoriesIncluded = formatted.memoriesUsed

        }
      }
    } catch (error) {
      warnings.push(`Failed to retrieve inter-character memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // 3. Include conversation summary if available
  let summaryContent = ''
  let summaryTokens = 0

  if (chat.contextSummary) {
    const formatted = formatSummaryForContext(
      chat.contextSummary,
      budget.summaryBudget,
      provider
    )
    summaryContent = formatted.content
    summaryTokens = formatted.tokenCount
  }

  // 4. Calculate remaining budget for messages
  // Use effective (possibly compressed) system prompt tokens
  const usedTokens = effectiveSystemPromptTokens + memoryRecapTokens + memoryTokens + interCharacterMemoryTokens + summaryTokens
  const remainingBudget = budget.totalLimit - usedTokens - budget.responseReserve

  // 5. Prepare messages based on single vs multi-character mode
  let messagesToProcess: SelectableMessage[]

  if (isMultiCharacter && respondingParticipant && allParticipants && participantCharacters && messagesWithParticipants) {
    // Multi-character mode: filter by history access, then attribute messages

    // 5a. Filter messages by history access
    const filteredMessages = filterMessagesByHistoryAccess(messagesWithParticipants, respondingParticipant)

    // 5a-bis. Filter whisper messages not visible to this participant
    const whisperFiltered = filterWhisperMessages(filteredMessages, respondingParticipant.id)

    // 5b. Prepend join scenario if participant has one and doesn't have history access
    let joinScenarioContent = ''
    if (!respondingParticipant.hasHistoryAccess && respondingParticipant.joinScenario) {
      joinScenarioContent = respondingParticipant.joinScenario

    }

    // 5c. Attribute messages for the responding character's perspective
    const attributedMessages = attributeMessagesForCharacter(
      whisperFiltered,
      respondingParticipant.id,
      participantCharacters,
      allParticipants
    )

    // Convert to SelectableMessage format
    messagesToProcess = attributedMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      name: msg.name,
      participantId: msg.participantId,
      thoughtSignature: msg.thoughtSignature,
    }))

    // Prepend join scenario to effective system prompt if present
    if (joinScenarioContent) {
      // Add join scenario to effective system prompt instead of as a separate message
      effectiveSystemPrompt += `\n\n## How You Entered This Conversation\n${joinScenarioContent}`
    }
  } else {
    // Single-character mode: use effective messages (possibly filtered by compression)
    messagesToProcess = effectiveMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      id: msg.id,
      thoughtSignature: msg.thoughtSignature,
    }))
  }

  // 6. Select recent messages to fit budget
  const { messages: selectedMessages, tokenCount: messagesTokens, truncated } = selectRecentMessages(
    messagesToProcess,
    Math.min(remainingBudget, budget.recentMessagesBudget),
    provider
  )

  if (truncated) {
    // Check if we should recommend summarization
    const totalMessageTokens = countMessagesTokens(
      messagesToProcess.map(m => ({ role: m.role, content: m.content })),
      provider
    )
    if (shouldSummarizeConversation(messagesToProcess.length, totalMessageTokens, budget.totalLimit)) {
      warnings.push('Conversation is getting long. Consider generating a summary for better context management.')
    }
  }

  // 7. Add new user message (only if provided - not in continue mode)
  const newUserMessageTokens = newUserMessage ? estimateTokens(newUserMessage, provider) + 4 : 0

  // 8. Assemble final context
  const contextMessages: ContextMessage[] = []

  // System prompt with injected memories and summary
  // Use effective system prompt (possibly compressed)
  let fullSystemContent = effectiveSystemPrompt

  // Memory recap: narrative summary of what the character remembers (chat start only)
  // Placed after character notes but before per-message memories and identity lockdown
  if (memoryRecapContent) {
    fullSystemContent += '\n\n' + memoryRecapContent
  }

  if (memoryContent) {
    fullSystemContent += '\n\n' + memoryContent
  }

  if (interCharacterMemoryContent) {
    fullSystemContent += '\n\n' + interCharacterMemoryContent
  }

  if (summaryContent) {
    fullSystemContent += '\n\n' + summaryContent
  }

  // Identity reinforcement: append as the very last content in system prompt
  // so it's the closest instruction to where the LLM begins generating
  const otherParticipantNames = otherParticipantsInfo?.map(p => p.name)
  const identityReminder = buildIdentityReinforcement(
    character.name,
    persona?.name || 'User',
    isMultiCharacter ? otherParticipantNames : undefined,
  )
  fullSystemContent += '\n\n' + identityReminder

  contextMessages.push({
    role: 'system',
    content: fullSystemContent,
    metadata: { isInjected: true },
  })

  // Add selected conversation messages
  // In multi-character mode, preserve name attribution
  for (const msg of selectedMessages) {
    contextMessages.push({
      role: msg.role.toLowerCase() as 'user' | 'assistant',
      content: msg.content,
      thoughtSignature: msg.thoughtSignature,
      name: msg.name,
    })
  }

  // Add new user message (only if provided - not in continue mode)
  // In multi-character mode, include the user's character name
  if (newUserMessage) {
    let newUserMsgName: string | undefined
    if (isMultiCharacter && allParticipants && participantCharacters) {
      newUserMsgName = findUserParticipantName(allParticipants, participantCharacters)
    }

    contextMessages.push({
      role: 'user',
      content: newUserMessage,
      name: newUserMsgName,
    })
  }

  // Calculate final token usage
  // Use effective system prompt tokens (possibly compressed)
  const totalMemoryTokens = memoryRecapTokens + memoryTokens + interCharacterMemoryTokens
  const totalUsed = effectiveSystemPromptTokens + totalMemoryTokens + summaryTokens + messagesTokens + newUserMessageTokens
  const totalMemoriesIncluded = memoriesIncluded + interCharacterMemoriesIncluded

  return {
    messages: contextMessages,
    tokenUsage: {
      systemPrompt: effectiveSystemPromptTokens,
      memories: totalMemoryTokens,
      summary: summaryTokens,
      recentMessages: messagesTokens + newUserMessageTokens,
      total: totalUsed,
    },
    budget,
    includedSummary: summaryTokens > 0,
    memoriesIncluded: totalMemoriesIncluded,
    messagesIncluded: selectedMessages.length + (newUserMessage ? 1 : 0), // +1 for new message if provided
    messagesTruncated: truncated,
    warnings,
    // Debug info for the debug panel
    debugMemories,
    debugSummary: chat.contextSummary || undefined,
    debugSystemPrompt: effectiveSystemPrompt,
    // Original uncompressed system prompt (for async pre-compression)
    originalSystemPrompt: finalSystemPrompt,
    // Compression info
    compressionApplied: useCompressedContext,
    compressionDetails: compressionResult?.compressionDetails,
  }
}

/**
 * Quick check if context building will likely exceed limits
 * Useful for UI warnings before sending
 */
export function willExceedContextLimit(
  existingMessages: Array<{ content: string }>,
  newMessage: string,
  provider: Provider,
  modelName: string,
  systemPromptEstimate: number = 2000
): { willExceed: boolean; estimatedUsage: number; limit: number; percentUsed: number } {
  const limit = getModelContextLimit(provider, modelName)
  const responseReserve = 4096

  const messagesTokens = countMessagesTokens(
    existingMessages.map(m => ({ role: 'user', content: m.content })),
    provider
  )
  const newMessageTokens = estimateTokens(newMessage, provider)

  const estimatedUsage = systemPromptEstimate + messagesTokens + newMessageTokens + responseReserve
  const percentUsed = Math.round((estimatedUsage / limit) * 100)

  return {
    willExceed: estimatedUsage > limit,
    estimatedUsage,
    limit,
    percentUsed,
  }
}

/**
 * Get context usage status for UI display
 */
export function getContextStatus(
  usedTokens: number,
  totalLimit: number
): {
  level: 'ok' | 'warning' | 'critical'
  percentUsed: number
  remainingTokens: number
  message: string
} {
  const percentUsed = Math.round((usedTokens / totalLimit) * 100)
  const remainingTokens = totalLimit - usedTokens

  if (percentUsed >= 95) {
    return {
      level: 'critical',
      percentUsed,
      remainingTokens,
      message: 'Context nearly full. Consider starting a new conversation or generating a summary.',
    }
  }

  if (percentUsed >= 80) {
    return {
      level: 'warning',
      percentUsed,
      remainingTokens,
      message: 'Context filling up. Older messages may be dropped soon.',
    }
  }

  return {
    level: 'ok',
    percentUsed,
    remainingTokens,
    message: `Using ${percentUsed}% of context window.`,
  }
}
