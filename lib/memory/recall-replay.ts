/**
 * Recall replay harness (episodic recall overhaul, §3 — built as step 0 of
 * the retrieval workstream so the new multipliers/boosts can be tuned against
 * real chats instead of blind).
 *
 * Given a chat (and optionally a turn index), reconstruct the per-turn recall
 * distillation (retrospective / timeRange / entities / paraphrase) and run the
 * memory search TWICE — once with the episodic signals inert (the pre-overhaul
 * path) and once with them live — returning the full candidate table for each:
 * cosine, rawWeight, blendedBefore, every multiplier that fired,
 * blendedAfter, and whether the entry made the head. Nothing is persisted;
 * the recall-history ring buffer is read but never written.
 *
 * Three harness knobs (R7 of the recall multiplier retuning) make runs
 * comparable: `tuning` applies retuning constants to the new path only;
 * `signals` reuses a saved distillation instead of calling the cheap LLM again
 * (the distillation is not deterministic, so two runs of one turn otherwise
 * embed different queries); `asOf` drops memories created after the replayed
 * turn's opening message, so an old turn is searched against the corpus as it
 * stood then.
 *
 * Consumed by POST /api/v1/chats/[id]?action=recall-replay, which the
 * `quilltap recall-replay` CLI wraps.
 *
 * @module memory/recall-replay
 */

import { getRepositories } from '@/lib/repositories/factory'
import { extractMemorySearchKeywords, stripToolArtifacts, type MemorySearchExtraction } from './cheap-llm-tasks'
import { searchMemoriesSemantic, type SemanticSearchResult } from './memory-service'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { partitionMessagesIntoTurns } from '@/lib/chat/context-summary'
import { DYNAMIC_HEAD_DEFAULT_SIZE, RETRO_HEAD_SIZE, sizeMemoryPools } from '@/lib/chat/context/memory-injector'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { buildRetrospectiveProbes, buildTurnRecallContext } from './recall-tags'
import { describeRecallTuning, resolveRecallTuning, type RecallTuningInput } from './recall-tuning'
import type { MessageEvent } from '@/lib/schemas/types'
import type { EmbeddingResult } from '@/lib/embedding/embedding-service'
import { createServiceLogger } from '@/lib/logging/create-logger'

const logger = createServiceLogger('RecallReplay')

/**
 * Embeddings the replay has already paid for, by text, for the life of the
 * server process. The provider's vector for one text drifts slightly from call
 * to call (≈1e-3 in cosine was enough to swap a gold memory out of a probe-set
 * head), so a sweep that compares tunings must embed each text once. Bounded:
 * the oldest entries go first. Keyed by text and explicit profile only, so it
 * empties on a server restart — restart after switching the embedding profile.
 */
const REPLAY_EMBEDDING_MEMO_MAX = 500
const replayEmbeddingMemo = new Map<string, EmbeddingResult>()

function boundedMemo(): Map<string, EmbeddingResult> {
  while (replayEmbeddingMemo.size > REPLAY_EMBEDDING_MEMO_MAX) {
    const oldest = replayEmbeddingMemo.keys().next().value
    if (oldest === undefined) break
    replayEmbeddingMemo.delete(oldest)
  }
  return replayEmbeddingMemo
}


/** One candidate row of the replay table. */
export interface RecallReplayRow {
  memoryId: string
  summary: string
  kind: string
  occurredAt: string | null
  narrativeTime: string | null
  createdAt: string
  keywords: string[]
  cosine: number
  rawWeight: number | null
  blendedBefore: number | null
  multiplier: number | null
  fired: string[]
  blendedAfter: number | null
  /** True when the row would make the dynamic head at this path's head size. */
  selected: boolean
}

export interface RecallReplayResult {
  chatId: string
  characterId: string
  characterName: string
  turnIndex: number
  totalTurns: number
  /** The distilled turn signals driving the new path. */
  signals: MemorySearchExtraction | null
  /** The query both paths embedded. */
  query: string
  /** Clock the distillation resolved against (the replayed turn's timestamp). */
  clockIso: string
  /** Pre-overhaul path: episodic signals inert. */
  oldPath: RecallReplayRow[]
  /** Overhaul path: retrospective flip, window, entity anchors, multi-probe. */
  newPath: RecallReplayRow[]
  /** Head size the old path's `selected` flags were cut at. */
  oldHeadSize: number
  /** Head size the new path's `selected` flags were cut at. */
  newHeadSize: number
  /** The new path's tuning, summarised (`'defaults'` when none was given). */
  tuning: string
  /** True when `signals` came from the request instead of a fresh distillation. */
  signalsPinned: boolean
  /** The corpus cutoff when `asOf` was set: memories created at or after it were left out. */
  asOf: string | null
  /** How many memories the `asOf` cutoff left out. */
  excludedAfterAsOf: number
}

