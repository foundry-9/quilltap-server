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
import { buildRecallQuery } from '@/lib/memory/recall/query'
import { searchRecall } from '@/lib/memory/recall/search'
import { buildTurnRecallContext } from '@/lib/memory/recall/tags'
import { PROACTIVE_RECALL_POOL_SIZE, type PreRecall } from '@/lib/memory/recall/assemble'
import type { RecallTrace } from '@/lib/memory/recall/types'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'

import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { ChatMetadataBase, Character, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { ChatEvent } from '@/lib/schemas/chat.types'
import type { ResolvedConciergePolicy } from '@/lib/services/dangerous-content/resolver.service'
import { RECALL_MIN_IMPORTANCE } from '@/lib/memory/scoring';

export { PROACTIVE_RECALL_POOL_SIZE }

const logger = createServiceLogger('PreContextPreCompute')

export interface RunPreContextPreComputeOptions {
  chatId: string
  userId: string
  chat: ChatMetadataBase
  character: Character
  characterParticipant: { id: string }
  isMultiCharacter: boolean
  /**
   * IDs of the characters present in the room this turn (responding character +
   * other character participants). Threaded into the recall context so the
   * proactive path applies the same participant-aware boost (item 4) the dynamic
   * head does. Empty/undefined → no participant boost.
   */
  presentAboutCharacterIds?: readonly string[]
  /**
   * Display names of those same characters — R4's entity anchors skip a name
   * that merely names someone in the room.
   */
  presentParticipantNames?: readonly string[]
  isContinueMode: boolean
  /** Verbatim user-message text for this turn (empty in continue mode). */
  content: string
  existingMessages: ChatEvent[]
  compressionEnabled: boolean
  bypassCompression: boolean
  cheapLLMSelection: CheapLLMSelection | null
  conciergePolicy: ResolvedConciergePolicy
  allProfiles: ConnectionProfile[]
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}

export interface PreContextPreComputeResult {
  cachedCompressionResponse: CachedCompressionResponse | undefined
  /**
   * The proactive recall: the query it distilled and embedded (once) and what
   * that query found. Threaded into buildContext, whose recall reuses both —
   * the head, the inter-character pool and the conversation lists all ride
   * this one embedding. Undefined when the proactive path didn't run.
   */
  preRecall: PreRecall | undefined
  /** Caller MUST invoke after buildMessageContext returns (or on error)
   * to release the keep-alive interval. Idempotent. */
  stopKeepAlive: () => void
}

export async function runPreContextPreCompute(
  opts: RunPreContextPreComputeOptions
): Promise<PreContextPreComputeResult> {
  const [cachedCompressionResponse, recallOutcome] = await Promise.all([
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
    preRecall: recallOutcome,
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
): Promise<PreRecall | undefined> {
  const {
    chatId, userId, chat, character, characterParticipant,
    presentAboutCharacterIds, presentParticipantNames, isContinueMode, content, existingMessages,
    cheapLLMSelection, conciergePolicy, allProfiles,
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
  // Gate on the canonical accessor so an Off-duty chat never reroutes here,
  // independent of how `conciergePolicy` was resolved upstream.
  let recallSelection = cheapLLMSelection
  if (shouldUseUncensoredRoute(chat)) {
    recallSelection = resolveUncensoredCheapLLMSelection(
      cheapLLMSelection,
      true,
      conciergePolicy,
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
    character.id,
    // Episodic recall: the distillation resolves "last week" into an absolute
    // timeRange against this clock.
    {
      nowIso: new Date().toISOString(),
      timelineMode: chat.timelineMode ?? 'realtime',
    }
  )

  if (!keywordResult.success || !keywordResult.result || keywordResult.result.keywords.length === 0) {
    return undefined
  }
  const signals = keywordResult.result

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'recalling_memories',
    message: `Searching ${character.name}'s memories...`,
    characterName: character.name,
    characterId: character.id,
  }))

  // The turn's one query: the paraphrase (else the keyword join), embedded
  // once here and reused by every recall pool in buildContext.
  const trace: RecallTrace = []
  const query = await buildRecallQuery({
    userId,
    text: signals.keywords.join(' '),
    signals,
  }, trace)

  // The same per-turn recall context the fallback head builds (see
  // lib/memory/recall/tags.ts): scope gating, temporal weighting, context
  // steering, participant boost, anti-repetition and the fresh-event boost.
  const recallSettings = await getMemoryRecallSettings()
  const recallContext = buildTurnRecallContext({
    chat,
    recallSettings,
    turnContext: signals.context ?? null,
    turnTemporal: signals.temporal ?? null,
    turnRetrospective: query.retrospective,
    presentAboutCharacterIds,
    presentParticipantNames,
    nowMs: Date.now(),
  })

  try {
    const result = await searchRecall(character.id, query, {
      // The context builder drops every candidate already in the frozen
      // archive, then fills the head from what is left — and does not search
      // again. Pull enough that a full archive overlap still leaves the
      // largest head it can ask for (a retrospective turn: 2 × max).
      limit: PROACTIVE_RECALL_POOL_SIZE,
      minImportance: RECALL_MIN_IMPORTANCE,
      recallContext,
    }, trace, 'head')
    return { query, candidates: result.candidates, ranked: result.ranked, trace }
  } catch (error) {
    logger.warn('Proactive memory recall: memory search failed; the turn recalls with the query alone', {
      chatId,
      characterId: character.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return { query, candidates: [], trace }
  }
}
