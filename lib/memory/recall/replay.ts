/**
 * Recall replay harness (episodic recall overhaul §3; memory refactor §3.8).
 *
 * Given a chat (and optionally a turn index), rebuild the turn's recall query
 * (`buildRecallQuery`, distilling or reusing pinned signals), run the search
 * stages TWICE — once with the episodic signals inert (the pre-overhaul path)
 * and once with them live — and then the turn's `assemble` over the live
 * path's pool, against the turn's own clock, its pinned participants and the
 * anti-repetition ring as it stood at that turn (read back from the chat's
 * per-message recall records). Returns both candidate tables (cosine,
 * salience, blend, every multiplier that fired, the head cut), the stage trace
 * (what the archive removed, what the budget cut, what the inter-character
 * section took), and what the text fallback would have returned. Nothing is
 * persisted; nothing is stamped.
 *
 * Harness knobs (R7 of the recall multiplier retuning): `tuning` applies to
 * the new path only; `signals` reuses a saved distillation (the distillation is
 * not deterministic); `asOf` drops memories created after the turn opened, so
 * an old turn searches the corpus as it stood then.
 *
 * Consumed by POST /api/v1/chats/[id]?action=recall-replay, which the
 * `quilltap recall-replay` CLI wraps.
 *
 * @module memory/recall/replay
 */

import { getRepositories } from '@/lib/repositories/factory'
import { extractMemorySearchKeywords, stripToolArtifacts } from '../cheap-llm-tasks'
import { getMemoryRecallSettings } from '@/lib/instance-settings'
import { partitionMessagesIntoTurns } from '@/lib/chat/context-summary'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { MessageEvent } from '@/lib/schemas/types'
import type { EmbeddingResult } from '@/lib/embedding/embedding-service'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { RECALL_MIN_IMPORTANCE } from '../scoring'
import { assembleRecall, DYNAMIC_HEAD_DEFAULT_SIZE, RETRO_HEAD_SIZE, sizeMemoryPools } from './assemble'
import { ringFromDebugLog } from './deliver'
import { RECALL_HISTORY_TURNS } from './history'
import { buildRecallQuery, type MemorySearchExtraction, type RecallQuery } from './query'
import { searchRecall } from './search'
import { buildTurnRecallContext } from './tags'
import { describeRecallTuning, resolveRecallTuning, type RecallTuningInput } from './tuning'
import type { RecallCandidate, RecallTrace } from './types'

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
  salience: number | null
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
  /** The query both paths embedded (once). */
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
  /** What the text fallback would have returned for the new path's question. */
  fallbackPath: RecallReplayRow[]
  /** The anti-repetition ring the replay ranked under. */
  ring: string[]
  /** Where the ring came from: the turn's recall records, or (an older chat) its current ring. */
  ringSource: 'debug-log' | 'chat'
  /** What each pool of the turn's assemble rendered (ids). */
  pools: { archive: string[]; head: string[]; interCharacter: string[]; recap: string[] }
  /** What the assemble swallowed: a pool that failed renders nothing and leaves no trace entry. */
  warnings: string[]
  /** The stage trace: query, the new path's search stages, then assemble. */
  trace: RecallTrace
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

function toRows(results: RecallCandidate[], headSize: number): RecallReplayRow[] {
  return results.map((r, index) => ({
    memoryId: r.memory.id,
    summary: r.memory.summary,
    kind: r.memory.kind ?? 'semantic',
    occurredAt: r.memory.occurredAt ?? null,
    narrativeTime: r.memory.narrativeTime ?? null,
    createdAt: r.memory.createdAt,
    keywords: r.memory.keywords ?? [],
    cosine: r.score,
    salience: r.salience ?? null,
    blendedBefore: r.recallAdjustment?.blendedBefore ?? null,
    multiplier: r.recallAdjustment?.multiplier ?? null,
    fired: r.recallAdjustment?.fired ?? [],
    blendedAfter: r.recallAdjustment?.blendedAfter ?? null,
    selected: index < headSize,
  }))
}

