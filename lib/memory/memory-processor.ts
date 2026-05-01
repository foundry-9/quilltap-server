/**
 * Memory Processor — Per-Turn Extraction
 *
 * Runs once per chat turn (not once per assistant message). The orchestrator
 * defers extraction until the turn closes, builds a TurnTranscript covering
 * the user opener plus every character contribution, and feeds the whole
 * transcript through three extraction passes:
 *
 *   1. ONE user-pass against the joined transcript — produces user-memory
 *      candidates that are written to every character that participated in
 *      the turn (each character keeps their own copy).
 *   2. ONE self-pass per character — each character extracts what they
 *      themselves revealed, with the joined turn as social context.
 *   3. ONE inter-character pass per (observer, subject) pair — observer
 *      forms memories about subject from the full turn, not a 2-message
 *      slice plucked out of history.
 *
 * Rate-limiting is per-character-per-turn (existing per-hour cap continues
 * to apply). The chat flow never blocks on memory extraction.
 */

import { getRepositories } from '@/lib/repositories/factory'
import {
  extractUserMemoriesFromTurn,
  extractSelfMemoriesFromTurn,
  extractInterCharacterMemoriesFromTurn,
  MemoryCandidate,
  UncensoredFallbackOptions,
} from './cheap-llm-tasks'
import { getCheapLLMProvider, CheapLLMConfig, CheapLLMSelection, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import { resolveMaxTokens } from '@/lib/llm/model-context-data'
import { ConnectionProfile, CheapLLMSettings } from '@/lib/schemas/types'
import type { DangerousContentSettings, MemoryExtractionLimits } from '@/lib/schemas/settings.types'
import type { TurnTranscript, TurnCharacterSlice } from '@/lib/services/chat-message/turn-transcript'
import { createMemoryWithGate } from './memory-service'
import type { MemoryGateOutcome } from './memory-gate'
import { logger } from '@/lib/logger'
import { postHostNoUserCharacterAnnouncement } from '@/lib/services/host-notifications/writer'

/**
 * Fire-and-forget Host whisper for chats with no user-controlled character.
 */
async function emitNoUserCharacterWhisper(chatId: string): Promise<void> {
  try {
    await postHostNoUserCharacterAnnouncement({ chatId })
  } catch (error) {
    logger.warn('[Memory] No-user-character whisper failed (non-fatal)', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

type RateLimitDecision =
  | { mode: 'allow' }
  | { mode: 'throttle'; floor: number; recentCount: number; cap: number }
  | { mode: 'skip'; recentCount: number; cap: number }

async function resolveExtractionRateLimit(
  characterId: string,
  limits: MemoryExtractionLimits | undefined
): Promise<RateLimitDecision> {
  if (!limits?.enabled) {
    return { mode: 'allow' }
  }

  try {
    const repos = getRepositories()
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const recentCount = await repos.memories.countCreatedSince(characterId, oneHourAgo)

    if (recentCount >= limits.maxPerHour) {
      return { mode: 'skip', recentCount, cap: limits.maxPerHour }
    }

    const softStart = Math.floor(limits.maxPerHour * limits.softStartFraction)
    if (recentCount >= softStart) {
      return {
        mode: 'throttle',
        floor: limits.softFloor,
        recentCount,
        cap: limits.maxPerHour,
      }
    }
  } catch (error) {
    logger.warn('[Memory] Rate-limit lookup failed; allowing extraction', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return { mode: 'allow' }
}

function applyImportanceFloor(candidates: MemoryCandidate[], floor: number): MemoryCandidate[] {
  return candidates.filter(c => (c.importance ?? 0.5) >= floor)
}

/**
 * Per-turn memory extraction context. The transcript carries everything the
 * extraction passes need; the rest is environment (cheap LLM selection,
 * danger settings, rate limits).
 */
export interface TurnMemoryExtractionContext {
  transcript: TurnTranscript
  chatId: string
  userId: string
  connectionProfile: ConnectionProfile
  cheapLLMSettings: CheapLLMSettings
  availableProfiles?: ConnectionProfile[]
  dangerSettings?: DangerousContentSettings
  isDangerousChat?: boolean
  memoryExtractionLimits?: MemoryExtractionLimits
  /** Override the source-message timestamp on derived memories — used by batch re-extraction to backfill historical timing. */
  sourceMessageTimestamp?: string
  /** When true, run all extraction passes but skip persistence — candidates are returned on the result instead. */
  dryRun?: boolean
}

/**
 * Candidate memory captured during a dry-run extraction. Mirrors the input to
 * `createMemoryWithGate` plus the metadata a caller needs to attribute it
 * (which character, observing whom, from which pass, sourced from which message).
 */
export interface ExtractedCandidate {
  pass: 'USER' | 'SELF' | 'INTER'
  characterId: string
  characterName: string
  aboutCharacterId: string
  aboutCharacterName: string
  sourceMessageId: string | null
  content: string
  summary: string
  keywords: string[]
  importance: number
}

export interface TurnMemoryProcessingResult {
  success: boolean
  /** Total number of new memories written across all passes. */
  memoriesCreatedCount: number
  /** Total number of existing memories that were reinforced. */
  memoriesReinforcedCount: number
  /** All created memory IDs across all passes (for downstream logging). */
  createdMemoryIds: string[]
  /** All reinforced memory IDs. */
  reinforcedMemoryIds: string[]
  /** Aggregate token usage across every cheap-LLM call this run made. */
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  /** Source message ID to attach debug logs to (latest assistant message of the turn, or null when the turn produced none). */
  sourceMessageId: string | null
  /** Combined debug log lines, one per outcome, in extraction order. */
  debugLogs: string[]
  /** Populated only when the context was run with `dryRun: true`. */
  extractedCandidates?: ExtractedCandidate[]
  error?: string
}

function toCheapLLMConfig(settings: CheapLLMSettings): CheapLLMConfig {
  return {
    strategy: settings.strategy,
    userDefinedProfileId: settings.userDefinedProfileId || undefined,
    fallbackToLocal: settings.fallbackToLocal,
  }
}

interface WriteOptions {
  characterId: string
  characterName: string
  aboutCharacterId: string
  aboutCharacterName: string
  pass: 'USER' | 'SELF' | 'INTER'
  candidate: MemoryCandidate
  passLabel: string
  ctx: TurnMemoryExtractionContext
  sourceMessageId: string | null
  debugLogs: string[]
  createdIds: string[]
  reinforcedIds: string[]
  collected: ExtractedCandidate[]
}

async function writeCandidate(opts: WriteOptions): Promise<void> {
  if (opts.ctx.dryRun) {
    opts.collected.push({
      pass: opts.pass,
      characterId: opts.characterId,
      characterName: opts.characterName,
      aboutCharacterId: opts.aboutCharacterId,
      aboutCharacterName: opts.aboutCharacterName,
      sourceMessageId: opts.sourceMessageId,
      content: opts.candidate.content || '',
      summary: opts.candidate.summary || '',
      keywords: opts.candidate.keywords || [],
      importance: opts.candidate.importance ?? 0.5,
    })
    opts.debugLogs.push(
      `[Memory] DRY-RUN ${opts.passLabel} — would write: ${opts.candidate.summary}`
    )
    return
  }

  const outcome: MemoryGateOutcome = await createMemoryWithGate(
    {
      characterId: opts.characterId,
      aboutCharacterId: opts.aboutCharacterId,
      chatId: opts.ctx.chatId,
      content: opts.candidate.content || '',
      summary: opts.candidate.summary || '',
      keywords: opts.candidate.keywords || [],
      importance: opts.candidate.importance || 0.5,
      source: 'AUTO',
      sourceMessageId: opts.sourceMessageId ?? undefined,
      sourceMessageTimestamp: opts.ctx.sourceMessageTimestamp,
      tags: [],
    },
    { userId: opts.ctx.userId }
  )

  switch (outcome.action) {
    case 'SKIP_NEAR_DUPLICATE': {
      opts.debugLogs.push(
        `[Memory] SKIPPED near-duplicate ${opts.passLabel}: absorbed into ${outcome.memory?.id ?? 'unknown'} ` +
        `(similarity ${outcome.similarity?.toFixed(3) ?? 'n/a'}) — ${opts.candidate.summary}`
      )
      break
    }
    case 'SKIP_EMBEDDING_FAILED': {
      opts.debugLogs.push(
        `[Memory] SKIPPED ${opts.passLabel} — embedding generation failed: ${outcome.reason ?? 'unknown'}`
      )
      break
    }
    case 'REINFORCE': {
      if (outcome.memory) opts.reinforcedIds.push(outcome.memory.id)
      opts.debugLogs.push(
        `[Memory] REINFORCED ${opts.passLabel}: ${outcome.memory?.id ?? 'unknown'} ` +
        `(count ${outcome.memory?.reinforcementCount ?? 1}) — ${opts.candidate.summary}`
      )
      break
    }
    case 'INSERT_RELATED': {
      if (outcome.memory) opts.createdIds.push(outcome.memory.id)
      opts.debugLogs.push(
        `[Memory] Created ${opts.passLabel} (linked to ${outcome.relatedMemoryIds?.length || 0} related) — ` +
        `${opts.candidate.summary}`
      )
      break
    }
    case 'INSERT':
    case 'SKIP_GATE':
    default: {
      if (outcome.memory) opts.createdIds.push(outcome.memory.id)
      opts.debugLogs.push(
        `[Memory] Created ${opts.passLabel} — ${opts.candidate.summary}`
      )
      break
    }
  }
}

/**
 * Run all extraction passes for a single turn.
 */
export async function processTurnForMemory(
  ctx: TurnMemoryExtractionContext
): Promise<TurnMemoryProcessingResult> {
  const debugLogs: string[] = []
  const createdMemoryIds: string[] = []
  const reinforcedMemoryIds: string[] = []
  const collectedCandidates: ExtractedCandidate[] = []
  const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const sourceMessageId = ctx.transcript.latestAssistantMessageId

  try {
    if (ctx.transcript.characterSlices.length === 0) {
      debugLogs.push('[Memory] Turn has no character contributions — nothing to extract')
      return {
        success: true,
        memoriesCreatedCount: 0,
        memoriesReinforcedCount: 0,
        createdMemoryIds,
        reinforcedMemoryIds,
        usage: totalUsage,
        sourceMessageId,
        debugLogs,
        ...(ctx.dryRun ? { extractedCandidates: collectedCandidates } : {}),
      }
    }

    // Resolve cheap LLM selection ONCE for the whole turn — every pass reuses
    // the same provider so the cacheable prefix the rendered transcript
    // produces actually hits.
    const config = toCheapLLMConfig(ctx.cheapLLMSettings)
    let selection: CheapLLMSelection = getCheapLLMProvider(
      ctx.connectionProfile,
      config,
      ctx.availableProfiles || [],
      false
    )
    selection = resolveUncensoredCheapLLMSelection(
      selection,
      ctx.isDangerousChat ?? false,
      ctx.dangerSettings,
      ctx.availableProfiles ?? []
    )

    const uncensoredFallback: UncensoredFallbackOptions | undefined =
      ctx.dangerSettings && ctx.availableProfiles
        ? { dangerSettings: ctx.dangerSettings, availableProfiles: ctx.availableProfiles }
        : undefined

    const cheapMaxTokens = resolveMaxTokens(ctx.connectionProfile)

    // Pre-resolve per-character rate limits so we know which characters to
    // skip entirely, throttle, or allow before we start firing LLM calls.
    const rateLimits = new Map<string, RateLimitDecision>()
    for (const slice of ctx.transcript.characterSlices) {
      rateLimits.set(slice.characterId, await resolveExtractionRateLimit(slice.characterId, ctx.memoryExtractionLimits))
    }

    const allowedSlices = ctx.transcript.characterSlices.filter(s => {
      const rl = rateLimits.get(s.characterId)!
      if (rl.mode === 'skip') {
        debugLogs.push(
          `[Memory] SKIPPED extraction for ${s.characterName} — rate limit reached ` +
          `(${rl.recentCount}/${rl.cap} memories in last hour)`
        )
        return false
      }
      if (rl.mode === 'throttle') {
        debugLogs.push(
          `[Memory] THROTTLING ${s.characterName} — ${rl.recentCount}/${rl.cap}; floor ${rl.floor}`
        )
      }
      return true
    })

    // ---------------------------------------------------------------------
    // Pass 1: USER memories (one extraction call, written to every allowed
    // character so each one gets their own copy of facts about the user).
    // ---------------------------------------------------------------------
    if (
      ctx.transcript.userMessage !== null &&
      ctx.transcript.userCharacterId &&
      allowedSlices.length > 0
    ) {
      const userResult = await extractUserMemoriesFromTurn(
        ctx.transcript,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        cheapMaxTokens
      )

      if (userResult.usage) {
        totalUsage.promptTokens += userResult.usage.promptTokens
        totalUsage.completionTokens += userResult.usage.completionTokens
        totalUsage.totalTokens += userResult.usage.totalTokens
      }

      if (userResult.success) {
        const rawCandidates = userResult.result || []
        for (const slice of allowedSlices) {
          const rl = rateLimits.get(slice.characterId)!
          const candidates = rl.mode === 'throttle'
            ? applyImportanceFloor(rawCandidates, rl.floor)
            : rawCandidates
          if (rl.mode === 'throttle' && candidates.length < rawCandidates.length) {
            debugLogs.push(
              `[Memory] Throttle dropped ${rawCandidates.length - candidates.length} USER candidate(s) ` +
              `for ${slice.characterName} below importance ${rl.floor}`
            )
          }
          for (const candidate of candidates) {
            await writeCandidate({
              characterId: slice.characterId,
              characterName: slice.characterName,
              aboutCharacterId: ctx.transcript.userCharacterId,
              aboutCharacterName: ctx.transcript.userCharacterName ?? '',
              pass: 'USER',
              candidate,
              passLabel: `USER memory for ${slice.characterName}`,
              ctx,
              sourceMessageId: slice.contributingMessageIds[slice.contributingMessageIds.length - 1] ?? sourceMessageId,
              debugLogs,
              createdIds: createdMemoryIds,
              reinforcedIds: reinforcedMemoryIds,
              collected: collectedCandidates,
            })
          }
        }
      } else {
        debugLogs.push(`[Memory] USER memory extraction failed: ${userResult.error}`)
      }
    } else if (ctx.transcript.userMessage !== null && !ctx.transcript.userCharacterId) {
      debugLogs.push(
        '[Memory] Skipped USER memory pass — no user-controlled character on this chat. ' +
        'Add or create a user persona to start collecting memories about the operator.'
      )
      void emitNoUserCharacterWhisper(ctx.chatId)
    }

    // ---------------------------------------------------------------------
    // Pass 2: SELF memories (one call per allowed character).
    // ---------------------------------------------------------------------
    for (const slice of allowedSlices) {
      const rl = rateLimits.get(slice.characterId)!
      const selfResult = await extractSelfMemoriesFromTurn(
        ctx.transcript,
        slice.characterId,
        selection,
        ctx.userId,
        uncensoredFallback,
        ctx.chatId,
        cheapMaxTokens
      )

      if (selfResult.usage) {
        totalUsage.promptTokens += selfResult.usage.promptTokens
        totalUsage.completionTokens += selfResult.usage.completionTokens
        totalUsage.totalTokens += selfResult.usage.totalTokens
      }

      if (selfResult.success) {
        const rawCandidates = selfResult.result || []
        const candidates = rl.mode === 'throttle'
          ? applyImportanceFloor(rawCandidates, rl.floor)
          : rawCandidates
        if (rl.mode === 'throttle' && candidates.length < rawCandidates.length) {
          debugLogs.push(
            `[Memory] Throttle dropped ${rawCandidates.length - candidates.length} SELF candidate(s) ` +
            `for ${slice.characterName} below importance ${rl.floor}`
          )
        }
        for (const candidate of candidates) {
          await writeCandidate({
            characterId: slice.characterId,
            characterName: slice.characterName,
            aboutCharacterId: slice.characterId,
            aboutCharacterName: slice.characterName,
            pass: 'SELF',
            candidate,
            passLabel: `CHARACTER memory for ${slice.characterName}`,
            ctx,
            sourceMessageId: slice.contributingMessageIds[slice.contributingMessageIds.length - 1] ?? sourceMessageId,
            debugLogs,
            createdIds: createdMemoryIds,
            reinforcedIds: reinforcedMemoryIds,
            collected: collectedCandidates,
          })
        }
      } else {
        debugLogs.push(`[Memory] SELF memory extraction failed for ${slice.characterName}: ${selfResult.error}`)
      }
    }

    // ---------------------------------------------------------------------
    // Pass 3: INTER-CHARACTER memories (one call per (observer, subject) pair
    // among allowed characters; observer rate-limit gates the pair).
    // ---------------------------------------------------------------------
    if (allowedSlices.length >= 2) {
      for (const observer of allowedSlices) {
        const rl = rateLimits.get(observer.characterId)!
        for (const subject of allowedSlices) {
          if (subject.characterId === observer.characterId) continue
          const interResult = await extractInterCharacterMemoriesFromTurn(
            ctx.transcript,
            observer.characterId,
            subject.characterId,
            selection,
            ctx.userId,
            uncensoredFallback,
            ctx.chatId,
            cheapMaxTokens
          )

          if (interResult.usage) {
            totalUsage.promptTokens += interResult.usage.promptTokens
            totalUsage.completionTokens += interResult.usage.completionTokens
            totalUsage.totalTokens += interResult.usage.totalTokens
          }

          if (interResult.success) {
            const rawCandidates = interResult.result || []
            const candidates = rl.mode === 'throttle'
              ? applyImportanceFloor(rawCandidates, rl.floor)
              : rawCandidates
            if (rl.mode === 'throttle' && candidates.length < rawCandidates.length) {
              debugLogs.push(
                `[Memory] Throttle dropped ${rawCandidates.length - candidates.length} INTER candidate(s) ` +
                `for ${observer.characterName} about ${subject.characterName} below importance ${rl.floor}`
              )
            }
            for (const candidate of candidates) {
              await writeCandidate({
                characterId: observer.characterId,
                characterName: observer.characterName,
                aboutCharacterId: subject.characterId,
                aboutCharacterName: subject.characterName,
                pass: 'INTER',
                candidate,
                passLabel: `INTER memory ${observer.characterName} about ${subject.characterName}`,
                ctx,
                sourceMessageId: observer.contributingMessageIds[observer.contributingMessageIds.length - 1] ?? sourceMessageId,
                debugLogs,
                createdIds: createdMemoryIds,
                reinforcedIds: reinforcedMemoryIds,
                collected: collectedCandidates,
              })
            }
          } else {
            debugLogs.push(
              `[Memory] INTER extraction failed (${observer.characterName} → ${subject.characterName}): ${interResult.error}`
            )
          }
        }
      }
    }

    return {
      success: true,
      memoriesCreatedCount: createdMemoryIds.length,
      memoriesReinforcedCount: reinforcedMemoryIds.length,
      createdMemoryIds,
      reinforcedMemoryIds,
      usage: totalUsage,
      sourceMessageId,
      debugLogs,
      ...(ctx.dryRun ? { extractedCandidates: collectedCandidates } : {}),
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('[Memory] Turn processing error', { chatId: ctx.chatId, userId: ctx.userId }, error instanceof Error ? error : undefined)
    return {
      success: false,
      memoriesCreatedCount: 0,
      memoriesReinforcedCount: 0,
      createdMemoryIds,
      reinforcedMemoryIds,
      usage: totalUsage,
      sourceMessageId,
      debugLogs,
      ...(ctx.dryRun ? { extractedCandidates: collectedCandidates } : {}),
      error: errorMsg,
    }
  }
}

/**
 * Re-export the slice type so callers can avoid importing from turn-transcript directly.
 */
export type { TurnTranscript, TurnCharacterSlice }
