/**
 * Memory Processor
 * Sprint 3: Auto-Memory Formation
 *
 * This module handles automatic memory extraction from chat messages.
 * It runs as a background task to avoid blocking chat responses.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { extractMemoryFromMessage, extractCharacterMemoryFromMessage, extractInterCharacterMemoryFromMessage, MemoryCandidate, UncensoredFallbackOptions } from './cheap-llm-tasks'
import { getCheapLLMProvider, CheapLLMConfig, CheapLLMSelection, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { resolveMaxTokens } from '@/lib/llm/model-context-data'
import { ConnectionProfile, CheapLLMSettings, Memory } from '@/lib/schemas/types'
import type { Pronouns } from '@/lib/schemas/character.types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import { createMemoryWithGate } from './memory-service'
import type { MemoryGateOutcome } from './memory-gate'
import { logger } from '@/lib/logger'
import { formatNameWithPronouns } from './format-utils'

/**
 * Context for memory extraction
 */
export interface MemoryExtractionContext {
  /** Character ID to associate the memory with */
  characterId: string
  /** Character name for context */
  characterName: string
  /** Character pronouns for context */
  characterPronouns?: Pronouns | null
  /** User character name if available */
  userCharacterName?: string
  /** User character ID - who the memory is about (the user-controlled character in the chat) */
  userCharacterId?: string
  /** All character names in a multi-character chat (for clear identity context) */
  allCharacterNames?: string[]
  /** Map of character name to pronouns for multi-character chats */
  allCharacterPronouns?: Record<string, Pronouns | null>
  /** Chat ID for source reference */
  chatId: string
  /** User message content */
  userMessage: string
  /** Assistant response content */
  assistantMessage: string
  /** Source message ID for tracking */
  sourceMessageId: string
  /** Source message createdAt timestamp (to preserve original timing on extracted memories) */
  sourceMessageTimestamp?: string
  /** User ID for API access */
  userId: string
  /** Connection profile for cheap LLM */
  connectionProfile: ConnectionProfile
  /** Cheap LLM settings */
  cheapLLMSettings: CheapLLMSettings
  /** Available connection profiles for user-defined strategy */
  availableProfiles?: ConnectionProfile[]
  /** Dangerous content settings for uncensored fallback */
  dangerSettings?: DangerousContentSettings
  /** Whether the chat is flagged as permanently dangerous */
  isDangerousChat?: boolean
}

/**
 * Context for inter-character memory extraction in multi-character chats
 */
export interface InterCharacterMemoryContext {
  /** The character who is forming the memory (observer) */
  observerCharacterId: string
  /** The observer character's name */
  observerCharacterName: string
  /** The observer character's pronouns */
  observerCharacterPronouns?: Pronouns | null
  /** What the observer said in this exchange */
  observerMessage: string
  /** The character being observed (subject of the memory) */
  subjectCharacterId: string
  /** The subject character's name */
  subjectCharacterName: string
  /** The subject character's pronouns */
  subjectCharacterPronouns?: Pronouns | null
  /** What the subject said in this exchange */
  subjectMessage: string
  /** Chat ID for source reference */
  chatId: string
  /** Source message ID for tracking */
  sourceMessageId: string
  /** Source message createdAt timestamp (to preserve original timing on extracted memories) */
  sourceMessageTimestamp?: string
  /** User ID for API access */
  userId: string
  /** Connection profile for cheap LLM */
  connectionProfile: ConnectionProfile
  /** Cheap LLM settings */
  cheapLLMSettings: CheapLLMSettings
  /** Available connection profiles for user-defined strategy */
  availableProfiles?: ConnectionProfile[]
  /** Dangerous content settings for uncensored fallback */
  dangerSettings?: DangerousContentSettings
  /** Whether the chat is flagged as permanently dangerous */
  isDangerousChat?: boolean
}

/**
 * Result of memory processing
 */