export interface RunRecallReplayInput {
  chatId: string
  userId: string
  cheapLLM: CheapLLMSelection
  /** 1-based interchange index to replay AT (context = messages through that turn). Defaults to the last turn. */
  turnIndex?: number
  /** Character whose memories are searched. Defaults to the first present LLM character. */
  characterId?: string
  /** Candidate table size per path. */
  limit?: number
  /**
   * The responding model's memory budget in tokens. When given, the new path's
   * `selected` rows follow the budget-sized head (`sizeMemoryPools`) — the old
   * path keeps the historical fixed head — so the replay shows what the larger
   * head adds. Absent → both paths use the fixed historical sizes.
   */
  memoryBudget?: number
  /** Retuning constants for the NEW path only (R7). Absent → today's constants. */
  tuning?: RecallTuningInput
  /** A saved distillation to reuse instead of calling the cheap LLM. */
  signals?: MemorySearchExtraction
  /** Search only memories created before the replayed turn's opening message. */
  asOf?: boolean
}

function toRows(results: SemanticSearchResult[], headSize: number): RecallReplayRow[] {
  return results.map((r, index) => ({
    memoryId: r.memory.id,
    summary: r.memory.summary,
    kind: r.memory.kind ?? 'semantic',
    occurredAt: r.memory.occurredAt ?? null,
    narrativeTime: r.memory.narrativeTime ?? null,
    createdAt: r.memory.createdAt,
    keywords: r.memory.keywords ?? [],
    cosine: r.score,
    rawWeight: r.rawWeight ?? null,
    blendedBefore: r.recallAdjustment?.blendedBefore ?? null,
    multiplier: r.recallAdjustment?.multiplier ?? null,
    fired: r.recallAdjustment?.fired ?? [],
    blendedAfter: r.recallAdjustment?.blendedAfter ?? null,
    selected: index < headSize,
  }))
}

/**
 * Run the replay. Read-only against the chat and memory corpus — search does
 * not stamp `lastAccessedAt`; only consumers that deliver memories do.
 */
