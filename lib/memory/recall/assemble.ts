/**
 * Stage 6 — assemble: one turn's recall, every pool, from one query.
 *
 * ```
 * query (distil + embed, once) → head pool (search) → archive → recap → head → inter-character → conversations
 * ```
 *
 * - **One embedding per turn.** The query is embedded once (the proactive pass
 *   hands its query in already embedded); the head, the inter-character
 *   relevance half, the recap's relevant-conversations list, the per-turn
 *   conversation list and the retrospective mini-recap all reuse it. Only a
 *   retrospective turn's probes (≤ 2) are embedded beside it, in the query stage.
 * - **The inter-character relevance half is a filter of the turn's one
 *   gathered pool** by `aboutCharacterId` (decision 12), not a search per
 *   present character.
 * - **A row reaches the model in at most one line-rendered pool** (bug 224), in
 *   this order of precedence: archive → head → inter-character. The recap is a
 *   narrative, not lines: it is built without the archive's rows (which the
 *   archive already says verbatim), but it never takes a row from the head or
 *   the inter-character section — a lossy summary is no stand-in for the
 *   memory's own words on the turn it is most wanted. The archive keeps its
 *   composition and id sort; its size and token budget are fixed per
 *   compaction generation, so a retrospective turn's larger head never changes
 *   it — the head borrows from what the archive leaves.
 *
 * Reads only. What was delivered is `deliver`'s to record, after the request
 * body is built.
 *
 * @module memory/recall/assemble
 */

import type { Memory, Provider } from '@/lib/schemas/types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { getRepositories } from '@/lib/repositories/factory'
import { estimateTokens } from '@/lib/tokens/token-counter'
import { withTimeout } from '@/lib/promise-timeout'
import { logger } from '@/lib/logger'
import type { ChatMessage, UncensoredFallbackOptions } from '../cheap-llm-tasks'
import { getOrComputeFrozenArchive } from './archive'
import {
  READ_CONVERSATION_CALL_NOTE,
  RELEVANT_CONVERSATIONS_MAX,
  RELEVANT_CONVERSATIONS_MIN,
  RELEVANT_CONVERSATIONS_RAMP_MAX_TOKENS,
  RELEVANT_CONVERSATIONS_RAMP_MIN_TOKENS,
  renderRelevantConversationsBlock,
  searchVaultConversationSummaries,
} from './conversations'
import { parseRetroSignatures } from './history'
import { buildRecallQuery, type RecallQuery } from './query'
import { generateMemoryRecap, rampLimit } from './recap'
import {
  renderArchive,
  renderHead,
  renderInterCharacter,
  type DebugInterCharacterMemoryInfo,
  type DebugMemoryInfo,
} from './render'
import { searchRecall } from './search'
import { buildMemorySubjectContext } from './subject'
import { buildTurnRecallContext, type ScopePolicy } from './tags'
import type { ResolvedRecallTuning } from './tuning'
import { traceStage, type RecallCandidate, type RecallPool, type RecallTrace, type RenderedLine } from './types'

// ============================================================================
// Pool sizing
// ============================================================================

/** Floor on the dynamic-head token budget. */
export const DYNAMIC_HEAD_TOKEN_BUDGET = 200
/** Floor on the dynamic-head entry count. */
export const DYNAMIC_HEAD_DEFAULT_SIZE = 5
/** Retrospective turns: floors on the enlarged head (twice the ordinary one). */
export const RETRO_HEAD_TOKEN_BUDGET = 600
export const RETRO_HEAD_SIZE = 10
/** Share of the memory budget the per-turn relevance head may spend. */
export const DYNAMIC_HEAD_BUDGET_RATIO = 0.15
/** Ceilings on the ordinary dynamic head. */
export const DYNAMIC_HEAD_MAX_TOKEN_BUDGET = 1200
export const DYNAMIC_HEAD_MAX_SIZE = 15
const HEAD_TOKENS_PER_ENTRY = 40
/** Floor and ceiling on the frozen-archive entry count. */
export const FROZEN_ARCHIVE_MIN_SIZE = 25
export const FROZEN_ARCHIVE_MAX_SIZE = 60
const ARCHIVE_TOKENS_PER_ENTRY = 60

/** Archive overlap (≤ FROZEN_ARCHIVE_MAX_SIZE) plus the largest retrospective head. */
export const PROACTIVE_RECALL_POOL_SIZE = FROZEN_ARCHIVE_MAX_SIZE + DYNAMIC_HEAD_MAX_SIZE * 2

