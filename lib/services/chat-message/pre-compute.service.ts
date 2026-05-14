/**
 * Pre-Compute Service
 *
 * Runs the two pre-context-build tasks the orchestrator needs in parallel:
 *
 *   1. Compression cache check — see if the cheap LLM already produced a
 *      compressed history for this chat at the current message count.
 *   2. Proactive memory recall — extract keywords from messages since the
 *      character last spoke, then semantic-search this character's memories.
 *
 * Both feed into `buildMessageContext`. The service also sets up a 15-second
 * keep-alive ping interval so proxies/load balancers don't drop the SSE
 * connection during long compression. The interval is only armed when
 * compression is enabled AND the cache miss path is taken; the caller is
 * handed a `stopKeepAlive` callback to release it after `buildMessageContext`
 * returns (and after any error path).
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  encodeKeepAlive,
  encodeStatusEvent,
  safeEnqueue,
} from './streaming.service'
import {
  getCachedCompression,
  invalidateCompressionCache,
  type CachedCompressionResponse,
} from './compression-cache.service'
import { extractMemorySearchKeywords, extractVisibleConversation, stripToolArtifacts } from '@/lib/memory/cheap-llm-tasks'
import { searchMemoriesSemantic, type SemanticSearchResult } from '@/lib/memory/memory-service'
import { resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'

import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ChatMetadataBase, Character, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { ChatEvent } from '@/lib/schemas/chat.types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

const logger = createServiceLogger('PreContextPreCompute')

export interface RunPreContextPreComputeOptions {
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string }
  isMultiCharacter: boolean
  isContinueMode: boolean
  /** Verbatim user-message text for this turn (empty in continue mode). */
  content: string
  existingMessages: ChatEvent[]
  compressionEnabled: boolean
  bypassCompression: boolean
  cheapLLMSelection: CheapLLMSelection | null
  dangerSettings: DangerousContentSettings
  allProfiles: ConnectionProfile[]
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}

export interface PreContextPreComputeResult {
  cachedCompressionResponse: CachedCompressionResponse | undefined
  preSearchedMemories: SemanticSearchResult[] | undefined
  /** Caller MUST invoke after buildMessageContext returns (or on error)
   * to release the keep-alive interval. Idempotent. */
  stopKeepAlive: () => void
}

export async function runPreContextPreCompute(
  opts: RunPreContextPreComputeOptions
): Promise<PreContextPreComputeResult> {
  const [cachedCompressionResponse, preSearchedMemories] = await Promise.all([
    compressionTask(opts),
    proactiveRecallTask(opts),
  ])

  // Keep-alive pings during the upcoming buildMessageContext (especially long
  // when compression is regenerating). Only armed when compression is enabled
  // AND we missed the cache — there's nothing slow to ping over otherwise.
  let keepAliveInterval: ReturnType<typeof setInterval> | null = null
  if (opts.compressionEnabled && !cachedCompressionResponse) {
    keepAliveInterval = setInterval(() => {
      if (!safeEnqueue(opts.controller, encodeKeepAlive(opts.encoder))) {
        // Stream closed — stop pinging.
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval)
          keepAliveInterval = null
        }
      }
    }, 15000)
  }

  return {
    cachedCompressionResponse,
    preSearchedMemories,
    stopKeepAlive: () => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval)
        keepAliveInterval = null
      }
    },
  }
}