export interface MemoryProcessingResult {
  /** Whether extraction was successful */
  success: boolean
  /** Whether any memories were created */
  memoryCreated: boolean
  /** Whether any existing memories were reinforced */
  memoryReinforced: boolean
  /** IDs of all created memories */
  memoryIds: string[]
  /** IDs of all reinforced memories */
  reinforcedMemoryIds: string[]
  /** @deprecated Use memoryIds[0] — kept for backward compatibility */
  memoryId?: string
  /** @deprecated Use reinforcedMemoryIds[0] — kept for backward compatibility */
  reinforcedMemoryId?: string
  /** IDs of related memories that were linked */
  relatedMemoryIds?: string[]
  /** Error message if failed */
  error?: string
  /** Token usage for cost tracking */
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  /** Debug log messages for display in frontend */
  debugLogs?: string[]
}

/**
 * Converts CheapLLMSettings to CheapLLMConfig for the provider selection
 */
function toCheapLLMConfig(settings: CheapLLMSettings): CheapLLMConfig {
  return {
    strategy: settings.strategy,
    userDefinedProfileId: settings.userDefinedProfileId || undefined,
    fallbackToLocal: settings.fallbackToLocal,
  }
}

/**
 * Builds context string for memory extraction
 * Includes clear participant identification for multi-character chats
 */
function buildExtractionContext(ctx: MemoryExtractionContext): string {
  const parts: string[] = []

  parts.push('PARTICIPANTS IN THIS CONVERSATION:')

  // User identification
  if (ctx.userCharacterName) {
    parts.push(`- USER: ${ctx.userCharacterName} (the human participant)`)
  } else {
    parts.push('- USER: The human participant')
  }

  // Character(s) identification with pronouns
  if (ctx.allCharacterNames && ctx.allCharacterNames.length > 1) {
    // Multi-character chat - list all characters with pronouns
    parts.push('- CHARACTERS (AI characters in this chat):')
    for (const name of ctx.allCharacterNames) {
      const pronouns = ctx.allCharacterPronouns?.[name]
      const nameWithPronouns = formatNameWithPronouns(name, pronouns)
      const marker = name === ctx.characterName ? ' (currently responding)' : ''
      parts.push(`  * ${nameWithPronouns}${marker}`)
    }
  } else {
    // Single character chat with pronouns
    const nameWithPronouns = formatNameWithPronouns(ctx.characterName, ctx.characterPronouns)
    parts.push(`- CHARACTER: ${nameWithPronouns} (an AI character)`)
  }

  return parts.join('\n')
}

/**
 * Creates a memory from an extraction candidate using the Memory Gate.
 * Returns the full gate outcome (action, novel details, related IDs).
 */
async function createMemoryFromCandidate(
  ctx: MemoryExtractionContext,
  candidate: MemoryCandidate
): Promise<MemoryGateOutcome> {
  return createMemoryWithGate(
    {
      characterId: ctx.characterId,
      aboutCharacterId: ctx.userCharacterId || null,
      chatId: ctx.chatId,
      content: candidate.content || '',
      summary: candidate.summary || '',
      keywords: candidate.keywords || [],
      importance: candidate.importance || 0.5,
      source: 'AUTO',
      sourceMessageId: ctx.sourceMessageId,
      sourceMessageTimestamp: ctx.sourceMessageTimestamp,
      tags: [],
    },
    {
      userId: ctx.userId,
    }
  )
}

/**
 * Creates an inter-character memory from an extraction candidate using the Memory Gate.
 */
async function createInterCharacterMemoryFromCandidate(
  ctx: InterCharacterMemoryContext,
  candidate: MemoryCandidate
): Promise<MemoryGateOutcome> {
  return createMemoryWithGate(
    {
      characterId: ctx.observerCharacterId,
      aboutCharacterId: ctx.subjectCharacterId,
      chatId: ctx.chatId,
      content: candidate.content || '',
      summary: candidate.summary || '',
      keywords: candidate.keywords || [],
      importance: candidate.importance || 0.5,
      source: 'AUTO',
      sourceMessageId: ctx.sourceMessageId,
      sourceMessageTimestamp: ctx.sourceMessageTimestamp,
      tags: [],
    },
    {
      userId: ctx.userId,
    }
  )
}

/**
 * Processes a message exchange for potential memory extraction
 *
 * This is the main entry point for automatic memory formation.
 * It should be called after each assistant response in a chat.
 *
 * The function is designed to be non-blocking and fail-safe:
 * - Errors are caught and logged but don't propagate
 * - The chat flow is never blocked by memory extraction
 */