/** Per-character caps on the inter-character section's two halves. */
export const INTER_CHAR_PER_CHARACTER_LIMIT = 5
export const INTER_CHAR_DIGEST_LIMIT = 2
export const INTER_CHAR_RELEVANCE_PER_CHARACTER_LIMIT = 5

/** Cap on entries in the retrospective mini-recap conversation list. */
export const RETRO_MINI_RECAP_MAX_ENTRIES = 5

/**
 * Wall-clock ceiling on the recap. Above the interactive cheap-LLM budget on
 * purpose: a recap merely slow in its embedding and its narrative call is
 * still working, and it is optional context.
 */
export const MEMORY_RECAP_PHASE_TIMEOUT_MS = 60_000

export interface MemoryPoolSizing {
  headTokenBudget: number
  headEntries: number
  archiveTokenBudget: number
  /** Derived from the ORDINARY head even on retrospective turns, so the archive stays byte-stable. */
  archiveSize: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Split a turn's memory budget between the head and the frozen archive:
 * head tokens = clamp(15% of budget, 200, 1200), head entries = clamp(tokens /
 * 40, 5, 15), doubled (with floors 600 / 10) on a retrospective turn; archive
 * size = clamp((budget − ordinary head tokens) / 60, 25, 60).
 */
export function sizeMemoryPools(memoryBudget: number, retrospective: boolean): MemoryPoolSizing {
  const budget = Math.max(0, Math.floor(memoryBudget))
  const baseHeadTokens = Math.min(
    budget,
    clamp(Math.round(budget * DYNAMIC_HEAD_BUDGET_RATIO), DYNAMIC_HEAD_TOKEN_BUDGET, DYNAMIC_HEAD_MAX_TOKEN_BUDGET),
  )
  const baseHeadEntries = clamp(Math.round(baseHeadTokens / HEAD_TOKENS_PER_ENTRY), DYNAMIC_HEAD_DEFAULT_SIZE, DYNAMIC_HEAD_MAX_SIZE)
  const headTokenBudget = retrospective ? Math.min(budget, Math.max(RETRO_HEAD_TOKEN_BUDGET, baseHeadTokens * 2)) : baseHeadTokens
  const headEntries = retrospective ? Math.max(RETRO_HEAD_SIZE, baseHeadEntries * 2) : baseHeadEntries
  const archiveSize = clamp(
    Math.round(Math.max(0, budget - baseHeadTokens) / ARCHIVE_TOKENS_PER_ENTRY),
    FROZEN_ARCHIVE_MIN_SIZE,
    FROZEN_ARCHIVE_MAX_SIZE,
  )
  return { headTokenBudget, headEntries, archiveTokenBudget: Math.max(0, budget - headTokenBudget), archiveSize }
}

// ============================================================================
// The plan and the bundle
// ============================================================================

/** A query the proactive pass already built and searched. */
export interface PreRecall {
  query: RecallQuery
  candidates: RecallCandidate[]
  trace?: RecallTrace
}

export interface RecallPlan {
  userId: string
  embeddingProfileId?: string
  provider?: Provider
  character: { id: string; name: string }
  chat: {
    id: string
    projectId?: string | null
    compactionGeneration?: number | null
    commonplaceRecallHistory?: unknown
    timelineMode?: 'realtime' | 'narrative' | null
  }
  memoryBudget: number
  minImportance: number
  /** No memory pools at all (the recap may still run). */
  skipMemories: boolean
  /** Everyone present, the responder included (participant boost, R4). */
  present: Array<{ id: string; name: string }>
  /** The others the inter-character section covers. Empty → no section. */
  interCharacterSubjects: Array<{ id: string; name: string }>
  /** Tokens the `## Current State` block takes (the inter-character budget leaves room for it). */
  currentStateTokens: number
  recallSettings: { scopePolicy: ScopePolicy; expandRelated: boolean; perTurnConversationSummaries: boolean }
  /** The recent-window prose — the query when nothing better is distilled. */
  recentWindow: string
  /** Distil the turn's signals here when the proactive pass did not. */
  distill?: { messages: ChatMessage[]; selection: CheapLLMSelection; clockIso: string }
  preRecall?: PreRecall | null
  recap?: {
    selection: CheapLLMSelection
    uncensoredFallback?: UncensoredFallbackOptions
    maxContext?: number | null
    /** The recap's own relevance text, for a turn with no query. */
    fallbackQuery: string
  } | null
  /** The conversation lists. Absent → none (the replay). */
  conversations?: {
    maxContext?: number | null
    /** UUIDs the standing fold whisper already lists for this target. */
    standingIds: () => Promise<Set<string>>
  } | null
  onStatusChange?: (stage: string, message: string) => void
  /** The replay's knobs: an `asOf` corpus, a pinned clock, a tuning, the ring as of the turn. */
  replay?: {
    excludeIds?: ReadonlySet<string>
    nowMs?: number
    tuning?: ResolvedRecallTuning
    ring?: ReadonlySet<string>
  }
}

export interface RecallBundle {
  query: RecallQuery | null
  path: 'skipped' | 'pre-searched' | 'two-pool'
  /** The gathered pool the head and the inter-character relevance half draw on. */
  pool: RecallCandidate[]
  sections: {
    recap?: string
    /** Archive + head. */
    relevant?: string
    interCharacter?: string
    relevantConversations?: string
    retrospective?: string
  }
  tokens: { recap: number; relevant: number; interCharacter: number }
  /** What each line-rendered pool wrote, for `deliver`. */
  lines: Partial<Record<RecallPool, RenderedLine[]>>
  /** Rendered ids per pool. The recap's are the rows its narrative read — not delivered in their own words, so never stamped or deduped against. */
  pools: { archive: string[]; head: string[]; interCharacter: string[]; recap: string[] }
  retroSignature: string | null
  debugMemories: DebugMemoryInfo[]
  debugInterCharacterMemories: DebugInterCharacterMemoryInfo[]
  memoriesIncluded: number
  interCharacterIncluded: number
  trace: RecallTrace
  warnings: string[]
}

export function emptyRecallBundle(): RecallBundle {
  return {
    query: null,
    path: 'skipped',
    pool: [],
    sections: {},
    tokens: { recap: 0, relevant: 0, interCharacter: 0 },
    lines: {},
    pools: { archive: [], head: [], interCharacter: [], recap: [] },
    retroSignature: null,
    debugMemories: [],
    debugInterCharacterMemories: [],
    memoriesIncluded: 0,
    interCharacterIncluded: 0,
    trace: [],
    warnings: [],
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error')

// ============================================================================
// assembleRecall
// ============================================================================

export async function assembleRecall(plan: RecallPlan): Promise<RecallBundle> {
  const bundle = emptyRecallBundle()
  const trace = bundle.trace
  const characterId = plan.character.id
  const nowMs = plan.replay?.nowMs ?? Date.now()
  const excludeIds = plan.replay?.excludeIds
  const presentIds = [...new Set(plan.present.map(p => p.id).filter(id => id.length > 0))]
  const ordinarySizing = sizeMemoryPools(plan.memoryBudget, false)
  const retroSizing = sizeMemoryPools(plan.memoryBudget, true)

  // 1. The query — handed in by the proactive pass, or built here (once).
  if (!plan.skipMemories) {
    try {
      if (plan.preRecall && plan.preRecall.query.text) {
        bundle.query = plan.preRecall.query
        bundle.pool = plan.preRecall.candidates
        bundle.path = 'pre-searched'
        trace.push(...(plan.preRecall.trace ?? []))
      } else if (plan.recentWindow) {
        bundle.path = 'two-pool'
        bundle.query = await buildRecallQuery({
          userId: plan.userId,
          embeddingProfileId: plan.embeddingProfileId,
          text: plan.recentWindow,
          distill: plan.distill
            ? {
                messages: plan.distill.messages,
                characterName: plan.character.name,
                selection: plan.distill.selection,
                chatId: plan.chat.id,
                characterId,
                clock: { nowIso: plan.distill.clockIso, timelineMode: plan.chat.timelineMode ?? 'realtime' },
                // The operator is waiting: tight budget, no retry (bug 115).
                latency: 'interactive',
              }
            : undefined,
        }, trace)
        const ctx = buildTurnRecallContext({
          chat: plan.chat,
          recallSettings: plan.recallSettings,
          turnContext: bundle.query.signals?.context ?? null,
          turnTemporal: bundle.query.signals?.temporal ?? null,
          turnRetrospective: bundle.query.retrospective,
          presentAboutCharacterIds: presentIds,
          presentParticipantNames: plan.present.map(p => p.name).filter(n => n.length > 0),
          nowMs,
          ...(plan.replay?.tuning ? { tuning: plan.replay.tuning } : {}),
        })
        if (plan.replay?.ring) ctx.recentlyWhisperedIds = plan.replay.ring
        const sizing = bundle.query.retrospective ? retroSizing : ordinarySizing
        const result = await searchRecall(characterId, bundle.query, {
          // A few more than the head, so the archive overlap still leaves enough.
          limit: sizing.headEntries * 3,
          minImportance: plan.minImportance,
          recallContext: ctx,
          excludeIds,
          ...(plan.replay?.nowMs !== undefined ? { nowMs } : {}),
        }, trace, 'head')
        bundle.pool = result.candidates
      }
    } catch (error) {
      bundle.warnings.push(`Failed to retrieve memories: ${errorText(error)}`)
    }
  }
  const query = bundle.query
  const retrospective = query?.retrospective === true
  const turnSizing = retrospective ? retroSizing : ordinarySizing

  // 2. The frozen archive, rendered under the turn's archive budget.
  let archiveIds = new Set<string>()
  let archiveMemories: Memory[] = []
  let subject = { selfCharacterId: characterId, characterNames: new Map<string, string>() as ReadonlyMap<string, string> }
  let archiveTokens = 0
  let archiveContent = ''
  if (!plan.skipMemories) {
    try {
      archiveMemories = await getOrComputeFrozenArchive(characterId, plan.chat.id, plan.chat.compactionGeneration ?? 0, {
        size: ordinarySizing.archiveSize,
        presentCharacterIds: presentIds.filter(id => id !== characterId),
        ...(excludeIds ? { exclude: excludeIds } : {}),
      })
      archiveIds = new Set(archiveMemories.map(m => m.id))
      // Every self-facing line names a subject that is not the character (bug 122).
      subject = await buildMemorySubjectContext(characterId, [...archiveMemories, ...bundle.pool.map(c => c.memory)])
      // Always the ordinary budget: a retrospective turn's larger head never
      // trims the archive, so its bytes hold for the whole generation.
      const archive = renderArchive(archiveMemories, ordinarySizing.archiveTokenBudget, plan.provider, subject)
      archiveContent = archive.content
      archiveTokens = archive.tokenCount
      bundle.lines.archive = archive.lines
      bundle.pools.archive = archive.lines.map(l => l.memoryId)
      bundle.debugMemories.push(...archive.debugMemories)
      traceStage(trace, 'assemble', {
        size: ordinarySizing.archiveSize,
        held: archiveMemories.length,
        rendered: archive.lines.length,
        cutByBudget: archiveMemories.length - archive.lines.length,
        tokenBudget: ordinarySizing.archiveTokenBudget,
      }, 'archive')
    } catch (error) {
      bundle.warnings.push(`Failed to retrieve memories: ${errorText(error)}`)
    }
  }

  // 3. The recap (chat start / character join): a narrative of what the
  // archive does not already say, its conversation list on the turn's vector.
  if (plan.recap) {
    plan.onStatusChange?.('generating_recap', `Recalling ${plan.character.name}'s memories...`)
    const useTurnQuery = !!query?.embedding && query.text.length > 0
    try {
      const recap = await withTimeout(
        generateMemoryRecap({
          characterId,
          characterName: plan.character.name,
          selection: plan.recap.selection,
          userId: plan.userId,
          chatId: plan.chat.id,
          uncensoredFallback: plan.recap.uncensoredFallback,
          maxContext: plan.recap.maxContext,
          relevanceQuery: useTurnQuery ? query!.text : plan.recap.fallbackQuery,
          relevanceEmbedding: useTurnQuery ? query!.embedding!.embedding : null,
          embeddingProfileId: plan.embeddingProfileId,
          excludeIds: new Set(bundle.pools.archive),
        }),
        MEMORY_RECAP_PHASE_TIMEOUT_MS,
        `Memory recap exceeded its ${MEMORY_RECAP_PHASE_TIMEOUT_MS}ms phase budget`,
      )
      if (recap.content) {
        bundle.sections.recap = recap.content
        bundle.tokens.recap = estimateTokens(recap.content, plan.provider)
        bundle.pools.recap = recap.memoryIds
      }
      traceStage(trace, 'assemble', { rows: recap.memoryIds.length, reusedQuery: useTurnQuery, excludedAsArchive: bundle.pools.archive.length }, 'recap')
    } catch (error) {
      bundle.warnings.push(`Failed to generate memory recap: ${errorText(error)}`)
      logger.error('[Recall] Memory recap generation failed', { characterId }, error instanceof Error ? error : undefined)
    }
  }
  plan.onStatusChange?.('assembling_context', 'Assembling context...')

  // 4. The head: the pool past the archive. The recap's rows stay eligible —
  // its narrative may have left out exactly the line this turn needs.
  let headTokens = 0
  let headContent = ''
  // A retrospective head borrows what the archive left of the memory budget
  // (never less than the ordinary head).
  const headTokenBudget = retrospective
    ? Math.min(retroSizing.headTokenBudget, Math.max(ordinarySizing.headTokenBudget, plan.memoryBudget - archiveTokens))
    : ordinarySizing.headTokenBudget
  if (!plan.skipMemories && bundle.pool.length > 0) {
    const headCandidates = bundle.pool.filter(c => !archiveIds.has(c.memory.id))
    const head = renderHead(headCandidates, plan.provider, subject, {
      maxTokens: headTokenBudget,
      maxEntries: turnSizing.headEntries,
    })
    headContent = head.content
    headTokens = head.tokenCount
    bundle.lines.head = head.lines
    bundle.pools.head = head.lines.map(l => l.memoryId)
    bundle.debugMemories.push(...head.debugMemories)
    traceStage(trace, 'assemble', {
      pool: bundle.pool.length,
      removedAsArchive: bundle.pool.filter(c => archiveIds.has(c.memory.id)).length,
      rendered: head.lines.length,
      cutByBudget: Math.min(headCandidates.length, turnSizing.headEntries) - head.lines.length,
      entries: turnSizing.headEntries,
      tokenBudget: headTokenBudget,
      retrospective,
    }, 'head')
  }
  bundle.sections.relevant = [archiveContent, headContent].filter(Boolean).join('\n\n') || undefined
  bundle.tokens.relevant = archiveTokens + headTokens
  bundle.memoriesIncluded = bundle.pools.archive.length + bundle.pools.head.length

  // 5. Inter-character: about the others present. Both halves skip anything
  // an earlier pool already delivers.
  if (!plan.skipMemories && plan.interCharacterSubjects.length > 0) {
    try {
      await assembleInterCharacter(plan, bundle, nowMs)
    } catch (error) {
      bundle.warnings.push(`Failed to retrieve inter-character memories: ${errorText(error)}`)
    }
  }

  // 6. The conversation lists, on the turn's vector.
  if (plan.conversations && query?.embedding) {
    await assembleConversations(plan, bundle, query)
  }

  return bundle
}

async function assembleInterCharacter(
  plan: RecallPlan,
  bundle: RecallBundle,
  nowMs: number,
): Promise<void> {
  const characterId = plan.character.id
  const subjects = plan.interCharacterSubjects
  const budget = Math.floor((plan.memoryBudget - bundle.tokens.relevant - plan.currentStateTokens) / 2)
  if (budget <= 0) return
  const repos = getRepositories()
  const otherIds = subjects.map(s => s.id)
  const delivered = new Set<string>([...bundle.pools.archive, ...bundle.pools.head])
  const excludeIds = plan.replay?.excludeIds

  // Importance half: hot digests about each, then the partition query.
  const digestLists = await Promise.all(otherIds.map(id => repos.memories.findHotDigests(characterId, id, INTER_CHAR_DIGEST_LIMIT)))
  const partition = await repos.memories.findByCharacterAboutCharacters(characterId, otherIds, INTER_CHAR_PER_CHARACTER_LIMIT)
  const seen = new Set<string>(delivered)
  let skipped = 0
  const importance = [...digestLists.flat(), ...partition].filter(m => {
    if (excludeIds?.has(m.id)) return false
    if (delivered.has(m.id)) {
      skipped++
      return false
    }
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })

  // Relevance half: the turn's pool, filtered to rows about each other present.
  const perCharacter = new Map<string, number>()
  const relevance = bundle.pool.filter(c => {
    const about = c.memory.aboutCharacterId
    if (!about || !otherIds.includes(about)) return false
    if (delivered.has(c.memory.id)) {
      skipped++
      return false
    }
    const taken = perCharacter.get(about) ?? 0
    if (taken >= INTER_CHAR_RELEVANCE_PER_CHARACTER_LIMIT) return false
    perCharacter.set(about, taken + 1)
    return true
  })

  const names = new Map(subjects.map(s => [s.id, s.name]))
  const section = renderInterCharacter(importance, names, budget, plan.provider, relevance, nowMs)
  bundle.sections.interCharacter = section.content || undefined
  bundle.tokens.interCharacter = section.tokenCount
  bundle.lines.interCharacter = section.lines
  bundle.pools.interCharacter = section.lines.map(l => l.memoryId)
  bundle.debugInterCharacterMemories = section.debugMemories
  bundle.interCharacterIncluded = section.memoriesUsed
  traceStage(bundle.trace, 'assemble', {
    subjects: otherIds.length,
    importance: importance.length,
    relevance: relevance.length,
    skippedAsDelivered: skipped,
    rendered: section.lines.length,
    tokenBudget: budget,
  }, 'interCharacter')
}

async function assembleConversations(plan: RecallPlan, bundle: RecallBundle, query: RecallQuery): Promise<void> {
  const conversations = plan.conversations!
  const embedding = query.embedding!.embedding
  const characterId = plan.character.id
  const listed = new Set<string>()

  // Per-turn list (instance setting, off by default). The recap already lists
  // the shelf on the turn it runs.
  if (plan.recallSettings.perTurnConversationSummaries && !bundle.sections.recap) {
    try {
      const matches = await searchVaultConversationSummaries({
        characterId,
        query: query.text,
        userId: plan.userId,
        embeddingProfileId: plan.embeddingProfileId,
        precomputedEmbedding: embedding,
        limit: rampLimit(
          conversations.maxContext ?? null,
          RELEVANT_CONVERSATIONS_MIN,
          RELEVANT_CONVERSATIONS_MAX,
          RELEVANT_CONVERSATIONS_RAMP_MIN_TOKENS,
          RELEVANT_CONVERSATIONS_RAMP_MAX_TOKENS,
        ),
        excludeConversationId: plan.chat.id,
        timeRange: query.window,
      })
      const standing = await conversations.standingIds()
      const filtered = matches.filter(m => !standing.has(m.conversationId))
      if (filtered.length > 0) {
        for (const m of filtered) listed.add(m.conversationId)
        bundle.sections.relevantConversations = `${renderRelevantConversationsBlock(filtered)}\n\n${READ_CONVERSATION_CALL_NOTE}`
      }
      traceStage(bundle.trace, 'assemble', { matched: matches.length, listed: filtered.length }, 'conversations')
    } catch (error) {
      logger.warn('[Recall] Per-turn conversation-summary search failed (non-fatal)', {
        chatId: plan.chat.id,
        characterId,
        error: errorText(error),
      })
    }
  }

  // Retrospective mini-recap: a dated, drillable list scoped by the turn's
  // window, skipped when the same window/entity signature went out recently.
  if (query.retrospective) {
    const signals = query.signals
    const signature = [
      query.window ? `${query.window.from}→${query.window.to}` : '∅',
      ...(signals?.entities ?? []).map(e => e.toLowerCase()).sort(),
    ].join('|')
    if (parseRetroSignatures(plan.chat.commonplaceRecallHistory).includes(signature)) {
      traceStage(bundle.trace, 'assemble', { suppressed: true, signature }, 'retrospective')
      return
    }
    try {
      const matches = await searchVaultConversationSummaries({
        characterId,
        query: query.text,
        userId: plan.userId,
        embeddingProfileId: plan.embeddingProfileId,
        precomputedEmbedding: embedding,
        limit: RETRO_MINI_RECAP_MAX_ENTRIES,
        excludeConversationId: plan.chat.id,
        timeRange: query.window,
      })
      const standing = await conversations.standingIds()
      const filtered = matches
        .filter(m => !standing.has(m.conversationId) && !listed.has(m.conversationId))
        .slice(0, RETRO_MINI_RECAP_MAX_ENTRIES)
      if (filtered.length > 0) {
        bundle.sections.retrospective = `${renderRelevantConversationsBlock(filtered)}\n\n${READ_CONVERSATION_CALL_NOTE}`
        bundle.retroSignature = signature
      }
      traceStage(bundle.trace, 'assemble', { matched: matches.length, listed: filtered.length, signature }, 'retrospective')
    } catch (error) {
      logger.warn('[Recall] Retrospective mini-recap failed (non-fatal)', {
        chatId: plan.chat.id,
        characterId,
        error: errorText(error),
      })
    }
  }
}
