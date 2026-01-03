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

import { Provider, Character, Persona, ChatParticipantBase, ChatMetadataBase, TimestampConfig } from '@/lib/schemas/types'
import { estimateTokens, countMessagesTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { getModelContextLimit, getRecommendedContextAllocation, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { formatMessagesForProvider } from '@/lib/llm/message-formatter'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

// Import from extracted modules
import {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
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
  getParticipantName,
  attributeMessagesForCharacter,
  findUserParticipantName,
  type MessageWithParticipant,
} from './context/message-attribution'
import {
  selectRecentMessages,
  type SelectableMessage,
} from './context/message-selector'

// Re-export types from extracted modules for backwards compatibility
export type { OtherParticipantInfo, ProjectContext } from './context/system-prompt-builder'
export type { MessageWithParticipant } from './context/message-attribution'
export type { SelectableMessage } from './context/message-selector'

// Re-export functions from extracted modules for backwards compatibility
export {
  buildSystemPrompt,
  buildOtherParticipantsInfo,
  formatMemoriesForContext,
  formatInterCharacterMemoriesForContext,
  formatSummaryForContext,
  filterMessagesByHistoryAccess,
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
  debugMemories?: Array<{ summary: string; importance: number; score: number }>
  /** Debug info: the conversation summary that was included */
  debugSummary?: string
  /** Debug info: the system prompt that was built */
  debugSystemPrompt?: string
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
  /** Map of participant ID -> Persona data (for personas) */
  participantPersonas?: Map<string, Persona>
  /** Extended messages with participantId for attribution */
  messagesWithParticipants?: MessageWithParticipant[]

  // ============================================================================
  // Pseudo-Tool Support (for models without native function calling)
  // ============================================================================

  /** Instructions for text-based pseudo-tools (when model doesn't support native tools) */
  pseudoToolInstructions?: string

  // ============================================================================
  // Timestamp Injection
  // ============================================================================

  /** Timestamp configuration (from chat or user settings) */
  timestampConfig?: TimestampConfig | null
  /** Whether this is the first user message in the conversation */
  isInitialMessage?: boolean

  // ============================================================================
  // Project Context
  // ============================================================================

  /** Project context to inject into system prompt (if chat is in a project) */
  projectContext?: ProjectContext | null
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
    participantPersonas,
    messagesWithParticipants,
    // Pseudo-tool support
    pseudoToolInstructions,
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
    participantPersonas &&
    messagesWithParticipants
  )

  logger.debug('[ContextManager] Building context', {
    isMultiCharacter,
    characterName: character.name,
    participantCount: allParticipants?.length ?? 1,
    messageCount: existingMessages.length,
  })

  // 1. Build system prompt (with multi-character info if applicable)
  let otherParticipantsInfo: OtherParticipantInfo[] | undefined
  if (isMultiCharacter && respondingParticipant && allParticipants && participantCharacters && participantPersonas) {
    otherParticipantsInfo = buildOtherParticipantsInfo(
      respondingParticipant.id,
      allParticipants,
      participantCharacters,
      participantPersonas
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
    pseudoToolInstructions,
    selectedSystemPromptId,
    options.timestampConfig,
    options.isInitialMessage,
    projectContext
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

  // 2. Retrieve and format relevant memories
  let memoryContent = ''
  let memoryTokens = 0
  let memoriesIncluded = 0
  let debugMemories: DebugMemoryInfo[] = []

  // In continue mode (no newUserMessage), use the last message content for memory search
  // or skip memory search if there are no messages
  const memorySearchQuery = newUserMessage ||
    (existingMessages.length > 0 ? existingMessages[existingMessages.length - 1].content : '')

  if (!skipMemories && character.id && memorySearchQuery) {
    try {
      // Search for memories relevant to the message (or last message in continue mode)
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

          logger.debug('[ContextManager] Retrieved inter-character memories', {
            characterId: character.id,
            otherCharacterCount: otherCharacterIds.length,
            memoriesFound: interCharacterMemories.length,
            memoriesIncluded: interCharacterMemoriesIncluded,
          })
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
  const usedTokens = finalSystemPromptTokens + memoryTokens + interCharacterMemoryTokens + summaryTokens
  const remainingBudget = budget.totalLimit - usedTokens - budget.responseReserve

  // 5. Prepare messages based on single vs multi-character mode
  let messagesToProcess: SelectableMessage[]

  if (isMultiCharacter && respondingParticipant && allParticipants && participantCharacters && participantPersonas && messagesWithParticipants) {
    // Multi-character mode: filter by history access, then attribute messages

    // 5a. Filter messages by history access
    const filteredMessages = filterMessagesByHistoryAccess(messagesWithParticipants, respondingParticipant)

    // 5b. Prepend join scenario if participant has one and doesn't have history access
    let joinScenarioContent = ''
    if (!respondingParticipant.hasHistoryAccess && respondingParticipant.joinScenario) {
      joinScenarioContent = respondingParticipant.joinScenario
      logger.debug('[ContextManager] Including join scenario for participant', {
        participantId: respondingParticipant.id,
        joinScenario: joinScenarioContent.substring(0, 100),
      })
    }

    // 5c. Attribute messages for the responding character's perspective
    const attributedMessages = attributeMessagesForCharacter(
      filteredMessages,
      respondingParticipant.id,
      participantCharacters,
      participantPersonas,
      allParticipants
    )

    // Debug: Log attributed messages to help diagnose identity confusion
    logger.debug('[ContextManager] Attributed messages for multi-character', {
      respondingParticipantId: respondingParticipant.id,
      messageCount: attributedMessages.length,
      messages: attributedMessages.map(m => ({
        role: m.role,
        name: m.name,
        participantId: m.participantId,
        contentPreview: m.content.substring(0, 50),
      })),
    })

    // Convert to SelectableMessage format
    messagesToProcess = attributedMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      name: msg.name,
      participantId: msg.participantId,
      thoughtSignature: msg.thoughtSignature,
    }))

    // Prepend join scenario to final system prompt if present
    if (joinScenarioContent) {
      // Add join scenario to final system prompt instead of as a separate message
      finalSystemPrompt += `\n\n## How You Entered This Conversation\n${joinScenarioContent}`
    }
  } else {
    // Single-character mode: use existing messages as-is
    messagesToProcess = existingMessages.map(msg => ({
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
  let fullSystemContent = finalSystemPrompt

  if (memoryContent) {
    fullSystemContent += '\n\n' + memoryContent
  }

  if (interCharacterMemoryContent) {
    fullSystemContent += '\n\n' + interCharacterMemoryContent
  }

  if (summaryContent) {
    fullSystemContent += '\n\n' + summaryContent
  }

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
  // In multi-character mode, include the user's character name (or legacy persona name)
  if (newUserMessage) {
    let newUserMsgName: string | undefined
    if (isMultiCharacter && allParticipants && participantCharacters && participantPersonas) {
      newUserMsgName = findUserParticipantName(allParticipants, participantCharacters, participantPersonas)
    }

    contextMessages.push({
      role: 'user',
      content: newUserMessage,
      name: newUserMsgName,
    })
  }

  // Calculate final token usage
  const totalMemoryTokens = memoryTokens + interCharacterMemoryTokens
  const totalUsed = finalSystemPromptTokens + totalMemoryTokens + summaryTokens + messagesTokens + newUserMessageTokens
  const totalMemoriesIncluded = memoriesIncluded + interCharacterMemoriesIncluded

  logger.debug('[ContextManager] Context built successfully', {
    isMultiCharacter,
    totalMessages: contextMessages.length,
    tokenUsage: totalUsed,
    messagesTruncated: truncated,
    memoriesIncluded,
    interCharacterMemoriesIncluded,
  })

  return {
    messages: contextMessages,
    tokenUsage: {
      systemPrompt: finalSystemPromptTokens,
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
    debugSystemPrompt: finalSystemPrompt,
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
