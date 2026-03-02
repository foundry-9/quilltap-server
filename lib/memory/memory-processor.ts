/**
 * Memory Processor
 * Sprint 3: Auto-Memory Formation
 *
 * This module handles automatic memory extraction from chat messages.
 * It runs as a background task to avoid blocking chat responses.
 */

import { getRepositories } from '@/lib/repositories/factory'
import { extractMemoryFromMessage, extractCharacterMemoryFromMessage, extractInterCharacterMemoryFromMessage, MemoryCandidate, UncensoredFallbackOptions } from './cheap-llm-tasks'
import { getCheapLLMProvider, CheapLLMConfig, CheapLLMSelection } from '@/lib/llm/cheap-llm'
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
  /** Persona name if available (deprecated - use userCharacterId instead) */
  personaName?: string
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
}

/**
 * Result of memory processing
 */
export interface MemoryProcessingResult {
  /** Whether extraction was successful */
  success: boolean
  /** Whether a memory was created */
  memoryCreated: boolean
  /** Whether an existing memory was reinforced */
  memoryReinforced: boolean
  /** The created memory ID if successful */
  memoryId?: string
  /** The reinforced memory ID if reinforced */
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
  if (ctx.personaName) {
    parts.push(`- USER: ${ctx.personaName} (the human participant)`)
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
    const selection: CheapLLMSelection = getCheapLLMProvider(
      ctx.connectionProfile,
      config,
      ctx.availableProfiles || [],
      false // ollamaAvailable - we'll check via available profiles
    )

    // Build context for extraction
    const extractionContext = buildExtractionContext(ctx)

    // Build uncensored fallback options if danger settings are provided
    const uncensoredFallback: UncensoredFallbackOptions | undefined =
      ctx.dangerSettings && ctx.availableProfiles
        ? { dangerSettings: ctx.dangerSettings, availableProfiles: ctx.availableProfiles }
        : undefined

    // Extract memories for both user and character
    const [userMemoryResult, characterMemoryResult] = await Promise.all([
      extractMemoryFromMessage(
        ctx.userMessage,
        ctx.assistantMessage,
        extractionContext,
        ctx.characterName,
        ctx.personaName,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        ctx.characterPronouns
      ),
      extractCharacterMemoryFromMessage(
        ctx.userMessage,
        ctx.assistantMessage,
        extractionContext,
        ctx.characterName,
        ctx.personaName,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        ctx.characterPronouns
      ),
    ])

    let memoryCreated = false
    let memoryReinforced = false
    let memoryId: string | undefined = undefined
    let reinforcedMemoryId: string | undefined = undefined
    let relatedMemoryIds: string[] | undefined = undefined
    let totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }

    // Process user memory
    if (userMemoryResult.success && userMemoryResult.usage) {
      totalUsage.promptTokens += userMemoryResult.usage.promptTokens
      totalUsage.completionTokens += userMemoryResult.usage.completionTokens
      totalUsage.totalTokens += userMemoryResult.usage.totalTokens
    }

    if (userMemoryResult.success) {
      const userCandidate = userMemoryResult.result

      if (userCandidate?.significant) {
        const outcome = await createMemoryFromCandidate(ctx, userCandidate)

        switch (outcome.action) {
          case 'REINFORCE': {
            memoryReinforced = true
            reinforcedMemoryId = outcome.memory.id
            const logMsg = `[Memory] REINFORCED USER memory for ${ctx.characterName}:\n` +
              `  Memory ID: ${outcome.memory.id}\n` +
              `  Count: ${outcome.memory.reinforcementCount ?? 1}\n` +
              `  Novel details: ${outcome.novelDetails?.join(', ') || 'none'}\n` +
              `  Summary: ${userCandidate.summary}`
            debugLogs.push(logMsg)
            break
          }
          case 'INSERT_RELATED': {
            memoryCreated = true
            memoryId = outcome.memory.id
            relatedMemoryIds = outcome.relatedMemoryIds
            const logMsg = `[Memory] Created USER memory (linked to ${outcome.relatedMemoryIds?.length || 0} related) for ${ctx.characterName}:\n` +
              `  Content: ${userCandidate.content}\n` +
              `  Summary: ${userCandidate.summary}\n` +
              `  Importance: ${userCandidate.importance}\n` +
              `  Keywords: ${userCandidate.keywords?.join(', ')}\n` +
              `  Related: ${outcome.relatedMemoryIds?.join(', ')}`
            debugLogs.push(logMsg)
            break
          }
          case 'INSERT':
          case 'SKIP_GATE':
          default: {
            memoryCreated = true
            memoryId = outcome.memory.id
            const logMsg = `[Memory] Created USER memory for ${ctx.characterName}:\n` +
              `  Content: ${userCandidate.content}\n` +
              `  Summary: ${userCandidate.summary}\n` +
              `  Importance: ${userCandidate.importance}\n` +
              `  Keywords: ${userCandidate.keywords?.join(', ')}`
            debugLogs.push(logMsg)
            break
          }
        }
      } else {
        const logMsg = `[Memory] USER memory not significant enough for ${ctx.characterName}:\n` +
          `  Summary: ${userCandidate?.summary || 'N/A'}\n` +
          `  Importance: ${userCandidate?.importance || 'N/A'}`
        debugLogs.push(logMsg)
      }
    } else if (!userMemoryResult.success) {
      const logMsg = `[Memory] USER memory extraction failed for ${ctx.characterName}:\n` +
        `  Error: ${userMemoryResult.error}\n` +
        `  User message: ${ctx.userMessage.substring(0, 200)}${ctx.userMessage.length > 200 ? '...' : ''}`
      debugLogs.push(logMsg)
    }

