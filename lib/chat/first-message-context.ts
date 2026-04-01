/**
 * First Message Context Builder
 *
 * Builds enhanced context for auto-generated first messages,
 * including participant memories and project context.
 */

import { getRepositories, type RepositoryContainer } from '@/lib/repositories/factory'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { logger } from '@/lib/logger'
import type { ChatParticipantBaseInput } from '@/lib/schemas/chat.types'

// ============================================================================
// Types
// ============================================================================

export interface ParticipantInfo {
  characterId: string
  name: string
  description?: string | null
  controlledBy: 'llm' | 'user'
}

export interface ParticipantMemory {
  aboutCharacterId: string
  aboutCharacterName: string
  summary: string
  importance: number
}

export interface ProjectContext {
  name: string
  description?: string | null
  instructions?: string | null
}

export interface FirstMessageContextResult {
  projectContext: ProjectContext | null
  participantMemories: ParticipantMemory[]
}

// ============================================================================
// Memory Retrieval
// ============================================================================

/**
 * Load memories the speaking character has about other participants.
 * Uses "Recent + Participant-based" strategy:
 * 1. Get recent memories about each participant
 * 2. Search semantically using participant name as query
 * 3. Combine, deduplicate, and return top memories per participant
 */
export async function loadParticipantMemories(
  speakingCharacterId: string,
  otherParticipants: ParticipantInfo[],
  options: {
    userId: string
    embeddingProfileId?: string
    memoriesPerParticipant?: number
  }
): Promise<ParticipantMemory[]> {
  const repos = getRepositories()
  const memoriesPerParticipant = options.memoriesPerParticipant ?? 5

  logger.debug('[FirstMessageContext] Loading participant memories', {
    speakingCharacterId,
    participantCount: otherParticipants.length,
    memoriesPerParticipant,
  })

  if (otherParticipants.length === 0) {
    logger.debug('[FirstMessageContext] No other participants to load memories for')
    return []
  }

  const allMemories: ParticipantMemory[] = []

  for (const participant of otherParticipants) {
    try {
      const participantMemories = await loadMemoriesForParticipant(
        speakingCharacterId,
        participant,
        repos,
        options.userId,
        options.embeddingProfileId,
        memoriesPerParticipant
      )
      allMemories.push(...participantMemories)
    } catch (error) {
      logger.error('[FirstMessageContext] Failed to load memories for participant', {
        speakingCharacterId,
        participantId: participant.characterId,
        participantName: participant.name,
        error: error instanceof Error ? error.message : String(error),
      })
      // Continue with other participants
    }
  }

  logger.debug('[FirstMessageContext] Loaded participant memories', {
    speakingCharacterId,
    totalMemories: allMemories.length,
  })

  return allMemories
}

/**
 * Load memories for a single participant using Recent + Semantic search strategy
 */
