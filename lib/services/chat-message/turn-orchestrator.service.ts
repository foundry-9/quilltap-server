import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  selectNextSpeaker,
  calculateTurnStateFromHistory,
  getActiveCharacterParticipants,
  isAllLLMChat,
  shouldPauseForAllLLM,
} from '@/lib/chat/turn-manager'
import type { Character, MessageEvent } from '@/lib/schemas/types'
import type { getRepositories } from '@/lib/repositories/factory'

export interface ChainConfig {
  maxChainDepth: number      // default 20
  maxChainTimeMs: number     // default 300000 (5 minutes)
  maxRetries: number         // default 2
  retryDelayMs: number[]     // [1000, 3000]
}

export const DEFAULT_CHAIN_CONFIG: ChainConfig = {
  maxChainDepth: 20,
  maxChainTimeMs: 300000,
  maxRetries: 2,
  retryDelayMs: [1000, 3000],
}

export interface ChainDecision {
  chain: boolean
  participantId?: string
  characterName?: string
  reason: 'user_turn' | 'paused' | 'max_depth' | 'max_time' | 'error' | 'no_next_speaker' | 'cycle_complete' | 'continue'
}

const logger = createServiceLogger('TurnOrchestrator')

export async function shouldChainNext(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userParticipantId: string | null,
  chainDepth: number,
  chainStartTime: number,
  config: ChainConfig = DEFAULT_CHAIN_CONFIG
): Promise<ChainDecision> {
  // Re-read chat for fresh state (isPaused may have been set by stop button)
  const freshChat = await repos.chats.findById(chatId)
  if (!freshChat) {
    logger.warn('[TurnOrchestrator] Chat not found during chain', { chatId })
    return { chain: false, reason: 'error' }
  }

  // Check pause
  if (freshChat.isPaused) {
    logger.info('[TurnOrchestrator] Chat paused, stopping chain', { chatId, chainDepth })
    return { chain: false, reason: 'paused' }
  }

  // Check max depth
  if (chainDepth >= config.maxChainDepth) {
    logger.info('[TurnOrchestrator] Max chain depth reached', { chatId, chainDepth, maxChainDepth: config.maxChainDepth })
    return { chain: false, reason: 'max_depth' }
  }

  // Check max time
  const elapsed = Date.now() - chainStartTime
  if (elapsed >= config.maxChainTimeMs) {
    logger.info('[TurnOrchestrator] Max chain time reached', { chatId, chainDepth, elapsedMs: elapsed })
    return { chain: false, reason: 'max_time' }
  }

  // Get messages and compute turn state
  const messages = await repos.chats.getMessages(chatId)
  const messageEvents = messages.filter(
    (m): m is typeof m & { type: 'message' } => m.type === 'message'
  ) as unknown as MessageEvent[]

  const turnState = calculateTurnStateFromHistory({
    messages: messageEvents,
    participants: freshChat.participants,
    userParticipantId,
  })

  // Check all-LLM pause thresholds
  // A chat is only truly all-LLM if there's no user-controlled participant AND
  // no USER messages in history (a user typing messages means a human is present)
  const isAllLLM = isAllLLMChat(freshChat.participants)
  const hasUserPresence = userParticipantId !== null
    || messageEvents.some(m => m.role === 'USER')
  const effectiveAllLLM = isAllLLM && !hasUserPresence
  if (effectiveAllLLM) {
    // Count assistant messages since last user message
    let turnCount = 0
    for (let i = messageEvents.length - 1; i >= 0; i--) {
      if (messageEvents[i].role === 'USER') break
      if (messageEvents[i].role === 'ASSISTANT') turnCount++
    }

    if (shouldPauseForAllLLM(turnCount) && turnCount > 0) {
      logger.info('[TurnOrchestrator] All-LLM pause threshold reached', { chatId, turnCount, chainDepth })
      // Pause the chat
      await repos.chats.update(chatId, { isPaused: true })
      return { chain: false, reason: 'paused' }
    }
  }

  // Check turn queue (persisted in DB)
  let turnQueue: string[] = []
  try {
    turnQueue = JSON.parse(freshChat.turnQueue || '[]')
  } catch {
    turnQueue = []
  }

  let nextParticipantId: string | null = null
  let selectionReason: string = ''

  if (turnQueue.length > 0) {
    // Pop from the front of the queue, but skip any entry that matches
    // the participant who just spoke — otherwise a nudge (which both queues
    // the participant AND triggers an immediate response) would cause a
    // duplicate response from the chain loop.
    while (turnQueue.length > 0) {
      const candidate = turnQueue[0]
      turnQueue = turnQueue.slice(1)
      if (candidate !== turnState.lastSpeakerId) {
        nextParticipantId = candidate
        selectionReason = 'queue'
        break
      }
      logger.debug('[TurnOrchestrator] Skipping queued participant who just spoke', {
        chatId, skippedParticipantId: candidate,
      })
    }
    // Persist updated queue (even if we skipped entries)
    await repos.chats.update(chatId, { turnQueue: JSON.stringify(turnQueue) })
  }

  if (!nextParticipantId && selectionReason !== 'queue') {
    // Use turn selection algorithm
    const activeCharacterParticipants = getActiveCharacterParticipants(freshChat.participants)
    const charactersMap = new Map<string, Character>()

    for (const p of activeCharacterParticipants) {
      if (p.characterId) {
        const char = await repos.characters.findById(p.characterId)
        if (char) {
          charactersMap.set(p.characterId, char)
        }
      }
    }

    const result = selectNextSpeaker(
      freshChat.participants,
      charactersMap,
      turnState,
      userParticipantId
    )

    nextParticipantId = result.nextSpeakerId
    selectionReason = result.reason
  }

  // No next speaker
  if (!nextParticipantId) {
    const mappedReason = selectionReason === 'cycle_complete' ? 'cycle_complete' as const
      : selectionReason === 'user_turn' ? 'user_turn' as const
      : 'no_next_speaker' as const
    return { chain: false, reason: mappedReason }
  }

  // Check if next speaker is user-controlled
  const nextParticipant = freshChat.participants.find(p => p.id === nextParticipantId)
  if (!nextParticipant) {
    logger.warn('[TurnOrchestrator] Next participant not found', { chatId, nextParticipantId })
    return { chain: false, reason: 'error' }
  }

  if (nextParticipant.controlledBy === 'user') {
    return { chain: false, reason: 'user_turn' }
  }

  // Find character name for logging/events
  let characterName = 'Unknown'
  if (nextParticipant.characterId) {
    const char = await repos.characters.findById(nextParticipant.characterId)
    if (char) characterName = char.name
  }

  logger.info('[TurnOrchestrator] Chain decision: continue', {
    chatId,
    chainDepth,
    nextParticipantId,
    characterName,
    selectionReason,
  })

  return {
    chain: true,
    participantId: nextParticipantId,
    characterName,
    reason: 'continue',
  }
}

/**
 * Persist the last turn participant ID for turn state restoration on page reload
 */
export async function persistTurnParticipantId(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  participantId: string | null
): Promise<void> {
  try {
    await repos.chats.update(chatId, { lastTurnParticipantId: participantId })
  } catch (error) {
    logger.warn('[TurnOrchestrator] Failed to persist turn participant ID', {
      chatId,
      participantId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
