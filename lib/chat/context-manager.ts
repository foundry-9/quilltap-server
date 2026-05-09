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
import { getErrorMessage } from '@/lib/error-utils'
import { extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks'

// Import from extracted modules
import {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  type OtherParticipantInfo,
} from './context/system-prompt-builder'
import {
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatSummaryForContext,
  formatFrozenMemoryArchive,
  formatDynamicMemoryHead,
  formatCurrentSceneState,
  DYNAMIC_HEAD_TOKEN_BUDGET,
  DYNAMIC_HEAD_DEFAULT_SIZE,
  type DebugMemoryInfo,
  type DebugInterCharacterMemoryInfo,
} from './context/memory-injector'
import { SceneStateSchema, type SceneState } from '@/lib/schemas/chat.types'
import { describeOutfit } from '@/lib/wardrobe/outfit-description'
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped'
import type { MessageEvent } from '@/lib/schemas/types'
import { getOrComputeFrozenArchive } from '@/lib/memory/frozen-archive-cache'
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
} from './context/mentioned-characters'
import {
  retrieveKnowledgeForTurn,
  type KnowledgeDebugEntry,
} from './context/knowledge-injector'
import {
  shouldApplyCompression,
  shouldApplyBudgetCompression,
  splitMessagesForCompression,
  applyContextCompression,
  buildCompressedHistoryBlock,
  type ContextCompressionOptions,
  type ContextCompressionResult,
} from './context/compression'
import {
  buildCommonplacePersonaWhisper,
  buildCommonplaceLLMContext,
  postCommonplaceWhisper,
} from '@/lib/services/commonplace-notifications/writer'
import {
  postHostTimestampAnnouncement,
  buildTimestampContent,
  postHostOffSceneCharactersAnnouncement,
  findIntroducedOffSceneCharacterIds,
} from '@/lib/services/host-notifications/writer'
import { SUMMARY_CONTENT_PREFIX } from '@/lib/services/librarian-notifications/writer'
import {
  shouldInjectTimestamp,
  calculateCurrentTimestamp,
} from '@/lib/chat/timestamp-utils'
import { getCompiledIdentityStack } from '@/lib/services/system-prompt-compiler/compiler'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ContextCompressionSettings } from '@/lib/schemas/settings.types'

// Re-export types from extracted modules for backwards compatibility
export type { OtherParticipantInfo } from './context/system-prompt-builder'
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