/** The memory budget the assemble step sizes its pools by when none is given (the floor). */
const REPLAY_DEFAULT_MEMORY_BUDGET = 2000

/**
 * The anti-repetition ring as it stood when `beforeMessageId` was written: the
 * head ids of the last few recall records before it. Null when the chat has no
 * recall records that early (it predates them).
 */
export function ringAsOf(messages: readonly MessageEvent[], beforeMessageId: string): string[][] | null {
  const cutoff = messages.findIndex(m => m.id === beforeMessageId)
  const before = cutoff >= 0 ? messages.slice(0, cutoff) : messages
  const turns: string[][] = []
  let sawRecord = false
  for (const m of before) {
    const ring = ringFromDebugLog(m.debugMemoryLogs)
    if (ring === null) continue
    sawRecord = true
    if (ring.length > 0) turns.push(ring)
  }
  return sawRecord ? turns.slice(-RECALL_HISTORY_TURNS) : null
}

/**
 * Run the replay. Read-only against the chat and memory corpus — no stage
 * before `deliver` writes, and the replay never delivers.
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

  const fallbackText = window[window.length - 1]?.content || ''
  const embeddingMemo = boundedMemo()
  const trace: RecallTrace = []
  const query = await buildRecallQuery({
    userId: input.userId,
    text: fallbackText,
    signals: signals ?? undefined,
    embeddingMemo,
  }, trace)
  if (!query.text.trim()) {
    throw new Error('Could not derive a recall query for this turn')
  }

  const recallSettings = await getMemoryRecallSettings()
  const presentParticipants = chat.participants.filter(p => p.status !== 'removed' && p.characterId)
  const presentAboutCharacterIds = presentParticipants.map(p => p.characterId)
  const presentCharacters = await Promise.all(presentParticipants.map(p => repos.characters.findByIdRaw(p.characterId)))

  const tuning = resolveRecallTuning(input.tuning)
  const tuningSummary = describeRecallTuning(tuning)
  // R4 drops entities that only name someone in the room; it needs their names.
  const presentParticipantNames = tuning.specificAnchors
    ? presentCharacters.flatMap(c => (c?.name ? [c.name] : []))
    : undefined

  // asOf — the corpus as it stood when the turn opened: leave out every memory
  // created at or after the turn's opening (user) message, and decay salience
  // against the turn's clock rather than today's.
  const replayedTurn = turns[turnIndex - 1]
  const openingMessage = replayedTurn.messages.find(m => m.role === 'USER') ?? replayedTurn.messages[0]
  const asOfIso = input.asOf ? openingMessage?.createdAt ?? null : null
  const nowMs = asOfIso ? Date.parse(clockIso) : undefined
  let excludeMemoryIds: Set<string> | undefined
  if (asOfIso) {
    const newer = await repos.memories.countCreatedSince(character.id, asOfIso)
    const recent = newer > 0 ? await repos.memories.findRecent(character.id, newer) : []
    excludeMemoryIds = new Set(recent.filter(m => m.createdAt >= asOfIso).map(m => m.id))
    logger.debug('Recall replay corpus cutoff', { chatId: input.chatId, asOfIso, excluded: excludeMemoryIds.size })
  }

  // The anti-repetition ring as it stood at this turn, from the recall records
  // on the messages before it; a chat older than those records falls back to
  // its current ring.
  const messageEvents = allMessages.filter((m): m is MessageEvent => m.type === 'message')
  const reconstructed = openingMessage ? ringAsOf(messageEvents, openingMessage.id) : null
  const ringSource: 'debug-log' | 'chat' = reconstructed ? 'debug-log' : 'chat'

  const retrospective = query.retrospective
  const newHeadSize =
    typeof input.memoryBudget === 'number' && input.memoryBudget > 0
      ? sizeMemoryPools(input.memoryBudget, retrospective).headEntries
      : retrospective ? RETRO_HEAD_SIZE : DYNAMIC_HEAD_DEFAULT_SIZE
  // Wide enough to show where the larger head ends.
  const limit = input.limit ?? Math.max(25, newHeadSize + 10)

  // The same context assembly as the live paths (lib/memory/recall/tags.ts).
  // The OLD path leaves the retrospective flag off entirely.
  const baseCtx = buildTurnRecallContext({
    chat: reconstructed ? { ...chat, commonplaceRecallHistory: { turns: reconstructed } } : chat,
    recallSettings,
    turnContext: signals?.context ?? null,
    turnTemporal: signals?.temporal ?? null,
    presentAboutCharacterIds,
    // Fresh-event boost against the REPLAYED TURN's clock.
    nowMs: Date.parse(clockIso),
  })

  // OLD path — episodic signals inert: no probes, anchors or window.
  const oldQuery: RecallQuery = { ...query, probes: [], anchors: [], window: null }
  const oldResults = await searchRecall(character.id, oldQuery, {
    limit,
    minImportance: RECALL_MIN_IMPORTANCE,
    recallContext: baseCtx,
    excludeIds: excludeMemoryIds,
    nowMs,
  }, [], 'old')

  // NEW path — the live path under the requested tuning.
  const newCtx = {
    ...baseCtx,
    turnRetrospective: retrospective,
    ...(input.tuning ? { tuning } : {}),
    ...(presentParticipantNames ? { presentParticipantNames } : {}),
  }
  const newSearch = { limit, minImportance: RECALL_MIN_IMPORTANCE, recallContext: newCtx, excludeIds: excludeMemoryIds, headSize: newHeadSize, nowMs }
  const newResults = await searchRecall(character.id, query, newSearch, trace, 'head')
  // What the text fallback would have done with the same question.
  const fallbackResults = await searchRecall(character.id, query, { ...newSearch, forceText: true }, [], 'fallback')

  // The turn's assemble over the live pool: what each pool took and cut.
  const others = presentCharacters
    .filter((c): c is NonNullable<typeof c> => !!c && c.id !== character.id)
    .map(c => ({ id: c.id, name: c.name }))
  const bundle = await assembleRecall({
    userId: input.userId,
    character: { id: character.id, name: character.name },
    chat: reconstructed ? { ...chat, commonplaceRecallHistory: { turns: reconstructed } } : chat,
    memoryBudget: input.memoryBudget ?? REPLAY_DEFAULT_MEMORY_BUDGET,
    minImportance: RECALL_MIN_IMPORTANCE,
    skipMemories: false,
    present: [{ id: character.id, name: character.name }, ...others],
    interCharacterSubjects: others,
    currentStateTokens: 0,
    recallSettings,
    recentWindow: fallbackText,
    preRecall: { query, candidates: newResults.candidates, ranked: newResults.ranked },
    replay: { excludeIds: excludeMemoryIds ?? new Set(), nowMs, ring: newCtx.recentlyWhisperedIds },
  })
  trace.push(...bundle.trace)

  logger.info('Recall replay complete', {
    chatId: input.chatId,
    characterId: character.id,
    turnIndex,
    retrospective,
    oldCandidates: oldResults.candidates.length,
    newCandidates: newResults.candidates.length,
    newHeadSize,
    tuning: tuningSummary,
    signalsPinned: !!input.signals,
    asOfIso,
    ringSource,
  })

  return {
    chatId: input.chatId,
    characterId: character.id,
    characterName: character.name,
    turnIndex,
    totalTurns: turns.length,
    signals,
    query: query.text,
    clockIso,
    oldPath: toRows(oldResults.candidates, DYNAMIC_HEAD_DEFAULT_SIZE),
    newPath: toRows(newResults.candidates, newHeadSize),
    fallbackPath: toRows(fallbackResults.candidates, newHeadSize),
    oldHeadSize: DYNAMIC_HEAD_DEFAULT_SIZE,
    newHeadSize,
    tuning: tuningSummary,
    signalsPinned: !!input.signals,
    asOf: asOfIso,
    excludedAfterAsOf: excludeMemoryIds?.size ?? 0,
    ring: [...(newCtx.recentlyWhisperedIds ?? [])],
    ringSource,
    pools: bundle.pools,
    warnings: bundle.warnings,
    trace,
  }
}
