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
import { getModelContextLimit, getRecommendedContextAllocation, shouldSummarizeConversation, calculateMaxAvailable, CONTEXT_HISTORY_BUDGET_RATIO, MEMORY_BUDGET_RATIO } from '@/lib/llm/model-context-data'
import { searchMemoriesSemantic, type SemanticSearchResult } from '@/lib/memory/memory-service'
import { generateMemoryRecap, type MemoryRecapResult } from '@/lib/memory/memory-recap'
import type { UncensoredFallbackOptions } from '@/lib/memory/cheap-llm-tasks'
import { compressMemories } from '@/lib/memory/cheap-llm-tasks'
import type { ConnectionProfile } from '@/lib/schemas/types'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/errors'
import { extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks'

// Import from extracted modules
import {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  type OtherParticipantInfo,
  type ProjectContext,
  type WardrobeContext,
} from './context/system-prompt-builder'
import {
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatSummaryForContext,
  type DebugMemoryInfo,
  type DebugInterCharacterMemoryInfo,
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
  findMentionedCharacterIds,
  formatMentionedCharactersSection,
} from './context/mentioned-characters'
import {
  shouldApplyCompression,
  shouldApplyBudgetCompression,
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
  /** Debug info: the inter-character memories that were included (multi-character chats) */
  debugInterCharacterMemories?: Array<{ aboutCharacterName: string; summary: string; importance: number }>
  /** Debug info: the memory recap content injected on chat start / character join */
  debugMemoryRecap?: string
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
  /** User character information (optional) */
  userCharacter?: { name: string; description: string } | null
  /** Chat metadata */
  chat: ChatMetadataBase
  /** Existing messages in the conversation */
  existingMessages: Array<{ role: string; content: string; id?: string; thoughtSignature?: string | null }>
  /** New user message being sent (optional for continue mode) */
  newUserMessage?: string
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
  /** Outfit change notifications from manual sidebar changes */
  outfitChangeNotifications?: string[]

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
  // Connection Profile (for budget-driven compression)
  // ============================================================================

  /** The connection profile being used (provides maxContext/maxTokens for budget calculation) */
  connectionProfile?: ConnectionProfile

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

  // ============================================================================
  // Status Callback (for streaming status events to client)
  // ============================================================================

  /** Optional callback to emit status events during context building phases */
  onStatusChange?: (stage: string, message: string) => void
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
    userCharacter,
    chat,
    existingMessages,
    newUserMessage,
    roleplayTemplate,
    embeddingProfileId,
    skipMemories = false,
    maxMemories = 18,
    minMemoryImportance = 0.5,
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

  // Load wardrobe context for equipped outfit rendering (if available)
  let wardrobeContext: WardrobeContext | undefined
  try {
    const repos = getRepositories()
    const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chat.id, character.id)
    if (equippedSlots) {
      const equippedItemIds = Object.values(equippedSlots).filter(Boolean) as string[]
      if (equippedItemIds.length > 0) {
        const equippedItemsData = await repos.wardrobe.findByIds(equippedItemIds)
        const equippedItemsMap = new Map(equippedItemsData.map(item => [item.id, item]))

        const equippedItems: Record<string, { title: string; description?: string | null }> = {}
        for (const [slot, itemId] of Object.entries(equippedSlots)) {
          if (itemId) {
            const item = equippedItemsMap.get(itemId)
            if (item) {
              equippedItems[slot] = { title: item.title, description: item.description }
            }
          }
        }

        const wardrobeItems = await repos.wardrobe.findByCharacterId(character.id)
        wardrobeContext = {
          equippedItems,
          wardrobeItems: wardrobeItems.map(item => ({
            id: item.id,
            title: item.title,
            types: item.types,
            appropriateness: item.appropriateness,
          })),
        }

        logger.debug('[ContextManager] Loaded wardrobe context for system prompt', {
          characterId: character.id,
          chatId: chat.id,
          equippedSlotCount: Object.keys(equippedItems).length,
          totalWardrobeItems: wardrobeItems.length,
        })
      }
    }
  } catch (error) {
    logger.warn('[ContextManager] Failed to load wardrobe context', {
      characterId: character.id,
      chatId: chat.id,
      error: getErrorMessage(error),
    })
  }

  // Build "Characters Mentioned" section: scan the conversation for references
  // to characters that exist on the system but are not currently in the chat.
  // Failures here must never break prompt assembly — log and skip on error.
  let mentionedCharactersSection: string | undefined
  try {
    const repos = getRepositories()
    const allUserCharacters = await repos.characters.findByUserId(userId)

    // Build the set of character IDs to exclude from the candidate pool.
    const excludedCharacterIds = new Set<string>()
    excludedCharacterIds.add(character.id)
    if (allParticipants) {
      for (const participant of allParticipants) {
        if (
          participant.type === 'CHARACTER' &&
          participant.characterId &&
          participant.status !== 'removed'
        ) {
          excludedCharacterIds.add(participant.characterId)
        }
      }
    }

    // Also exclude the user's persona by name (no ID is exposed via options).
    const userCharacterNameLower = userCharacter?.name?.trim().toLowerCase()

    const candidates = allUserCharacters.filter(c => {
      if (excludedCharacterIds.has(c.id)) return false
      if (userCharacterNameLower && c.name.trim().toLowerCase() === userCharacterNameLower) {
        return false
      }
      return true
    })

    if (candidates.length > 0) {
      // Build the scan corpus: conversation summary plus every visible
      // USER/ASSISTANT message in the chat history. Scanning the full
      // history (rather than the post-compression window) lets us surface
      // characters mentioned earlier in long conversations.
      const visibleForScan = extractVisibleConversation(existingMessages)
      const corpusParts: string[] = []
      if (chat.contextSummary) corpusParts.push(chat.contextSummary)
      for (const msg of visibleForScan) {
        if (msg.content) corpusParts.push(msg.content)
      }
      const scanCorpus = corpusParts.join('\n')

      const matchedIds = findMentionedCharacterIds(scanCorpus, candidates)
      if (matchedIds.size > 0) {
        const matched = candidates.filter(c => matchedIds.has(c.id))
        const formatted = formatMentionedCharactersSection(matched)
        if (formatted.section.length > 0) {
          mentionedCharactersSection = formatted.section
          logger.debug('[ContextManager] Mentioned characters section built', {
            chatId: chat.id,
            candidateCount: candidates.length,
            matchedCount: matched.length,
            includedCount: formatted.includedCount,
            matchedNames: matched.map(c => c.name),
            sectionTokens: estimateTokens(formatted.section, provider),
          })
        }
      } else {
        logger.debug('[ContextManager] No mentioned characters found', {
          chatId: chat.id,
          candidateCount: candidates.length,
        })
      }
    }
  } catch (error) {
    logger.warn('[ContextManager] Failed to build mentioned-characters section', {
      chatId: chat.id,
      error: getErrorMessage(error),
    })
  }

  const tSystemPromptStart = performance.now()
  const systemPrompt = buildSystemPrompt(
    character,
    userCharacter,
    otherParticipantsInfo,
    roleplayTemplate,
    toolInstructions,
    selectedSystemPromptId,
    options.timestampConfig,
    options.isInitialMessage,
    projectContext,
    options.timezone,
    options.statusChangeNotifications,
    respondingParticipant?.status as 'active' | 'silent' | 'absent' | 'removed' | undefined,
    options.chat.scenarioText ?? undefined,
    wardrobeContext,
    options.outfitChangeNotifications
    // mentionedCharactersSection is appended AFTER truncation below so it
    // always survives; the in-prompt position would otherwise be lopped off
    // whenever the core system prompt exceeds its token budget.
  )
  const systemPromptTokens = estimateTokens(systemPrompt, provider)
  logger.debug('[ContextManager] buildSystemPrompt complete', {
    chatId: chat.id,
    durationMs: Math.round(performance.now() - tSystemPromptStart),
    systemPromptChars: systemPrompt.length,
    systemPromptTokens,
  })

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

  // Append "Characters Mentioned" after any truncation so it always survives,
  // even when the core system prompt is over budget. The section's own length
  // is bounded by formatMentionedCharactersSection's internal hard cap.
  if (mentionedCharactersSection) {
    finalSystemPrompt = `${finalSystemPrompt}\n\n${mentionedCharactersSection}`
  }

  const finalSystemPromptTokens = estimateTokens(finalSystemPrompt, provider)

  // ============================================================================
  // Context Compression (Budget-Driven)
  // ============================================================================

  // Extract compression options
  const { contextCompressionSettings, cheapLLMSelection, bypassCompression = false, connectionProfile } = options

  // Calculate budget-driven max_available
  const budgetInfo = connectionProfile
    ? calculateMaxAvailable(provider, modelName, connectionProfile)
    : null

  // Estimate total conversation tokens for budget check
  const tTokenCountStart = performance.now()
  const visibleConversation = extractVisibleConversation(existingMessages)
  const conversationTokens = countMessagesTokens(
    visibleConversation.map(m => ({ role: m.role, content: m.content })),
    provider
  )
  logger.debug('[ContextManager] Conversation token count complete', {
    chatId: chat.id,
    durationMs: Math.round(performance.now() - tTokenCountStart),
    visibleMessageCount: visibleConversation.length,
    conversationTokens,
  })

  // Total estimated prompt = system prompt + conversation + a rough memory estimate
  // (Memories haven't been retrieved yet, but we use the budget allocation as an estimate)
  const totalEstimatedTokens = finalSystemPromptTokens + conversationTokens + budget.memoryBudget

  // Determine if budget-driven compression should be applied
  const compressionEnabled = !!(
    contextCompressionSettings &&
    cheapLLMSelection &&
    budgetInfo &&
    shouldApplyBudgetCompression(
      totalEstimatedTokens,
      budgetInfo.maxAvailable,
      contextCompressionSettings,
      bypassCompression
    )
  )

  // Emit status: budget check
  if (budgetInfo && options.onStatusChange) {
    options.onStatusChange('budget_check', 'Calculating context budget...')
  }

  // Log budget analysis
  if (budgetInfo) {
    logger.info('[ContextManager] Budget analysis', {
      maxContext: budgetInfo.maxContext,
      maxTokens: budgetInfo.maxTokens,
      maxAvailable: budgetInfo.maxAvailable,
      totalEstimatedTokens,
      compressionNeeded: compressionEnabled,
      systemPromptTokens: finalSystemPromptTokens,
      conversationTokens,
    })
  }

  // Initialize compression result
  let compressionResult: ContextCompressionResult | undefined
  let useCompressedContext = false

  if (compressionEnabled && contextCompressionSettings && cheapLLMSelection && budgetInfo) {
    const maxAvailable = budgetInfo.maxAvailable
    const contextHistoryBudget = Math.floor(maxAvailable * CONTEXT_HISTORY_BUDGET_RATIO)

    logger.info('[ContextManager] Budget-driven compression enabled', {
      messageCount: existingMessages.length,
      windowSize: contextCompressionSettings.windowSize,
      maxAvailable,
      contextHistoryBudget,
      conversationTokens,
    })

    // Phase 1: Compress conversation history if it exceeds 50% of max_available
    // (minus the last windowSize messages which are kept verbatim)
    const { messagesToCompress } = splitMessagesForCompression(
      visibleConversation,
      contextCompressionSettings.windowSize
    )
    const compressibleTokens = countMessagesTokens(
      messagesToCompress.map(m => ({ role: m.role, content: m.content })),
      provider
    )

    if (compressibleTokens > contextHistoryBudget) {
      // Emit status: Phase 1 compression
      if (options.onStatusChange) {
        options.onStatusChange('compressing_context', 'Compressing conversation history...')
      }

      logger.info('[ContextManager] Phase 1: Compressing conversation history', {
        compressibleTokens,
        contextHistoryBudget,
        compressibleMessageCount: messagesToCompress.length,
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

        const userName = userCharacter?.name || 'User'

        try {
          compressionResult = await applyContextCompression(
            visibleConversation,
            finalSystemPrompt,
            {
              enabled: contextCompressionSettings.enabled,
              windowSize: contextCompressionSettings.windowSize,
              compressionTargetTokens: contextHistoryBudget,
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

          logger.info('[ContextManager] Phase 1 compression result', {
            compressionApplied: compressionResult.compressionApplied,
            compressionDetails: compressionResult.compressionDetails,
          })
        } catch (error) {
          warnings.push(`Failed to apply context compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
          logger.error('[ContextManager] Context compression error', {}, error instanceof Error ? error : undefined)
        }
      }
    } else {
      logger.info('[ContextManager] Phase 1 skipped: conversation history within budget', {
        compressibleTokens,
        contextHistoryBudget,
      })
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
    // Emit status: memory recap generation (can be slow — involves an LLM call)
    if (options.onStatusChange) {
      options.onStatusChange('generating_recap', `Recalling ${character.name}'s memories...`)
    }

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
      }
    } catch (error) {
      warnings.push(`Failed to generate memory recap: ${error instanceof Error ? error.message : 'Unknown error'}`)
      logger.error('[ContextManager] Memory recap generation failed', {
        characterId: character.id,
      }, error instanceof Error ? error : undefined)
    }
  }

  // Emit status: assembling context (after recap, before memory retrieval)
  if (options.onStatusChange) {
    options.onStatusChange('assembling_context', 'Assembling context...')
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

  const tMemoryStart = performance.now()
  let memoryPath: 'skipped' | 'pre-searched' | 'semantic-search' = 'skipped'
  if (!skipMemories && character.id) {
    if (options.preSearchedMemories && options.preSearchedMemories.length > 0) {
      // Use proactively recalled memories (skips internal search)
      memoryPath = 'pre-searched'
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
      memoryPath = 'semantic-search'
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
  logger.debug('[ContextManager] Memory retrieval + format complete', {
    chatId: chat.id,
    characterId: character.id,
    durationMs: Math.round(performance.now() - tMemoryStart),
    path: memoryPath,
    memoriesIncluded,
  })

  // 2b. Retrieve inter-character memories in multi-character chats
  let interCharacterMemoryContent = ''
  let interCharacterMemoryTokens = 0
  let interCharacterMemoriesIncluded = 0
  let debugInterCharacterMemories: DebugInterCharacterMemoryInfo[] = []

  const tInterStart = performance.now()
  let interCharacterLoadedCount = 0
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
        interCharacterLoadedCount = interCharacterMemories.length

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
          debugInterCharacterMemories = formatted.debugMemories

        }
      }
    } catch (error) {
      warnings.push(`Failed to retrieve inter-character memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
  if (isMultiCharacter) {
    logger.debug('[ContextManager] Inter-character memory retrieval complete', {
      chatId: chat.id,
      characterId: character.id,
      durationMs: Math.round(performance.now() - tInterStart),
      loadedCount: interCharacterLoadedCount,
      includedCount: interCharacterMemoriesIncluded,
    })
  }

  // ============================================================================
  // Phase 2: Memory Compression (Budget-Driven)
  // ============================================================================

  // If budget-driven compression is active and memories exceed 20% of max_available, compress them
  const totalMemoryTokensBeforeCompression = memoryTokens + interCharacterMemoryTokens
  if (
    compressionEnabled &&
    budgetInfo &&
    cheapLLMSelection &&
    totalMemoryTokensBeforeCompression > 0
  ) {
    const memoryBudget = Math.floor(budgetInfo.maxAvailable * MEMORY_BUDGET_RATIO)

    if (totalMemoryTokensBeforeCompression > memoryBudget) {
      // Emit status: Phase 2 memory compression
      if (options.onStatusChange) {
        options.onStatusChange('compressing_memories', 'Compressing memories...')
      }

      logger.info('[ContextManager] Phase 2: Compressing memories', {
        totalMemoryTokens: totalMemoryTokensBeforeCompression,
        memoryBudget,
        semanticMemoryTokens: memoryTokens,
        interCharacterMemoryTokens,
      })

      // Build uncensored fallback options
      const uncensoredFallback: UncensoredFallbackOptions | undefined =
        options.uncensoredFallbackOptions

      // Compress semantic memories if they exceed their share of the budget
      const semanticMemoryBudget = interCharacterMemoryTokens > 0
        ? Math.floor(memoryBudget * 0.7) // 70% for semantic, 30% for inter-character
        : memoryBudget

      if (memoryContent && memoryTokens > semanticMemoryBudget) {
        try {
          const memCompResult = await compressMemories(
            memoryContent,
            character.name,
            semanticMemoryBudget,
            cheapLLMSelection,
            userId,
            uncensoredFallback,
            chat.id
          )

          if (memCompResult.success && memCompResult.result) {
            logger.info('[ContextManager] Semantic memories compressed', {
              originalTokens: memCompResult.result.originalTokens,
              compressedTokens: memCompResult.result.compressedTokens,
            })
            memoryContent = memCompResult.result.compressedText
            memoryTokens = estimateTokens(memoryContent, provider)
          } else {
            warnings.push(`Failed to compress memories: ${memCompResult.error}`)
          }
        } catch (error) {
          warnings.push(`Error during memory compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
          logger.error('[ContextManager] Memory compression error', {}, error instanceof Error ? error : undefined)
        }
      }

      // Compress inter-character memories if they exceed their share
      const interCharBudget = memoryBudget - Math.min(memoryTokens, semanticMemoryBudget)
      if (interCharacterMemoryContent && interCharacterMemoryTokens > interCharBudget && interCharBudget > 0) {
        try {
          const interCompResult = await compressMemories(
            interCharacterMemoryContent,
            character.name,
            interCharBudget,
            cheapLLMSelection,
            userId,
            uncensoredFallback,
            chat.id
          )

          if (interCompResult.success && interCompResult.result) {
            logger.info('[ContextManager] Inter-character memories compressed', {
              originalTokens: interCompResult.result.originalTokens,
              compressedTokens: interCompResult.result.compressedTokens,
            })
            interCharacterMemoryContent = interCompResult.result.compressedText
            interCharacterMemoryTokens = estimateTokens(interCharacterMemoryContent, provider)
          } else {
            warnings.push(`Failed to compress inter-character memories: ${interCompResult.error}`)
          }
        } catch (error) {
          warnings.push(`Error during inter-character memory compression: ${error instanceof Error ? error.message : 'Unknown error'}`)
          logger.error('[ContextManager] Inter-character memory compression error', {}, error instanceof Error ? error : undefined)
        }
      }
    } else {
      logger.info('[ContextManager] Phase 2 skipped: memories within budget', {
        totalMemoryTokens: totalMemoryTokensBeforeCompression,
        memoryBudget,
      })
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
    userCharacter?.name || 'User',
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
    debugInterCharacterMemories: debugInterCharacterMemories.length > 0 ? debugInterCharacterMemories : undefined,
    debugMemoryRecap: memoryRecapContent || undefined,
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