export async function processMessageForMemory(
  ctx: MemoryExtractionContext
): Promise<MemoryProcessingResult> {
  const debugLogs: string[] = []

  try {
    // Get cheap LLM provider selection
    const config = toCheapLLMConfig(ctx.cheapLLMSettings)
    let selection: CheapLLMSelection = getCheapLLMProvider(
      ctx.connectionProfile,
      config,
      ctx.availableProfiles || [],
      false // ollamaAvailable - we'll check via available profiles
    )

    // For dangerous chats, prefer an uncensored provider to avoid content refusals
    selection = resolveUncensoredCheapLLMSelection(
      selection,
      ctx.isDangerousChat ?? false,
      ctx.dangerSettings,
      ctx.availableProfiles ?? []
    )

    // Build context for extraction
    const extractionContext = buildExtractionContext(ctx)

    // Build uncensored fallback options if danger settings are provided
    const uncensoredFallback: UncensoredFallbackOptions | undefined =
      ctx.dangerSettings && ctx.availableProfiles
        ? { dangerSettings: ctx.dangerSettings, availableProfiles: ctx.availableProfiles }
        : undefined

    // Resolve max tokens for the cheap LLM profile to determine memory limits
    const cheapMaxTokens = resolveMaxTokens(ctx.connectionProfile)

    // Extract memories for both user and character
    const [userMemoryResult, characterMemoryResult] = await Promise.all([
      extractMemoryFromMessage(
        ctx.userMessage,
        ctx.assistantMessage,
        extractionContext,
        ctx.characterName,
        ctx.userCharacterName,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        ctx.characterPronouns,
        cheapMaxTokens
      ),
      extractCharacterMemoryFromMessage(
        ctx.userMessage,
        ctx.assistantMessage,
        extractionContext,
        ctx.characterName,
        ctx.userCharacterName,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        ctx.characterPronouns,
        cheapMaxTokens
      ),
    ])

    const memoryIds: string[] = []
    const reinforcedMemoryIds: string[] = []
    const allRelatedMemoryIds: string[] = []
    const totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }

    // Process user memories
    if (userMemoryResult.success && userMemoryResult.usage) {
      totalUsage.promptTokens += userMemoryResult.usage.promptTokens
      totalUsage.completionTokens += userMemoryResult.usage.completionTokens
      totalUsage.totalTokens += userMemoryResult.usage.totalTokens
    }

    if (userMemoryResult.success) {
      const userCandidates = userMemoryResult.result || []

      if (userCandidates.length > 0) {
        for (const candidate of userCandidates) {
          const outcome = await createMemoryFromCandidate(ctx, candidate)

          switch (outcome.action) {
            case 'REINFORCE': {
              reinforcedMemoryIds.push(outcome.memory.id)
              debugLogs.push(
                `[Memory] REINFORCED USER memory for ${ctx.characterName}:\n` +
                `  Memory ID: ${outcome.memory.id}\n` +
                `  Count: ${outcome.memory.reinforcementCount ?? 1}\n` +
                `  Novel details: ${outcome.novelDetails?.join(', ') || 'none'}\n` +
                `  Summary: ${candidate.summary}`
              )
              break
            }
            case 'INSERT_RELATED': {
              memoryIds.push(outcome.memory.id)
              if (outcome.relatedMemoryIds) allRelatedMemoryIds.push(...outcome.relatedMemoryIds)
              debugLogs.push(
                `[Memory] Created USER memory (linked to ${outcome.relatedMemoryIds?.length || 0} related) for ${ctx.characterName}:\n` +
                `  Content: ${candidate.content}\n` +
                `  Summary: ${candidate.summary}\n` +
                `  Importance: ${candidate.importance}\n` +
                `  Keywords: ${candidate.keywords?.join(', ')}\n` +
                `  Related: ${outcome.relatedMemoryIds?.join(', ')}`
              )
              break
            }
            case 'INSERT':
            case 'SKIP_GATE':
            default: {
              memoryIds.push(outcome.memory.id)
              debugLogs.push(
                `[Memory] Created USER memory for ${ctx.characterName}:\n` +
                `  Content: ${candidate.content}\n` +
                `  Summary: ${candidate.summary}\n` +
                `  Importance: ${candidate.importance}\n` +
                `  Keywords: ${candidate.keywords?.join(', ')}`
              )
              break
            }
          }
        }
      } else {
        debugLogs.push(`[Memory] No significant USER memories for ${ctx.characterName}`)
      }
    } else if (!userMemoryResult.success) {
      debugLogs.push(
        `[Memory] USER memory extraction failed for ${ctx.characterName}:\n` +
        `  Error: ${userMemoryResult.error}\n` +
        `  User message: ${ctx.userMessage.substring(0, 200)}${ctx.userMessage.length > 200 ? '...' : ''}`
      )
    }

    // Process character memories
    if (characterMemoryResult.success && characterMemoryResult.usage) {
      totalUsage.promptTokens += characterMemoryResult.usage.promptTokens
      totalUsage.completionTokens += characterMemoryResult.usage.completionTokens
      totalUsage.totalTokens += characterMemoryResult.usage.totalTokens
    }

    if (characterMemoryResult.success) {
      const charCandidates = characterMemoryResult.result || []

      if (charCandidates.length > 0) {
        for (const candidate of charCandidates) {
          const outcome = await createMemoryFromCandidate(ctx, candidate)

          switch (outcome.action) {
            case 'REINFORCE': {
              reinforcedMemoryIds.push(outcome.memory.id)
              debugLogs.push(
                `[Memory] REINFORCED CHARACTER memory for ${ctx.characterName}:\n` +
                `  Memory ID: ${outcome.memory.id}\n` +
                `  Count: ${outcome.memory.reinforcementCount ?? 1}\n` +
                `  Novel details: ${outcome.novelDetails?.join(', ') || 'none'}\n` +
                `  Summary: ${candidate.summary}`
              )
              break
            }
            case 'INSERT_RELATED': {
              memoryIds.push(outcome.memory.id)
              if (outcome.relatedMemoryIds) allRelatedMemoryIds.push(...outcome.relatedMemoryIds)
              debugLogs.push(
                `[Memory] Created CHARACTER memory (linked to ${outcome.relatedMemoryIds?.length || 0} related) for ${ctx.characterName}:\n` +
                `  Content: ${candidate.content}\n` +
                `  Summary: ${candidate.summary}\n` +
                `  Importance: ${candidate.importance}\n` +
                `  Keywords: ${candidate.keywords?.join(', ')}\n` +
                `  Related: ${outcome.relatedMemoryIds?.join(', ')}`
              )
              break
            }
            case 'INSERT':
            case 'SKIP_GATE':
            default: {
              memoryIds.push(outcome.memory.id)
              debugLogs.push(
                `[Memory] Created CHARACTER memory for ${ctx.characterName}:\n` +
                `  Content: ${candidate.content}\n` +
                `  Summary: ${candidate.summary}\n` +
                `  Importance: ${candidate.importance}\n` +
                `  Keywords: ${candidate.keywords?.join(', ')}`
              )
              break
            }
          }
        }
      } else {
        debugLogs.push(`[Memory] No significant CHARACTER memories for ${ctx.characterName}`)
      }
    } else if (!characterMemoryResult.success) {
      debugLogs.push(
        `[Memory] CHARACTER memory extraction failed for ${ctx.characterName}:\n` +
        `  Error: ${characterMemoryResult.error}\n` +
        `  Character message: ${ctx.assistantMessage.substring(0, 200)}${ctx.assistantMessage.length > 200 ? '...' : ''}`
      )
    }

    return {
      success: true,
      memoryCreated: memoryIds.length > 0,
      memoryReinforced: reinforcedMemoryIds.length > 0,
      memoryIds,
      reinforcedMemoryIds,
      memoryId: memoryIds[0],
      reinforcedMemoryId: reinforcedMemoryIds[0],
      relatedMemoryIds: allRelatedMemoryIds.length > 0 ? allRelatedMemoryIds : undefined,
      usage: totalUsage,
      debugLogs: debugLogs.length > 0 ? debugLogs : undefined,
    }
  } catch (error) {
    // Never let memory processing break the chat flow
    const errorMsg = 'Memory processing error:' + (error instanceof Error ? error.message : 'Unknown error')
    logger.error(errorMsg, { characterId: ctx.characterId, userId: ctx.userId }, error instanceof Error ? error : undefined)
    return {
      success: false,
      memoryCreated: false,
      memoryReinforced: false,
      memoryIds: [],
      reinforcedMemoryIds: [],
      error: error instanceof Error ? error.message : 'Unknown error',
      debugLogs: debugLogs.length > 0 ? debugLogs : undefined,
    }
  }
}