    // Process character memory
    if (characterMemoryResult.success && characterMemoryResult.usage) {
      totalUsage.promptTokens += characterMemoryResult.usage.promptTokens
      totalUsage.completionTokens += characterMemoryResult.usage.completionTokens
      totalUsage.totalTokens += characterMemoryResult.usage.totalTokens
    }

    if (characterMemoryResult.success) {
      const charCandidate = characterMemoryResult.result

      if (charCandidate?.significant) {
        const outcome = await createMemoryFromCandidate(ctx, charCandidate)

        switch (outcome.action) {
          case 'REINFORCE': {
            memoryReinforced = true
            if (!reinforcedMemoryId) reinforcedMemoryId = outcome.memory.id
            const logMsg = `[Memory] REINFORCED CHARACTER memory for ${ctx.characterName}:\n` +
              `  Memory ID: ${outcome.memory.id}\n` +
              `  Count: ${outcome.memory.reinforcementCount ?? 1}\n` +
              `  Novel details: ${outcome.novelDetails?.join(', ') || 'none'}\n` +
              `  Summary: ${charCandidate.summary}`
            debugLogs.push(logMsg)
            break
          }
          case 'INSERT_RELATED': {
            memoryCreated = true
            if (!memoryId) memoryId = outcome.memory.id
            if (outcome.relatedMemoryIds) {
              relatedMemoryIds = [...(relatedMemoryIds || []), ...outcome.relatedMemoryIds]
            }
            const logMsg = `[Memory] Created CHARACTER memory (linked to ${outcome.relatedMemoryIds?.length || 0} related) for ${ctx.characterName}:\n` +
              `  Content: ${charCandidate.content}\n` +
              `  Summary: ${charCandidate.summary}\n` +
              `  Importance: ${charCandidate.importance}\n` +
              `  Keywords: ${charCandidate.keywords?.join(', ')}\n` +
              `  Related: ${outcome.relatedMemoryIds?.join(', ')}`
            debugLogs.push(logMsg)
            break
          }
          case 'INSERT':
          case 'SKIP_GATE':
          default: {
            memoryCreated = true
            if (!memoryId) memoryId = outcome.memory.id
            const logMsg = `[Memory] Created CHARACTER memory for ${ctx.characterName}:\n` +
              `  Content: ${charCandidate.content}\n` +
              `  Summary: ${charCandidate.summary}\n` +
              `  Importance: ${charCandidate.importance}\n` +
              `  Keywords: ${charCandidate.keywords?.join(', ')}`
            debugLogs.push(logMsg)
            break
          }
        }
      } else {
        const logMsg = `[Memory] CHARACTER memory not significant enough for ${ctx.characterName}:\n` +
          `  Summary: ${charCandidate?.summary || 'N/A'}\n` +
          `  Importance: ${charCandidate?.importance || 'N/A'}`
        debugLogs.push(logMsg)
      }
    } else if (!characterMemoryResult.success) {
      const logMsg = `[Memory] CHARACTER memory extraction failed for ${ctx.characterName}:\n` +
        `  Error: ${characterMemoryResult.error}\n` +
        `  Character message: ${ctx.assistantMessage.substring(0, 200)}${ctx.assistantMessage.length > 200 ? '...' : ''}`
      debugLogs.push(logMsg)
    }

