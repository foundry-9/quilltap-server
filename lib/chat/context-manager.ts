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

import { Provider, Memory, Character, Persona, ChatParticipantBase, ChatMetadataBase } from '@/lib/schemas/types'
import { estimateTokens, countMessagesTokens, truncateToTokenLimit } from '@/lib/tokens/token-counter'
import { getModelContextLimit, getRecommendedContextAllocation, shouldSummarizeConversation } from '@/lib/llm/model-context-data'
import { searchMemoriesSemantic, SemanticSearchResult } from '@/lib/memory/memory-service'
import { formatMessagesForProvider, buildMultiCharacterContextSection, type MultiCharacterMessage } from '@/lib/llm/message-formatter'
import { logger } from '@/lib/logger'

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
 * Extended message format for multi-character context building
 * Includes participantId for attribution
 */
export interface MessageWithParticipant {
  role: string
  content: string
  id?: string
  thoughtSignature?: string | null
  /** Which participant sent this message (for multi-character attribution) */
  participantId?: string | null
  /** When the message was created (for history access filtering) */
  createdAt?: string
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
  /** New user message being sent */
  newUserMessage: string
  /** Custom system prompt override */
  systemPromptOverride?: string | null
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
 * Other participant info for multi-character system prompts
 */
export interface OtherParticipantInfo {
  name: string
  description?: string
  type: 'CHARACTER' | 'PERSONA'
}

/**
 * Build the system prompt for a character
 * Supports both single-character and multi-character scenarios
 */
export function buildSystemPrompt(
  character: Character,
  persona?: { name: string; description: string } | null,
  systemPromptOverride?: string | null,
  /** For multi-character chats: info about other participants */
  otherParticipants?: OtherParticipantInfo[]
): string {
  const parts: string[] = []

  // Base system prompt from character or override
  if (systemPromptOverride) {
    parts.push(systemPromptOverride)
  } else if (character.systemPrompt) {
    parts.push(character.systemPrompt)
  }

  // Character personality
  if (character.personality) {
    parts.push(`\n## Character Personality\n${character.personality}`)
  }

  // Scenario/setting
  if (character.scenario) {
    parts.push(`\n## Scenario\n${character.scenario}`)
  }

  // Example dialogues for style reference
  if (character.exampleDialogues) {
    parts.push(`\n## Example Dialogue Style\n${character.exampleDialogues}`)
  }

  // Persona information if provided (single-character mode)
  // In multi-character mode, the persona is included in otherParticipants
  if (persona && (!otherParticipants || otherParticipants.length === 0)) {
    parts.push(`\n## User Persona\nYou are speaking with ${persona.name}. ${persona.description}`)
  }

  // Multi-character context section
  if (otherParticipants && otherParticipants.length > 0) {
    const multiCharSection = buildMultiCharacterContextSection(
      otherParticipants,
      character.name
    )
    if (multiCharSection) {
      parts.push(multiCharSection)
    }
  }

  return parts.join('\n\n').trim()
}

/**
 * Filter messages based on participant's history access
 * If hasHistoryAccess is false, only include messages after the participant joined
 */
export function filterMessagesByHistoryAccess(
  messages: MessageWithParticipant[],
  participant: ChatParticipantBase
): MessageWithParticipant[] {
  // If participant has full history access, return all messages
  if (participant.hasHistoryAccess) {
    logger.debug('[ContextManager] Participant has full history access', {
      participantId: participant.id,
    })
    return messages
  }

  // Otherwise, filter to only messages after the participant joined
  const participantJoinTime = new Date(participant.createdAt).getTime()

  const filteredMessages = messages.filter(msg => {
    if (!msg.createdAt) {
      // If no createdAt, include the message (shouldn't happen)
      return true
    }
    const msgTime = new Date(msg.createdAt).getTime()
    return msgTime >= participantJoinTime
  })

  logger.debug('[ContextManager] Filtered messages by history access', {
    participantId: participant.id,
    joinTime: participant.createdAt,
    originalCount: messages.length,
    filteredCount: filteredMessages.length,
  })

  return filteredMessages
}

/**
 * Get participant name for message attribution
 */
export function getParticipantName(
  participantId: string | null | undefined,
  participantCharacters: Map<string, Character>,
  participantPersonas: Map<string, Persona>,
  allParticipants: ChatParticipantBase[]
): string | undefined {
  if (!participantId) {
    return undefined
  }

  // Find the participant
  const participant = allParticipants.find(p => p.id === participantId)
  if (!participant) {
    return undefined
  }

  if (participant.type === 'CHARACTER' && participant.characterId) {
    const character = participantCharacters.get(participant.characterId)
    return character?.name
  }

  if (participant.type === 'PERSONA' && participant.personaId) {
    const persona = participantPersonas.get(participant.personaId)
    return persona?.name
  }

  return undefined
}

/**
 * Attribute messages for multi-character context
 * Converts messages to the responding character's perspective:
 * - Messages from the responding character → role: assistant
 * - Messages from other characters → role: user, with name
 * - Messages from user/persona → role: user, with name
 */
export function attributeMessagesForCharacter(
  messages: MessageWithParticipant[],
  respondingParticipantId: string,
  participantCharacters: Map<string, Character>,
  participantPersonas: Map<string, Persona>,
  allParticipants: ChatParticipantBase[]
): MultiCharacterMessage[] {
  logger.debug('[ContextManager] Attributing messages for character', {
    respondingParticipantId,
    messageCount: messages.length,
  })

  return messages.map(msg => {
    const participantName = getParticipantName(
      msg.participantId,
      participantCharacters,
      participantPersonas,
      allParticipants
    )

    // Determine role based on who sent the message
    let role: 'user' | 'assistant' = 'user'

    if (msg.participantId === respondingParticipantId) {
      // Message from the responding character → assistant role
      role = 'assistant'
    } else if (msg.role.toUpperCase() === 'ASSISTANT') {
      // Message from another character (was stored as ASSISTANT) → user role
      // The name attribution will distinguish them
      role = 'user'
    } else {
      // USER messages stay as user role
      role = 'user'
    }

    return {
      role,
      content: msg.content,
      name: participantName,
      participantId: msg.participantId || undefined,
      thoughtSignature: msg.thoughtSignature,
    }
  })
}

/**
 * Build other participants info for system prompt
 */
export function buildOtherParticipantsInfo(
  respondingParticipantId: string,
  allParticipants: ChatParticipantBase[],
  participantCharacters: Map<string, Character>,
  participantPersonas: Map<string, Persona>
): OtherParticipantInfo[] {
  const otherParticipants: OtherParticipantInfo[] = []

  for (const participant of allParticipants) {
    // Skip the responding participant
    if (participant.id === respondingParticipantId) {
      continue
    }

    // Skip inactive participants
    if (!participant.isActive) {
      continue
    }

    if (participant.type === 'CHARACTER' && participant.characterId) {
      const character = participantCharacters.get(participant.characterId)
      if (character) {
        otherParticipants.push({
          name: character.name,
          description: character.title || character.description || undefined,
          type: 'CHARACTER',
        })
      }
    } else if (participant.type === 'PERSONA' && participant.personaId) {
      const persona = participantPersonas.get(participant.personaId)
      if (persona) {
        otherParticipants.push({
          name: persona.name,
          description: persona.description || undefined,
          type: 'PERSONA',
        })
      }
    }
  }

  return otherParticipants
}

/**
 * Format memories for injection into context
 */
export function formatMemoriesForContext(
  memories: SemanticSearchResult[],
  maxTokens: number,
  provider: Provider
): {
  content: string
  tokenCount: number
  memoriesUsed: number
  debugMemories: Array<{ summary: string; importance: number; score: number }>
} {
  if (memories.length === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  const memoryParts: string[] = ['## Relevant Memories']
  let currentTokens = estimateTokens('## Relevant Memories\n', provider)
  let memoriesUsed = 0
  const debugMemories: Array<{ summary: string; importance: number; score: number }> = []

  // Sort by relevance score (highest first)
  const sortedMemories = [...memories].sort((a, b) => {
    // First by score, then by importance
    const scoreDiff = b.score - a.score
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff
    return b.memory.importance - a.memory.importance
  })

  for (const { memory, score } of sortedMemories) {
    // Use summary for context (more concise)
    const memoryLine = `- ${memory.summary}`
    const lineTokens = estimateTokens(memoryLine + '\n', provider)

    if (currentTokens + lineTokens > maxTokens) {
      break
    }

    memoryParts.push(memoryLine)
    currentTokens += lineTokens
    memoriesUsed++
    debugMemories.push({
      summary: memory.summary,
      importance: memory.importance,
      score,
    })
  }

  if (memoriesUsed === 0) {
    return { content: '', tokenCount: 0, memoriesUsed: 0, debugMemories: [] }
  }

  return {
    content: memoryParts.join('\n'),
    tokenCount: currentTokens,
    memoriesUsed,
    debugMemories,
  }
}

/**
 * Format conversation summary for context
 */
export function formatSummaryForContext(
  summary: string,
  maxTokens: number,
  provider: Provider
): { content: string; tokenCount: number } {
  if (!summary || summary.trim().length === 0) {
    return { content: '', tokenCount: 0 }
  }

  const header = '## Previous Conversation Summary'
  const fullContent = `${header}\n${summary}`
  const fullTokens = estimateTokens(fullContent, provider)

  if (fullTokens <= maxTokens) {
    return { content: fullContent, tokenCount: fullTokens }
  }

  // Truncate summary to fit
  const headerTokens = estimateTokens(header + '\n', provider)
  const availableForSummary = maxTokens - headerTokens
  const truncatedSummary = truncateToTokenLimit(summary, availableForSummary, provider)

  return {
    content: `${header}\n${truncatedSummary}`,
    tokenCount: estimateTokens(`${header}\n${truncatedSummary}`, provider),
  }
}

/**
 * Extended message type with optional participant info
 */
export interface SelectableMessage {
  role: string
  content: string
  id?: string
  thoughtSignature?: string | null
  name?: string
  participantId?: string | null
}

/**
 * Select recent messages to fit within token budget
 * Supports both single-character and multi-character message formats
 */
export function selectRecentMessages(
  messages: Array<SelectableMessage>,
  maxTokens: number,
  provider: Provider
): { messages: Array<SelectableMessage>; tokenCount: number; truncated: boolean } {
  if (messages.length === 0) {
    return { messages: [], tokenCount: 0, truncated: false }
  }

  const selectedMessages: Array<SelectableMessage> = []
  let totalTokens = 0
  let truncated = false

  // Work backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    // Account for potential name prefix in token count
    const nameOverhead = msg.name ? estimateTokens(`[${msg.name}] `, provider) : 0
    const msgTokens = estimateTokens(msg.content, provider) + nameOverhead + 4 // +4 for message overhead

    if (totalTokens + msgTokens > maxTokens) {
      truncated = true
      break
    }

    // Preserve all fields including name and participantId
    selectedMessages.unshift({
      role: msg.role,
      content: msg.content,
      thoughtSignature: msg.thoughtSignature,
      name: msg.name,
      participantId: msg.participantId,
    })
    totalTokens += msgTokens
  }

  // Ensure we have at least the last message if possible
  if (selectedMessages.length === 0 && messages.length > 0) {
    const lastMsg = messages[messages.length - 1]
    selectedMessages.push({
      role: lastMsg.role,
      content: lastMsg.content,
      thoughtSignature: lastMsg.thoughtSignature,
      name: lastMsg.name,
      participantId: lastMsg.participantId,
    })
    const nameOverhead = lastMsg.name ? estimateTokens(`[${lastMsg.name}] `, provider) : 0
    totalTokens = estimateTokens(lastMsg.content, provider) + nameOverhead + 4
    truncated = true
  }

  return {
    messages: selectedMessages,
    tokenCount: totalTokens,
    truncated,
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

  const systemPrompt = buildSystemPrompt(character, persona, systemPromptOverride, otherParticipantsInfo)
  const systemPromptTokens = estimateTokens(systemPrompt, provider)

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
  let debugMemories: Array<{ summary: string; importance: number; score: number }> = []

  if (!skipMemories && character.id) {
    try {
      // Search for memories relevant to the new user message
      const memoryResults = await searchMemoriesSemantic(
        character.id,
        newUserMessage,
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
  const usedTokens = finalSystemPromptTokens + memoryTokens + summaryTokens
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

    // Convert to SelectableMessage format
    messagesToProcess = attributedMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
      name: msg.name,
      participantId: msg.participantId,
      thoughtSignature: msg.thoughtSignature,
    }))

    // Prepend join scenario as a system note if present
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

  // 7. Add new user message
  const newUserMessageTokens = estimateTokens(newUserMessage, provider) + 4

  // 8. Assemble final context
  const contextMessages: ContextMessage[] = []

  // System prompt with injected memories and summary
  let fullSystemContent = finalSystemPrompt

  if (memoryContent) {
    fullSystemContent += '\n\n' + memoryContent
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

  // Add new user message
  // In multi-character mode, include the user's persona name
  let newUserMsgName: string | undefined
  if (isMultiCharacter && participantPersonas) {
    // Find the user/persona participant
    const personaParticipant = allParticipants?.find(p => p.type === 'PERSONA' && p.isActive)
    if (personaParticipant?.personaId) {
      const personaData = participantPersonas.get(personaParticipant.personaId)
      newUserMsgName = personaData?.name
    }
  }

  contextMessages.push({
    role: 'user',
    content: newUserMessage,
    name: newUserMsgName,
  })

  // Calculate final token usage
  const totalUsed = finalSystemPromptTokens + memoryTokens + summaryTokens + messagesTokens + newUserMessageTokens

  logger.debug('[ContextManager] Context built successfully', {
    isMultiCharacter,
    totalMessages: contextMessages.length,
    tokenUsage: totalUsed,
    messagesTruncated: truncated,
  })

  return {
    messages: contextMessages,
    tokenUsage: {
      systemPrompt: finalSystemPromptTokens,
      memories: memoryTokens,
      summary: summaryTokens,
      recentMessages: messagesTokens + newUserMessageTokens,
      total: totalUsed,
    },
    budget,
    includedSummary: summaryTokens > 0,
    memoriesIncluded,
    messagesIncluded: selectedMessages.length + 1, // +1 for new message
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