/**
 * Processes memory extraction in the background (fire-and-forget)
 *
 * This is a convenience wrapper that logs the result but doesn't await it.
 * Use this when you want to trigger memory extraction without blocking.
 */
export function processMessageForMemoryAsync(
  ctx: MemoryExtractionContext,
  onComplete?: (result: MemoryProcessingResult) => void
): void {
  processMessageForMemory(ctx)
    .then(result => {
      if (result.memoryCreated) {
        logger.info(
          '[Memory] Created memories for character',
          { memoryIds: result.memoryIds, count: result.memoryIds.length, characterId: ctx.characterId, userId: ctx.userId }
        )
      } else if (result.memoryReinforced) {
        logger.info(
          '[Memory] Reinforced existing memories for character',
          { reinforcedMemoryIds: result.reinforcedMemoryIds, count: result.reinforcedMemoryIds.length, characterId: ctx.characterId, userId: ctx.userId }
        )
      } else if (!result.success) {
        logger.warn(`[Memory] Extraction failed: ${result.error}`, { characterId: ctx.characterId, userId: ctx.userId })
      }
      // Call the callback with the full result
      onComplete?.(result)
      // Silent success without memory creation is normal (not everything is significant)
    })
    .catch(error => {
      logger.error('[Memory] Async processing error', { characterId: ctx.characterId, userId: ctx.userId }, error instanceof Error ? error : undefined)
    })
}