// Per-character cap on inter-character memories. Top 10 by SQL ordering
// (importance DESC, lastReinforcedAt/createdAt DESC); the formatter then
// re-ranks the slice by effective weight inside each character's block.
const INTER_CHAR_PER_CHARACTER_LIMIT = 10

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
  /**
   * Provider cache breakpoint marker. Set on the head Librarian summary
   * whisper so providers that support per-message caching (Anthropic) can
   * anchor a cache breakpoint there: system+tools stay hot across summary
   * folds; only the summary-and-after re-prefills.
   */
  cacheControl?: { type: 'ephemeral' }
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
  /**
   * Tokens allocated for per-turn knowledge recall (responding character's
   * vault Knowledge/ folder). Independent of memoryBudget — knowledge is
   * first-class character canon and is not fed to the memory compressor.
   */
  knowledgeBudget: number
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
    /** Tokens spent on per-turn knowledge recall (responding character's vault Knowledge/ folder). */
    knowledge: number
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
  /** Debug info: the knowledge entries that were included for this turn */
  debugKnowledge?: Array<{ filePath: string; score: number; inline: boolean; tokenCount: number }>
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
    knowledgeBudget: allocation.knowledge,
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
    minMemoryImportance = 0.5,
    // Multi-character options (Phase 3)
    respondingParticipant,
    allParticipants,
    participantCharacters,
    messagesWithParticipants,
    // Tool instructions (native tool rules or text-block tool instructions)
    toolInstructions,
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

  // Phase D: wardrobe context (current outfit + available items) is now
  // delivered as Aurora whispers in the transcript, so the per-turn
  // system-prompt loading of equipped outfits has been removed.

  // Off-scene character introductions: scan the conversation for workspace
  // characters who are NOT current participants but get name-dropped in
  // history. The first time each one is named, the Host introduces them with
  // a public chat message — visible to the user, surfaced to every
  // character's LLM context via normal history. Subsequent turns recall the
  // particulars from history without re-injecting cards into the system
  // prompt every turn (which used to bisect provider prompt caching).
  //
  // Idempotent per character: prior Host announcements stamp the introduced
  // IDs onto `hostEvent.introducedCharacterIds`, so repeated mentions of
  // already-introduced characters are no-ops.
  //
  // Failures here must never break prompt assembly — log and skip on error.
  let pendingOffSceneAnnouncement: { content: string } | null = null
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
        // Diff against characters already introduced by prior Host
        // announcements in this chat — only newly-mentioned ones get a fresh
        // intro. `existingMessages` is the trimmed role/content view used for
        // LLM context and has already been stripped of systemSender/hostEvent,
        // so re-load the full chat history from the repo to read those fields.
        const fullChatMessages = await repos.chats.getMessages(chat.id)
        const introducedIds = findIntroducedOffSceneCharacterIds(fullChatMessages)
        const newcomerIds = new Set<string>()
        for (const id of matchedIds) {
          if (!introducedIds.has(id)) newcomerIds.add(id)
        }

        if (newcomerIds.size > 0) {
          const newcomers = candidates.filter(c => newcomerIds.has(c.id))
          const announcement = await postHostOffSceneCharactersAnnouncement({
            chatId: chat.id,
            characters: newcomers.map(c => ({
              id: c.id,
              name: c.name,
              aliases: c.aliases ?? undefined,
              pronouns: c.pronouns ?? undefined,
              description: c.description ?? undefined,
            })),
          })
          if (announcement) {
            // Surface the announcement to THIS turn's LLM context so the
            // responding character sees the intro without a one-turn lag.
            // (It's already persisted to the chat for future turns.)
            pendingOffSceneAnnouncement = { content: announcement.content }
          }
        } else {
        }
      } else {
      }
    }
  } catch (error) {
    logger.warn('[ContextManager] Failed to compute off-scene character introductions', {
      chatId: chat.id,
      error: getErrorMessage(error),
    })
  }

  const tSystemPromptStart = performance.now()
  // Phase H: prefer the precompiled identity stack from
  // chats.compiledIdentityStacks when present. Falls back to a fresh build
  // inside `buildSystemPrompt` when missing or empty (legacy chats / cache
  // miss after a character edit).
  const precompiledIdentityStack = respondingParticipant
    ? getCompiledIdentityStack(chat, respondingParticipant.id)
    : null
  const systemPrompt = buildSystemPrompt({
    character,
    userCharacter,
    roleplayTemplate,
    toolInstructions,
    selectedSystemPromptId,
    timestampConfig: options.timestampConfig,
    isInitialMessage: options.isInitialMessage,
    timezone: options.timezone,
    scenarioText: options.chat.scenarioText ?? undefined,
    precompiledIdentityStack,
  })
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

  // Off-scene character cards are no longer spliced into the system prompt
  // (they used to live here and broke prompt-cache prefixes whenever a new
  // workspace character got name-dropped). They now ride as Host
  // introductions in chat history; the per-turn announcement (when there's a
  // newcomer) is appended to `pendingOffSceneAnnouncement` above and pushed
  // into this turn's contextMessages alongside the timestamp whisper.

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

  // If using compressed context, emit the rolling summary as its own system
  // block (block 3) and filter messages down to the recent window. The persona
  // prompt itself stays byte-identical across turns so block 1 keeps caching;
  // the summary churns in its own block where churn is expected.
  let compressedHistoryBlock: string | null = null
  let effectiveMessages = existingMessages

  if (useCompressedContext && compressionResult) {
    compressedHistoryBlock = buildCompressedHistoryBlock(compressionResult.compressedHistory)

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

  // System-prompt token count = persona prompt (always) + compressed-history
  // block (only when compression fired). The two are emitted as separate
  // system messages so their cache lifetimes are decoupled.
  const compressedHistoryBlockTokens = compressedHistoryBlock
    ? estimateTokens(compressedHistoryBlock, provider)
    : 0
  const effectiveSystemPromptTokens = finalSystemPromptTokens + compressedHistoryBlockTokens

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
        options.uncensoredFallbackOptions,
        budgetInfo?.maxContext
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
  let memoryPath: 'skipped' | 'pre-searched' | 'two-pool' = 'skipped'
  let frozenArchiveCount = 0
  let dynamicHeadCount = 0
  if (!skipMemories && character.id) {
    try {
      // Phase 3a/3b: two-pool architecture.
      //
      // The frozen archive (top-N by effective weight at the current
      // compaction generation) is sorted by memory.id so its bytes are
      // identical across turns within a generation — the prefix-cache prize.
      // The dynamic head is the per-turn relevance ranking, capped at a
      // small token budget; entries already in the archive are filtered out
      // so the LLM doesn't see the same memory twice.
      const compactionGen = chat.compactionGeneration ?? 0
      const dynamicHeadBudget = Math.min(DYNAMIC_HEAD_TOKEN_BUDGET, budget.memoryBudget)
      const archiveBudget = Math.max(0, budget.memoryBudget - dynamicHeadBudget)

      const frozenArchive = await getOrComputeFrozenArchive(character.id, compactionGen)
      const archiveFormatted = formatFrozenMemoryArchive(frozenArchive, archiveBudget, provider)
      frozenArchiveCount = archiveFormatted.memoriesUsed

      const archiveIds = new Set(frozenArchive.map(m => m.id))
      let dynamicHeadResults: SemanticSearchResult[] = []

      if (options.preSearchedMemories && options.preSearchedMemories.length > 0) {
        memoryPath = 'pre-searched'
        dynamicHeadResults = options.preSearchedMemories.filter(
          r => !archiveIds.has(r.memory.id),
        )
      } else if (memorySearchQuery) {
        memoryPath = 'two-pool'
        const memoryResults = await searchMemoriesSemantic(
          character.id,
          memorySearchQuery,
          {
            userId,
            embeddingProfileId,
            // Pull a few more than the head size so the archive-overlap filter
            // still leaves enough candidates to fill the head.
            limit: DYNAMIC_HEAD_DEFAULT_SIZE * 3,
            minImportance: minMemoryImportance,
          },
        )
        dynamicHeadResults = memoryResults.filter(r => !archiveIds.has(r.memory.id))
      }

      const headFormatted = formatDynamicMemoryHead(dynamicHeadResults, provider, {
        maxTokens: dynamicHeadBudget,
        maxEntries: DYNAMIC_HEAD_DEFAULT_SIZE,
      })
      dynamicHeadCount = headFormatted.memoriesUsed

      const sections: string[] = []
      if (archiveFormatted.content) sections.push(archiveFormatted.content)
      if (headFormatted.content) sections.push(headFormatted.content)
      memoryContent = sections.join('\n\n')
      memoryTokens = archiveFormatted.tokenCount + headFormatted.tokenCount
      memoriesIncluded = archiveFormatted.memoriesUsed + headFormatted.memoriesUsed
      debugMemories = [...archiveFormatted.debugMemories, ...headFormatted.debugMemories]
    } catch (error) {
      warnings.push(`Failed to retrieve memories: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // 2a-bis. Render the latest scene-state snapshot as the `## Current State`
  // section that prefaces the Commonplace Book whisper. Time is included only
  // when the chat would also announce it via the Host (matches the gate at
  // postHostTimestampAnnouncement below).
  let currentStateContent = ''
  let currentStateTokens = 0
  try {
    const rawScene = (chat as { sceneState?: unknown }).sceneState
    let parsedScene: SceneState | null = null
    if (rawScene) {
      const candidate = typeof rawScene === 'string'
        ? (() => { try { return JSON.parse(rawScene) } catch { return null } })()
        : rawScene
      if (candidate) {
        const result = SceneStateSchema.safeParse(candidate)
        if (result.success) parsedScene = result.data
      }
    }
    let sceneTime: string | null = null
    if (
      options.timestampConfig?.autoPrepend &&
      shouldInjectTimestamp(options.timestampConfig, options.isInitialMessage ?? false)
    ) {
      sceneTime = calculateCurrentTimestamp(options.timestampConfig, options.timezone).formatted
    }

    // Scene-state tracking only re-runs at turn boundaries, so its cached
    // clothing field can lag mid-turn wardrobe edits and `wardrobe_*` tool
    // calls. The wardrobe slots are the source of truth — read them live so
    // the responding character's prompt always reflects what each present
    // character is actually wearing right now.
    const liveClothingByCharacterId = new Map<string, string>()
    if (parsedScene && parsedScene.characters.length > 0) {
      const repos = getRepositories()
      await Promise.all(parsedScene.characters.map(async (c) => {
        if (!c.characterId) return
        try {
          const equippedSlots = await repos.chats.getEquippedOutfitForCharacter(chat.id, c.characterId)
          if (!equippedSlots) return
          const resolved = await resolveEquippedOutfitForCharacter(repos, c.characterId, equippedSlots)
          const decorate = (items: { title: string; description?: string | null }[]): string[] =>
            items.map(i => i.description ? `${i.title} (${i.description})` : i.title)
          const description = describeOutfit({
            top: decorate(resolved.leafItemsBySlot.top),
            bottom: decorate(resolved.leafItemsBySlot.bottom),
            footwear: decorate(resolved.leafItemsBySlot.footwear),
            accessories: decorate(resolved.leafItemsBySlot.accessories),
          })
          if (description) liveClothingByCharacterId.set(c.characterId, description)
        } catch (error) {
          logger.warn('Failed to read live wardrobe for scene-state clothing override', {
            chatId: chat.id,
            characterId: c.characterId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }))
    }

    const formatted = formatCurrentSceneState(parsedScene, sceneTime, provider, liveClothingByCharacterId)
    currentStateContent = formatted.content
    currentStateTokens = formatted.tokenCount
  } catch (error) {
    warnings.push(`Failed to format current scene state: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

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

      // Half the remaining memory budget is reserved for inter-character
      // whispers. Current State (rendered above the memory sections) is
      // accounted for here so it doesn't crowd out inter-character lines.
      const interCharacterBudget = Math.floor(
        (budget.memoryBudget - memoryTokens - currentStateTokens) / 2,
      )

      if (otherCharacterIds.length > 0 && interCharacterBudget > 0) {
        const interCharacterMemories = await repos.memories.findByCharacterAboutCharacters(
          character.id,
          otherCharacterIds,
          INTER_CHAR_PER_CHARACTER_LIMIT,
        )
        interCharacterLoadedCount = interCharacterMemories.length

        if (interCharacterMemories.length > 0) {
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
  }

  // 2c. Retrieve relevant knowledge from the responding character's vault
  // (Knowledge/ folder). Independent of memory retrieval and intentionally
  // NOT fed to the Phase-2 memory compressor below — knowledge files are
  // first-class character canon and shouldn't be lossy-summarised. Skips
  // silently when the character has no vault or no Knowledge/ files.
  let knowledgeContent = ''
  let knowledgeTokens = 0
  let debugKnowledge: KnowledgeDebugEntry[] = []

  if (
    !skipMemories &&
    character.id &&
    character.characterDocumentMountPointId &&
    memorySearchQuery &&
    budget.knowledgeBudget > 0
  ) {
    try {
      const result = await retrieveKnowledgeForTurn({
        characterId: character.id,
        userId,
        embeddingProfileId,
        query: memorySearchQuery,
        vaultMountPointId: character.characterDocumentMountPointId,
        budgetTokens: budget.knowledgeBudget,
        provider,
      })
      knowledgeContent = result.content
      knowledgeTokens = result.tokenCount
      debugKnowledge = result.debug
    } catch (error) {
      warnings.push(
        `Failed to retrieve knowledge: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
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

  // 3. Conversation summary now rides as a Librarian whisper in the
  // transcript (Phase F), so it no longer occupies its own system-prompt
  // section. The chat-level `contextSummary` field is still maintained for
  // other consumers (title generation, danger classification, etc.).
  const summaryTokens = 0

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

    // 5b. Attribute messages for the responding character's perspective
    // (Phase C: join-scenario context for participants without history access
    // is now delivered as a Host whisper at the moment they join, not as a
    // per-turn system-prompt insertion.)
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
      id: msg.id,
      name: msg.name,
      participantId: msg.participantId,
      thoughtSignature: msg.thoughtSignature,
    }))
  } else {
    // Single-character mode: use effective messages (possibly filtered by compression)
    messagesToProcess = effectiveMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      id: msg.id,
      thoughtSignature: msg.thoughtSignature,
    }))
  }

  // Drop messages already absorbed into the running summary. The Librarian
  // summary whisper survives: it is posted after the fold and its id is not
  // in the anchor set, so the surviving tail begins with the most recent
  // summary whisper followed by post-fold turns. Empty anchor set (fresh
  // chat or post-invalidation) leaves messagesToProcess unchanged.
  const summaryAnchorIds = chat.summaryAnchorMessageIds ?? []
  if (summaryAnchorIds.length > 0) {
    const anchorSet = new Set(summaryAnchorIds)
    const before = messagesToProcess.length
    messagesToProcess = messagesToProcess.filter(m => !m.id || !anchorSet.has(m.id))
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

  // System block 1 — stable identity stack: character + roleplay template +
  // tool prose. Memories ride as Commonplace Book whispers and conversation
  // summary as a Librarian whisper, so they are NOT here. Across turns of the
  // same character this content is byte-identical (modulo edits to the
  // character) and forms the cacheable prefix for provider prompt caching
  // (Anthropic ephemeral cache, OpenAI automatic prefix cache, etc.).
  contextMessages.push({
    role: 'system',
    content: finalSystemPrompt,
    metadata: { isInjected: true },
  })

  // System block 2 — fully static identity reinforcement. Emitted as a
  // separate system message so block 1 can be marked with a cache breakpoint
  // without the reinforcement's content changes invalidating it. (The
  // reinforcement no longer names individual participants — that list used
  // to live here and bisected the cacheable region; participant attribution
  // now comes from Host roster announcements + per-message `name` fields.)
  const identityReminder = buildIdentityReinforcement(character.name)
  contextMessages.push({
    role: 'system',
    content: identityReminder,
    metadata: { isInjected: true },
  })

  // System block 3 — compressed-history rolling summary, only when budget
  // compression fired. Lives in its own block so its churn (refreshed every
  // few turns by the async compressor) does not invalidate the persona
  // prefix that blocks 1 and 2 form.
  if (compressedHistoryBlock) {
    contextMessages.push({
      role: 'system',
      content: compressedHistoryBlock,
      metadata: { isInjected: true },
    })
  }

  // Add selected conversation messages.
  // The first surviving Librarian summary whisper (after the running-summary
  // fold drops earlier turns) gets a cache breakpoint so the system+tools
  // prefix stays hot across fold events.
  let summaryBreakpointPlaced = false
  for (const msg of selectedMessages) {
    const isSummaryHead = !summaryBreakpointPlaced &&
      typeof msg.content === 'string' &&
      msg.content.startsWith(SUMMARY_CONTENT_PREFIX)
    contextMessages.push({
      role: msg.role.toLowerCase() as 'user' | 'assistant',
      content: msg.content,
      thoughtSignature: msg.thoughtSignature,
      name: msg.name,
      cacheControl: isSummaryHead ? { type: 'ephemeral' } : undefined,
    })
    if (isSummaryHead) summaryBreakpointPlaced = true
  }

  // Off-scene character introduction: when a workspace character is
  // name-dropped for the first time in this chat, the Host posts a public
  // introduction. The announcement is persisted to chat history (above) and
  // surfaced to THIS turn's LLM context here so the responding character
  // sees the intro without a one-turn lag.
  if (pendingOffSceneAnnouncement) {
    contextMessages.push({
      role: 'assistant',
      content: pendingOffSceneAnnouncement.content,
    })
  }

  // Phase G: timestamp whisper. When `timestampConfig.autoPrepend` is set and
  // the mode says to inject this turn (`START_ONLY` + isInitialMessage, or
  // `EVERY_MESSAGE`), the Host narrates the current time. The whisper is
  // persisted into the transcript (visible to the user with the Host avatar)
  // and added to this turn's `contextMessages` so the LLM sees it without a
  // one-turn lag. The `{{timestamp}}` template variable path is unaffected.
  if (
    options.timestampConfig?.autoPrepend &&
    shouldInjectTimestamp(options.timestampConfig, options.isInitialMessage ?? false)
  ) {
    const timestamp = calculateCurrentTimestamp(options.timestampConfig, options.timezone)
    await postHostTimestampAnnouncement({
      chatId: chat.id,
      formatted: timestamp.formatted,
    })
    contextMessages.push({
      role: 'assistant',
      content: buildTimestampContent(timestamp.formatted),
    })
  }

  // Memory tail: persist a single consolidated Commonplace Book whisper to the
  // transcript (visible in the salon UI with the Commonplace Book avatar) AND
  // inline plain "you remember…" framing into the new user message body for
  // this turn's LLM call. The Staff persona stays in the transcript; the LLM
  // receives clean second-person recall, not meta-narrative.
  const cmpbParts = {
    currentState: currentStateContent || undefined,
    recap: memoryRecapContent || undefined,
    relevant: memoryContent || undefined,
    interChar: interCharacterMemoryContent || undefined,
    knowledge: knowledgeContent || undefined,
  }
  const personaWhisper = buildCommonplacePersonaWhisper(cmpbParts)
  const llmRecallText = buildCommonplaceLLMContext(cmpbParts)

  if (personaWhisper) {
    // Persist the persona-voiced whisper. Targeted to the responding character
    // in multi-character chats; untargeted in single-character (only one
    // character anyway, so no privacy concern).
    const targetParticipantId = isMultiCharacter ? respondingParticipant?.id ?? null : null
    const posted = await postCommonplaceWhisper({
      chatId: chat.id,
      targetParticipantId,
      content: personaWhisper,
      kind: 'consolidated',
    })

    // The Commonplace Book whisper is a snapshot reminder, not a permanent
    // record — once a fresher one lands for this character, every prior
    // commonplaceBook whisper targeted at the same scope is stale. Sweep
    // them after the new one is durably posted (so a write failure on the
    // new one cannot orphan the character with no whisper at all).
    if (posted) {
      try {
        const refreshed = await getRepositories().chats.getMessages(chat.id)
        const stale = refreshed
          .filter((m): m is MessageEvent => m.type === 'message')
          .filter(m => m.systemSender === 'commonplaceBook' && m.id !== posted.id)
          .filter(m => {
            const ids = m.targetParticipantIds
            if (targetParticipantId === null) {
              return ids === null || ids === undefined
            }
            return Array.isArray(ids) && ids.includes(targetParticipantId)
          })
          .map(m => m.id)

        if (stale.length > 0) {
          const removed = await getRepositories().chats.deleteMessagesByIds(chat.id, stale)
          logger.info('[CommonplaceWhisper] Swept stale whispers', {
            chatId: chat.id,
            messageId: posted.id,
            targetParticipantId,
            deletedCount: removed,
          })
        }
      } catch (sweepError) {
        logger.error('[CommonplaceWhisper] Failed to sweep stale whispers', {
          chatId: chat.id,
          targetParticipantId,
          error: getErrorMessage(sweepError),
        }, sweepError as Error)
      }
    }
  }

  // Add new user message (only if provided - not in continue mode)
  // In multi-character mode, include the user's character name
  if (newUserMessage) {
    let newUserMsgName: string | undefined
    if (isMultiCharacter && allParticipants && participantCharacters) {
      newUserMsgName = findUserParticipantName(allParticipants, participantCharacters)
    }

    const composedUserContent = llmRecallText
      ? `${newUserMessage}\n\n---\n\n${llmRecallText}`
      : newUserMessage

    contextMessages.push({
      role: 'user',
      content: composedUserContent,
      name: newUserMsgName,
    })
  }

  // Calculate final token usage
  // Use effective system prompt tokens (possibly compressed)
  const totalMemoryTokens = memoryRecapTokens + memoryTokens + interCharacterMemoryTokens
  const totalUsed = effectiveSystemPromptTokens + totalMemoryTokens + knowledgeTokens + summaryTokens + messagesTokens + newUserMessageTokens
  const totalMemoriesIncluded = memoriesIncluded + interCharacterMemoriesIncluded

  return {
    messages: contextMessages,
    tokenUsage: {
      systemPrompt: effectiveSystemPromptTokens,
      memories: totalMemoryTokens,
      knowledge: knowledgeTokens,
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
    debugKnowledge: debugKnowledge.length > 0 ? debugKnowledge : undefined,
    debugMemoryRecap: memoryRecapContent || undefined,
    debugSummary: chat.contextSummary || undefined,
    debugSystemPrompt: compressedHistoryBlock
      ? `${finalSystemPrompt}\n\n${compressedHistoryBlock}`
      : finalSystemPrompt,
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