async function compressionTask(
  opts: RunPreContextPreComputeOptions
): Promise<CachedCompressionResponse | undefined> {
  const {
    chatId, character, characterParticipant, isMultiCharacter,
    existingMessages, compressionEnabled, bypassCompression,
    controller, encoder,
  } = opts

  if (compressionEnabled && !bypassCompression) {
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'compressing',
      message: 'Checking context cache...',
      characterName: character.name,
      characterId: character.id,
    }))

    // Count only visible USER/ASSISTANT messages — must match what
    // triggerAsyncCompression uses. A broader filter inflates the count
    // and causes the dynamic window to grow excessively.
    const visibleMessages = extractVisibleConversation(existingMessages)
    const actualMessageCount = visibleMessages.length
    const participantIdForCache = isMultiCharacter ? characterParticipant.id : undefined
    const result = await getCachedCompression(chatId, actualMessageCount, participantIdForCache)
    if (result) {
      logger.info('Using cached compression from async pre-computation', {
        chatId,
        messageCount: actualMessageCount,
        cachedMessageCount: result.cachedMessageCount,
        isFallback: result.isFallback,
        savings: result.result.compressionDetails?.totalSavings,
      })
    }
    return result
  } else if (bypassCompression) {
    invalidateCompressionCache(chatId)
  }
  return undefined
}

async function proactiveRecallTask(
  opts: RunPreContextPreComputeOptions
): Promise<SemanticSearchResult[] | undefined> {
  const {
    chatId, userId, chat, character, characterParticipant,
    isContinueMode, content, existingMessages,
    cheapLLMSelection, dangerSettings, allProfiles,
    controller, encoder,
  } = opts

  if (!cheapLLMSelection || !character.id) return undefined

  // Filter to actual message events with proper type narrowing.
  const messageEvents = existingMessages
    .filter((m): m is MessageEvent => m.type === 'message' && 'role' in m && 'content' in m)

  // Find messages since this character last spoke.
  const characterMessages = messageEvents.filter(
    m => m.role === 'ASSISTANT' && m.participantId === characterParticipant.id
  )

  if (characterMessages.length === 0) {
    return undefined
  }

  const lastCharacterMessage = characterMessages[characterMessages.length - 1]
  const lastCharacterMessageIndex = messageEvents.lastIndexOf(lastCharacterMessage)
  const messagesSinceLastSpoke = messageEvents
    .slice(lastCharacterMessageIndex + 1)
    .filter(m => m.role === 'USER' || m.role === 'ASSISTANT')

  // Include the new user message that was just saved but isn't in the
  // existingMessages snapshot.
  if (!isContinueMode && content) {
    messagesSinceLastSpoke.push({
      role: 'USER',
      content,
    } as MessageEvent)
  }

  if (messagesSinceLastSpoke.length === 0) {
    return undefined
  }

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'recalling_keywords',
    message: 'Analyzing recent conversation...',
    characterName: character.name,
    characterId: character.id,
  }))

  // For dangerous chats, use uncensored provider for keyword extraction.
  let recallSelection = cheapLLMSelection
  if (chat.isDangerousChat) {
    recallSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection,
      true,
      dangerSettings,
      allProfiles
    )
  }

  // Extract keywords via cheap LLM, stripping tool artifacts from assistant
  // messages so the keyword extractor sees only narrative content.
  const keywordResult = await extractMemorySearchKeywords(
    messagesSinceLastSpoke.reduce<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>>((acc, m) => {
      const role = m.role.toLowerCase() as 'user' | 'assistant' | 'system'
      if (role === 'assistant') {
        const cleaned = stripToolArtifacts(m.content || '')
        if (cleaned) acc.push({ role, content: cleaned })
      } else {
        acc.push({ role, content: m.content || '' })
      }
      return acc
    }, []),
    character.name,
    recallSelection,
    userId,
    chatId,
    character.id
  )

  if (!keywordResult.success || !keywordResult.result || keywordResult.result.length === 0) {
    return undefined
  }

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'recalling_memories',
    message: `Searching ${character.name}'s memories...`,
    characterName: character.name,
    characterId: character.id,
  }))

  const searchQuery = keywordResult.result.join(' ')
  try {
    const memoryResults = await searchMemoriesSemantic(
      character.id,
      searchQuery,
      {
        userId,
        limit: 20,
        minImportance: 0.3,
      }
    )

    if (memoryResults.length > 0) {
      return memoryResults.slice(0, 10)
    }
  } catch (error) {
    logger.warn('Proactive memory recall: memory search failed, falling back to default', {
      chatId,
      characterId: character.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return undefined
}