    return {
      success: true,
      memoryCreated,
      memoryReinforced,
      memoryId,
      reinforcedMemoryId,
      relatedMemoryIds: relatedMemoryIds && relatedMemoryIds.length > 0 ? relatedMemoryIds : undefined,
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
          '[Memory] Created memory for character',
          { memoryId: result.memoryId, characterId: ctx.characterId, userId: ctx.userId }
        )
      } else if (result.memoryReinforced) {
        logger.info(
          '[Memory] Reinforced existing memory for character',
          { reinforcedMemoryId: result.reinforcedMemoryId, characterId: ctx.characterId, userId: ctx.userId }
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
    userMessage: { id: string; content: string }
    assistantMessage: { id: string; content: string }
  }> = []

  for (let i = 0; i < messageEvents.length - 1; i++) {
    const current = messageEvents[i]
    const next = messageEvents[i + 1]

    if (current.role === 'USER' && next.role === 'ASSISTANT') {
      pairs.push({
        userMessage: { id: current.id, content: current.content },
        assistantMessage: { id: next.id, content: next.content },
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
      userId,
      connectionProfile,
      cheapLLMSettings: chatSettings.cheapLLMSettings,
      availableProfiles,
    })

    processed++

    if (result.memoryCreated) {
      memoriesCreated++
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
    const selection: CheapLLMSelection = getCheapLLMProvider(
      ctx.connectionProfile,
      config,
      ctx.availableProfiles || [],
      false
    )

    // Build uncensored fallback options if danger settings are provided
    const uncensoredFallback: UncensoredFallbackOptions | undefined =
      ctx.dangerSettings && ctx.availableProfiles
        ? { dangerSettings: ctx.dangerSettings, availableProfiles: ctx.availableProfiles }
        : undefined

    // Extract memory that observer has about subject
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
      ctx.subjectCharacterPronouns
    )

    let memoryCreated = false
    let memoryReinforced = false
    let memoryId: string | undefined = undefined
    let reinforcedMemoryId: string | undefined = undefined
    let relatedMemoryIds: string[] | undefined = undefined
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
      const candidate = memoryResult.result

      if (candidate?.significant) {
        const outcome = await createInterCharacterMemoryFromCandidate(ctx, candidate)

        switch (outcome.action) {
          case 'REINFORCE': {
            memoryReinforced = true
            reinforcedMemoryId = outcome.memory.id
            const logMsg = `[Memory] REINFORCED INTER-CHARACTER memory: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
              `  Memory ID: ${outcome.memory.id}\n` +
              `  Count: ${outcome.memory.reinforcementCount ?? 1}\n` +
              `  Novel details: ${outcome.novelDetails?.join(', ') || 'none'}\n` +
              `  Summary: ${candidate.summary}`
            debugLogs.push(logMsg)
            break
          }
          case 'INSERT_RELATED': {
            memoryCreated = true
            memoryId = outcome.memory.id
            relatedMemoryIds = outcome.relatedMemoryIds
            const logMsg = `[Memory] Created INTER-CHARACTER memory (linked to ${outcome.relatedMemoryIds?.length || 0} related): ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
              `  Content: ${candidate.content}\n` +
              `  Summary: ${candidate.summary}\n` +
              `  Importance: ${candidate.importance}\n` +
              `  Keywords: ${candidate.keywords?.join(', ')}\n` +
              `  Related: ${outcome.relatedMemoryIds?.join(', ')}`
            debugLogs.push(logMsg)
            break
          }
          case 'INSERT':
          case 'SKIP_GATE':
          default: {
            memoryCreated = true
            memoryId = outcome.memory.id
            const logMsg = `[Memory] Created INTER-CHARACTER memory: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
              `  Content: ${candidate.content}\n` +
              `  Summary: ${candidate.summary}\n` +
              `  Importance: ${candidate.importance}\n` +
              `  Keywords: ${candidate.keywords?.join(', ')}`
            debugLogs.push(logMsg)
            break
          }
        }
      } else {
        const logMsg = `[Memory] INTER-CHARACTER memory not significant enough: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
          `  Summary: ${candidate?.summary || 'N/A'}\n` +
          `  Importance: ${candidate?.importance || 'N/A'}`
        debugLogs.push(logMsg)
      }
    } else {
      const logMsg = `[Memory] INTER-CHARACTER memory extraction failed: ${ctx.observerCharacterName} about ${ctx.subjectCharacterName}:\n` +
        `  Error: ${memoryResult.error}`
      debugLogs.push(logMsg)
    }

    return {
      success: true,
      memoryCreated,
      memoryReinforced,
      memoryId,
      reinforcedMemoryId,
      relatedMemoryIds: relatedMemoryIds && relatedMemoryIds.length > 0 ? relatedMemoryIds : undefined,
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
          '[Memory] Created inter-character memory',
          {
            memoryId: result.memoryId,
            observerCharacterId: ctx.observerCharacterId,
            subjectCharacterId: ctx.subjectCharacterId,
            userId: ctx.userId,
          }
        )
      } else if (result.memoryReinforced) {
        logger.info(
          '[Memory] Reinforced inter-character memory',
          {
            reinforcedMemoryId: result.reinforcedMemoryId,
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