async function loadMemoriesForParticipant(
  speakingCharacterId: string,
  participant: ParticipantInfo,
  repos: RepositoryContainer,
  userId: string,
  embeddingProfileId: string | undefined,
  limit: number
): Promise<ParticipantMemory[]> {
  const memoryMap = new Map<string, ParticipantMemory>()

  // 1. Get recent memories specifically about this participant (sorted by importance, then recency)
  const recentMemories = await repos.memories.findByCharacterAboutCharacter(
    speakingCharacterId,
    participant.characterId
  )

  // Take up to 3 from recent inter-character memories
  const recentCount = Math.min(3, recentMemories.length)
  for (let i = 0; i < recentCount; i++) {
    const memory = recentMemories[i]
    if (!memoryMap.has(memory.id)) {
      memoryMap.set(memory.id, {
        aboutCharacterId: participant.characterId,
        aboutCharacterName: participant.name,
        summary: memory.summary,
        importance: memory.importance,
      })
    }
  }

  // 2. Search semantically using participant name (and description if available)
  // This finds memories that mention the participant even if aboutCharacterId isn't set
  const searchQuery = participant.description
    ? `${participant.name} - ${participant.description}`
    : participant.name

  let semanticSearchWorked = false

  try {
    const semanticResults = await searchMemoriesSemantic(
      speakingCharacterId,
      searchQuery,
      {
        userId,
        embeddingProfileId,
        limit: 8, // Get more results to filter down
        minScore: 0.4, // Slightly higher threshold for general memories
      }
    )

    // Add semantic results - include memories about this participant OR general memories
    // (aboutCharacterId is null for older memories that predate inter-character tracking)
    for (const result of semanticResults) {
      const isAboutParticipant = result.memory.aboutCharacterId === participant.characterId
      const isGeneralMemory = result.memory.aboutCharacterId === null || result.memory.aboutCharacterId === undefined

      if ((isAboutParticipant || isGeneralMemory) && !memoryMap.has(result.memory.id)) {
        memoryMap.set(result.memory.id, {
          aboutCharacterId: participant.characterId,
          aboutCharacterName: participant.name,
          summary: result.memory.summary,
          importance: result.memory.importance,
        })
      }
    }

    semanticSearchWorked = semanticResults.length > 0

    logger.debug('[FirstMessageContext] Semantic search results for participant', {
      participantName: participant.name,
      resultsCount: semanticResults.length,
      addedToMap: memoryMap.size - recentCount,
    })
  } catch (error) {
    logger.warn('[FirstMessageContext] Semantic search failed for participant', {
      participantName: participant.name,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // 3. If we don't have enough memories yet, try text-based search using just the name
  // This helps find older memories that mention the character by name
  if (memoryMap.size < limit && !semanticSearchWorked) {
    try {
      // Search using just the character name for a broader match
      const textSearchResults = await repos.memories.searchByContent(
        speakingCharacterId,
        participant.name
      )

      // Add text search results (general memories that mention this character)
      for (const memory of textSearchResults) {
        if (!memoryMap.has(memory.id)) {
          memoryMap.set(memory.id, {
            aboutCharacterId: participant.characterId,
            aboutCharacterName: participant.name,
            summary: memory.summary,
            importance: memory.importance,
          })
        }
        // Stop if we have enough
        if (memoryMap.size >= limit) break
      }

      logger.debug('[FirstMessageContext] Text search fallback for participant', {
        participantName: participant.name,
        textResultsCount: textSearchResults.length,
        totalMemories: memoryMap.size,
      })
    } catch (error) {
      logger.warn('[FirstMessageContext] Text search fallback failed', {
        participantName: participant.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // 4. Sort by importance and take top N
  const memories = Array.from(memoryMap.values())
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit)

  logger.debug('[FirstMessageContext] Loaded memories for participant', {
    participantName: participant.name,
    fromRecent: recentCount,
    total: memories.length,
  })

  return memories
}

// ============================================================================
// Project Context
// ============================================================================

/**
 * Load project context for system prompt injection
 */
export async function loadProjectContext(
  projectId: string,
  repos: RepositoryContainer
): Promise<ProjectContext | null> {
  logger.debug('[FirstMessageContext] Loading project context', { projectId })

  try {
    const project = await repos.projects.findById(projectId)

    if (!project) {
      logger.warn('[FirstMessageContext] Project not found', { projectId })
      return null
    }

    logger.debug('[FirstMessageContext] Loaded project context', {
      projectId,
      projectName: project.name,
      hasDescription: !!project.description,
      hasInstructions: !!project.instructions,
    })

    return {
      name: project.name,
      description: project.description,
      instructions: project.instructions,
    }
  } catch (error) {
    logger.error('[FirstMessageContext] Failed to load project', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Build complete first message context including project context and participant memories.
 * This is used when auto-generating the first message for a new chat.
 */
export async function buildFirstMessageContext(
  speakingCharacterId: string,
  participants: ChatParticipantBaseInput[],
  options: {
    userId: string
    projectId?: string | null
    embeddingProfileId?: string
  }
): Promise<FirstMessageContextResult> {
  logger.debug('[FirstMessageContext] Building first message context', {
    speakingCharacterId,
    participantCount: participants.length,
    hasProjectId: !!options.projectId,
    hasEmbeddingProfile: !!options.embeddingProfileId,
  })

  const repos = getRepositories()

  // Build participant info list (excluding the speaking character)
  const otherParticipants: ParticipantInfo[] = []

  for (const participant of participants) {
    if (
      participant.type === 'CHARACTER' &&
      participant.characterId &&
      participant.characterId !== speakingCharacterId
    ) {
      // Load character to get name and description
      const character = await repos.characters.findById(participant.characterId)
      if (character) {
        otherParticipants.push({
          characterId: participant.characterId,
          name: character.name,
          description: character.description,
          controlledBy: participant.controlledBy || 'llm',
        })
      }
    }
  }

  // Load project context if applicable
  let projectContext: ProjectContext | null = null
  if (options.projectId) {
    projectContext = await loadProjectContext(options.projectId, repos)
  }

  // Load participant memories
  const participantMemories = await loadParticipantMemories(
    speakingCharacterId,
    otherParticipants,
    {
      userId: options.userId,
      embeddingProfileId: options.embeddingProfileId,
      memoriesPerParticipant: 5,
    }
  )

  logger.debug('[FirstMessageContext] Built first message context', {
    speakingCharacterId,
    hasProjectContext: !!projectContext,
    memoryCount: participantMemories.length,
  })

  return {
    projectContext,
    participantMemories,
  }
}