/**
 * Batch process existing chat messages for memory extraction
 *
 * Useful for extracting memories from historical conversations
 * or when memory extraction was temporarily disabled.
 *
 * @param chatId - The chat to process
 * @param characterId - The character ID
 * @param userId - The user ID for API access
 * @param options - Processing options
 */
export async function batchProcessChatForMemories(
  chatId: string,
  characterId: string,
  userId: string,
  options: {
    /** Only process messages after this timestamp */
    afterTimestamp?: string
    /** Maximum number of message pairs to process */
    maxPairs?: number
    /** Connection profile ID to use */
    connectionProfileId: string
  }
): Promise<{
  processed: number
  memoriesCreated: number
  errors: number
}> {
  const repos = getRepositories()

  // Get chat messages
  const messages = await repos.chats.getMessages(chatId)

  // Get character
  const character = await repos.characters.findById(characterId)
  if (!character) {
    throw new Error(`Character ${characterId} not found`)
  }

  // Get connection profile
  const connectionProfile = await repos.connections.findById(options.connectionProfileId)
  if (!connectionProfile) {
    throw new Error(`Connection profile ${options.connectionProfileId} not found`)
  }

  // Get chat settings for cheap LLM config
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  if (!chatSettings) {
    throw new Error(`Chat settings not found for user ${userId}`)
  }

  // Get all available profiles for user-defined strategy
  const availableProfiles = await repos.connections.findByUserId(userId)

  // Filter and pair messages - only include message events with USER or ASSISTANT role
  const messageEvents = messages
    .filter((m): m is typeof m & { type: 'message'; role: 'USER' | 'ASSISTANT' } =>
      m.type === 'message' &&
      (m.role === 'USER' || m.role === 'ASSISTANT') &&
      (!options.afterTimestamp || m.createdAt > options.afterTimestamp)
    )

  // Pair user messages with their subsequent assistant responses
  const pairs: Array<{
    userMessage: { id: string; content: string; createdAt: string }
    assistantMessage: { id: string; content: string; createdAt: string }
  }> = []

  for (let i = 0; i < messageEvents.length - 1; i++) {
    const current = messageEvents[i]
    const next = messageEvents[i + 1]

    if (current.role === 'USER' && next.role === 'ASSISTANT') {
      pairs.push({
        userMessage: { id: current.id, content: current.content, createdAt: current.createdAt },
        assistantMessage: { id: next.id, content: next.content, createdAt: next.createdAt },
      })
    }
  }

  // Limit pairs if specified
  const pairsToProcess = options.maxPairs
    ? pairs.slice(0, options.maxPairs)
    : pairs

  let processed = 0
  let memoriesCreated = 0
  let errors = 0

  // Process each pair
  for (const pair of pairsToProcess) {
    const result = await processMessageForMemory({
      characterId,
      characterName: character.name,
      chatId,
      userMessage: pair.userMessage.content,
      assistantMessage: pair.assistantMessage.content,
      sourceMessageId: pair.assistantMessage.id,
      sourceMessageTimestamp: pair.assistantMessage.createdAt,
      userId,
      connectionProfile,
      cheapLLMSettings: chatSettings.cheapLLMSettings,
      availableProfiles,
    })

    processed++

    if (result.memoryCreated) {
      memoriesCreated += result.memoryIds.length
    }

    if (!result.success) {
      errors++
    }

    // Small delay between API calls to avoid rate limiting
    if (processed < pairsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return { processed, memoriesCreated, errors }
}

/**
 * Processes an inter-character message exchange for potential memory extraction
 *
 * This is called in multi-character chats when one character responds to another.
 * It extracts memories that the responding character forms about other characters.
 *
 * @param ctx - The inter-character memory extraction context
 * @returns The result of memory processing
 */
export async function processInterCharacterMemory(
  ctx: InterCharacterMemoryContext
): Promise<MemoryProcessingResult> {
  const debugLogs: string[] = []

  try {
    // Get cheap LLM provider selection
    const config = toCheapLLMConfig(ctx.cheapLLMSettings)
    let selection: CheapLLMSelection = getCheapLLMProvider(
      ctx.connectionProfile,
      config,
      ctx.availableProfiles || [],
      false
    )

    // For dangerous chats, prefer an uncensored provider to avoid content refusals
    selection = resolveUncensoredCheapLLMSelection(
      selection,
      ctx.isDangerousChat ?? false,
      ctx.dangerSettings,
      ctx.availableProfiles ?? []
    )

    // Build uncensored fallback options if danger settings are provided
    const uncensoredFallback: UncensoredFallbackOptions | undefined =
      ctx.dangerSettings && ctx.availableProfiles
        ? { dangerSettings: ctx.dangerSettings, availableProfiles: ctx.availableProfiles }
        : undefined

    // Resolve max tokens for the cheap LLM profile to determine memory limits
    const cheapMaxTokens = resolveMaxTokens(ctx.connectionProfile)

    // Extract memories that observer has about subject
    const memoryResult = await extractInterCharacterMemoryFromMessage(
      ctx.observerCharacterName,
      ctx.observerMessage,
      ctx.subjectCharacterName,
      ctx.subjectMessage,
      selection,
      ctx.userId,
      uncensoredFallback,
      ctx.chatId,
      ctx.observerCharacterPronouns,
      ctx.subjectCharacterPronouns,
      cheapMaxTokens
    )

    const memoryIds: string[] = []
    const reinforcedMemoryIds: string[] = []
    const allRelatedMemoryIds: string[] = []
    const totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }

    if (memoryResult.success && memoryResult.usage) {
      totalUsage.promptTokens += memoryResult.usage.promptTokens
      totalUsage.completionTokens += memoryResult.usage.completionTokens
      totalUsage.totalTokens += memoryResult.usage.totalTokens
    }

    if (memoryResult.success) {
      const candidates = memoryResult.result || []

      if (candidates.length > 0) {
        for (const candidate of candidates) {
          const outcome = await createInterCharacterMemoryFromCandidate(ctx, candidate)

          switch (outcome.action) {
            case 'REINFORCE': {
              reinforcedMemoryIds.push(outcome.memory.id)
              debugLogs.push(
                `[Memory] REINFORCED INTER-CHARACTER memory: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
                `  Memory ID: ${outcome.memory.id}\n` +
                `  Count: ${outcome.memory.reinforcementCount ?? 1}\n` +
                `  Novel details: ${outcome.novelDetails?.join(', ') || 'none'}\n` +
                `  Summary: ${candidate.summary}`
              )
              break
            }
            case 'INSERT_RELATED': {
              memoryIds.push(outcome.memory.id)
              if (outcome.relatedMemoryIds) allRelatedMemoryIds.push(...outcome.relatedMemoryIds)
              debugLogs.push(
                `[Memory] Created INTER-CHARACTER memory (linked to ${outcome.relatedMemoryIds?.length || 0} related): ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
                `  Content: ${candidate.content}\n` +
                `  Summary: ${candidate.summary}\n` +
                `  Importance: ${candidate.importance}\n` +
                `  Keywords: ${candidate.keywords?.join(', ')}\n` +
                `  Related: ${outcome.relatedMemoryIds?.join(', ')}`
              )
              break
            }
            case 'INSERT':
            case 'SKIP_GATE':
            default: {
              memoryIds.push(outcome.memory.id)
              debugLogs.push(
                `[Memory] Created INTER-CHARACTER memory: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
                `  Content: ${candidate.content}\n` +
                `  Summary: ${candidate.summary}\n` +
                `  Importance: ${candidate.importance}\n` +
                `  Keywords: ${candidate.keywords?.join(', ')}`
              )
              break
            }
          }
        }
      } else {
        debugLogs.push(
          `[Memory] No significant INTER-CHARACTER memories: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}`
        )
      }
    } else {
      debugLogs.push(
        `[Memory] INTER-CHARACTER memory extraction failed: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
        `  Error: ${memoryResult.error}`
      )
    }

    return {
      success: true,
      memoryCreated: memoryIds.length > 0,
      memoryReinforced: reinforcedMemoryIds.length > 0,
      memoryIds,
      reinforcedMemoryIds,
      memoryId: memoryIds[0],
      reinforcedMemoryId: reinforcedMemoryIds[0],
      relatedMemoryIds: allRelatedMemoryIds.length > 0 ? allRelatedMemoryIds : undefined,
      usage: totalUsage,
      debugLogs: debugLogs.length > 0 ? debugLogs : undefined,
    }
  } catch (error) {
    const errorMsg = 'Inter-character memory processing error:' + (error instanceof Error ? error.message : 'Unknown error')
    logger.error(errorMsg, {
      observerCharacterId: ctx.observerCharacterId,
      subjectCharacterId: ctx.subjectCharacterId,
      userId: ctx.userId,
    }, error instanceof Error ? error : undefined)
    return {
      success: false,
      memoryCreated: false,
      memoryReinforced: false,
      memoryIds: [],
      reinforcedMemoryIds: [],
      error: error instanceof Error ? error.message : 'Unknown error',
      debugLogs: debugLogs.length > 0 ? debugLogs : undefined,
    }
  }
}

/**
 * Processes inter-character memory extraction in the background (fire-and-forget)
 *
 * This is a convenience wrapper for multi-character chats.
 * It extracts memories between all character pairs in the exchange.
 */
export function processInterCharacterMemoryAsync(
  ctx: InterCharacterMemoryContext,
  onComplete?: (result: MemoryProcessingResult) => void
): void {
  processInterCharacterMemory(ctx)
    .then(result => {
      if (result.memoryCreated) {
        logger.info(
          '[Memory] Created inter-character memories',
          {
            memoryIds: result.memoryIds,
            count: result.memoryIds.length,
            observerCharacterId: ctx.observerCharacterId,
            subjectCharacterId: ctx.subjectCharacterId,
            userId: ctx.userId,
          }
        )
      } else if (result.memoryReinforced) {
        logger.info(
          '[Memory] Reinforced inter-character memories',
          {
            reinforcedMemoryIds: result.reinforcedMemoryIds,
            count: result.reinforcedMemoryIds.length,
            observerCharacterId: ctx.observerCharacterId,
            subjectCharacterId: ctx.subjectCharacterId,
            userId: ctx.userId,
          }
        )
      } else if (!result.success) {
        logger.warn(`[Memory] Inter-character extraction failed: ${result.error}`, {
          observerCharacterId: ctx.observerCharacterId,
          subjectCharacterId: ctx.subjectCharacterId,
          userId: ctx.userId,
        })
      }
      onComplete?.(result)
    })
    .catch(error => {
      logger.error('[Memory] Async inter-character processing error', {
        observerCharacterId: ctx.observerCharacterId,
        subjectCharacterId: ctx.subjectCharacterId,
        userId: ctx.userId,
      }, error instanceof Error ? error : undefined)
    })
}