export async function runRecallReplay(input: RunRecallReplayInput): Promise<RecallReplayResult> {
  const repos = getRepositories()

  const chat = await repos.chats.findById(input.chatId)
  if (!chat) {
    throw new Error('Chat not found')
  }

  // Resolve the responding character.
  const participant = input.characterId
    ? chat.participants.find(p => p.characterId === input.characterId)
    : chat.participants.find(p => p.controlledBy !== 'user' && p.status !== 'removed' && p.characterId)
  if (!participant) {
    throw new Error('No LLM-controlled character participant found on this chat')
  }
  const character = await repos.characters.findByIdRaw(participant.characterId)
  if (!character) {
    throw new Error('Character record not found')
  }

  // Slice history through the requested turn.
  const allMessages = await repos.chats.getMessages(input.chatId)
  const turns = partitionMessagesIntoTurns(allMessages, chat.chatType)
  if (turns.length === 0) {
    throw new Error('Chat has no turns to replay')
  }
  const turnIndex = Math.min(Math.max(input.turnIndex ?? turns.length, 1), turns.length)
  const lastTurnMessageId = turns[turnIndex - 1].ids[turns[turnIndex - 1].ids.length - 1]
  const cutoff = allMessages.findIndex(m => m.id === lastTurnMessageId)
  const window = (cutoff >= 0 ? allMessages.slice(0, cutoff + 1) : allMessages)
    .filter((m): m is MessageEvent => m.type === 'message')
    .filter(m => !m.systemSender && (m.role === 'USER' || m.role === 'ASSISTANT'))

  // Historical clock: the replayed turn resolves "last week" against ITS OWN
  // date, not today's — that is the whole point of replaying old turns.
  const clockIso =
    [...window].reverse().find(m => m.createdAt)?.createdAt ?? new Date().toISOString()

  // Distill the turn signals (same call, same inputs the live path uses).
  const recentForDistill = window.slice(-12).map(m => ({
    role: m.role.toLowerCase() as 'user' | 'assistant',
    content: (m.role === 'ASSISTANT' ? stripToolArtifacts(m.content || '') : m.content) || '',
  })).filter(m => m.content.length > 0)

  let signals: MemorySearchExtraction | null
  if (input.signals) {
    signals = input.signals
    logger.debug('Recall replay using pinned signals', { chatId: input.chatId, turnIndex })
  } else {
    const distill = await extractMemorySearchKeywords(
      recentForDistill,
      character.name,
      input.cheapLLM,
      input.userId,
      input.chatId,
      character.id,
      { nowIso: clockIso, timelineMode: chat.timelineMode ?? 'realtime' },
    )
    signals = distill.success ? distill.result ?? null : null
  }

  const query =
    signals?.paraphrase ||
    (signals?.keywords?.length ? signals.keywords.join(' ') : '') ||
    window[window.length - 1]?.content ||
    ''
  if (!query.trim()) {
    throw new Error('Could not derive a recall query for this turn')
  }

  const recallSettings = await getMemoryRecallSettings()
  const presentParticipants = chat.participants.filter(p => p.status !== 'removed' && p.characterId)
  const presentAboutCharacterIds = presentParticipants.map(p => p.characterId)

  const embeddingMemo = boundedMemo()
  const tuning = resolveRecallTuning(input.tuning)
  const tuningSummary = describeRecallTuning(tuning)
  // R4 drops entities that only name someone in the room; it needs their names.
  const presentParticipantNames = tuning.specificAnchors
    ? (await Promise.all(presentParticipants.map(p => repos.characters.findByIdRaw(p.characterId))))
        .flatMap(c => (c?.name ? [c.name] : []))
    : undefined

  // asOf — the corpus as it stood when the turn opened: leave out every memory
  // created at or after the turn's opening (user) message, and decay weights
  // against the turn's clock rather than today's. (Reinforcement a memory
  // received after the turn can't be undone; its importance is read as it is now.)
  const replayedTurn = turns[turnIndex - 1]
  const openingMessage = replayedTurn.messages.find(m => m.role === 'USER') ?? replayedTurn.messages[0]
  const asOfIso = input.asOf ? openingMessage?.createdAt ?? null : null
  const weightClockMs = asOfIso ? Date.parse(clockIso) : undefined
  let excludeMemoryIds: Set<string> | undefined
  if (asOfIso) {
    const newer = await repos.memories.countCreatedSince(character.id, asOfIso)
    const recent = newer > 0 ? await repos.memories.findRecent(character.id, newer) : []
    excludeMemoryIds = new Set(recent.filter(m => m.createdAt >= asOfIso).map(m => m.id))
    logger.debug('Recall replay corpus cutoff', { chatId: input.chatId, asOfIso, excluded: excludeMemoryIds.size })
  }

  const retrospective = signals?.retrospective === true
  const newHeadSize =
    typeof input.memoryBudget === 'number' && input.memoryBudget > 0
      ? sizeMemoryPools(input.memoryBudget, retrospective).headEntries
      : retrospective ? RETRO_HEAD_SIZE : DYNAMIC_HEAD_DEFAULT_SIZE
  // Wide enough to show where the larger head ends.
  const limit = input.limit ?? Math.max(25, newHeadSize + 10)

  // Same assembly as the two live consumers (see lib/memory/recall-tags.ts).
  // The OLD path leaves the retrospective flag off entirely so its episodic
  // signals stay inert.
  const baseCtx = buildTurnRecallContext({
    chat,
    recallSettings,
    turnContext: signals?.context ?? null,
    turnTemporal: signals?.temporal ?? null,
    presentAboutCharacterIds,
    // Fresh-event boost against the REPLAYED TURN's clock, not wall-clock now —
    // replaying an old turn must reproduce what recall would have done then.
    nowMs: Date.parse(clockIso),
  })

  // OLD path — episodic signals inert (byte-identical to pre-overhaul recall).
  // The reference: tuning never reaches it, but the asOf cutoff does.
  const oldResults = await searchMemoriesSemantic(character.id, query, {
    userId: input.userId,
    limit,
    minImportance: 0.3,
    recallContext: baseCtx,
    excludeMemoryIds,
    weightClockMs,
    embeddingMemo,
  })

  // NEW path — retrospective flip + window + entity anchors + multi-probe,
  // under the requested tuning.
  const extraProbes = buildRetrospectiveProbes(signals, retrospective)
  const newResults = await searchMemoriesSemantic(character.id, query, {
    userId: input.userId,
    limit,
    minImportance: 0.3,
    recallContext: {
      ...baseCtx,
      turnRetrospective: retrospective,
      ...(input.tuning ? { tuning } : {}),
      ...(presentParticipantNames ? { presentParticipantNames } : {}),
    },
    entityAnchors: signals?.entities,
    // Ungated from the retrospective flag, exactly as the two live consumers
    // are — the replay is only useful while it mirrors production.
    occurredWithin: signals?.timeRange ?? null,
    extraProbes,
    excludeMemoryIds,
    headSize: newHeadSize,
    weightClockMs,
    embeddingMemo,
  })

  logger.info('Recall replay complete', {
    chatId: input.chatId,
    characterId: character.id,
    turnIndex,
    retrospective,
    oldCandidates: oldResults.length,
    newCandidates: newResults.length,
    newHeadSize,
    tuning: tuningSummary,
    signalsPinned: !!input.signals,
    asOfIso,
  })

  return {
    chatId: input.chatId,
    characterId: character.id,
    characterName: character.name,
    turnIndex,
    totalTurns: turns.length,
    signals,
    query,
    clockIso,
    oldPath: toRows(oldResults, DYNAMIC_HEAD_DEFAULT_SIZE),
    newPath: toRows(newResults, newHeadSize),
    oldHeadSize: DYNAMIC_HEAD_DEFAULT_SIZE,
    newHeadSize,
    tuning: tuningSummary,
    signalsPinned: !!input.signals,
    asOf: asOfIso,
    excludedAfterAsOf: excludeMemoryIds?.size ?? 0,
  }
}
