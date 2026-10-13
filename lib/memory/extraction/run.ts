/**
 * The pass runner (memory refactor §3.7): one way a pass's model output
 * becomes memories.
 *
 * A pass ({@link ExtractionPass}) says which cheap-LLM calls it makes over a
 * window and how to read each answer. {@link runPass} does the rest, the same
 * for every pass: rate limit, call, parse (the pass's cap), floor, candidate,
 * event time, admission. In a dry run admission decides and writes nothing, so
 * the candidate list and the decisions are exactly what live extraction would
 * produce from the same model output (invariant 10).
 *
 * @module memory/extraction/run
 */

import type { LLMMessage } from '@/lib/llm/base'
import { logger } from '@/lib/logger'
import { executeCheapLLMTask } from '../cheap-llm-tasks/core-execution'
import type { MemoryDraft } from '../cheap-llm-tasks/types'
import { admitCandidate, admissionInserted, describeAdmission, type AdmissionOutcome } from '../admission'
import { anchorTimeMsFrom, candidateFromDraft, type CandidatePass, type MemoryCandidate } from '../candidate'
import { resolveEpisodicAnchors } from '../time/anchors'
import { applyImportanceFloor, type RateLimitDecision } from './rate-limit'
import type { CastMember, ExtractionContext } from './context'
import type { TranscriptWindow } from './window'

export type ExtractionPassName = 'self-turn' | 'other-turn' | 'other-fold' | 'episode-fold'

/**
 * One parsed group of drafts and who they become memories for. A SELF draft is
 * the holder's about themselves (`aboutId` null); an OTHER draft the
 * observer's about one subject; an episode is written for every holder.
 */
export interface DraftBatch {
  holders: CastMember[]
  /** Null: about the holder. */
  about: CastMember | null
  drafts: MemoryDraft[]
  /** Pass floor before the rate limit's (the hybrid mode's per-turn OTHER floor). */
  floor?: { value: number; reason: string } | null
  /** The message the memory cites, and its time (the row's `createdAt`). */
  source: { messageId: string | null; createdAt: string | null }
  /** What a `when` phrase resolves against, and what `occurredAt` falls back to. */
  anchors: { referenceIso: string | null; fallbackIso: string | null }
}

/** One cheap-LLM call a pass makes. */
export interface PassCall {
  /** For logs and debug lines (`SELF memory for Amy`). */
  label: string
  /** The characters the call's memories are for; a skip for every one of them skips the call. */
  holders: CastMember[]
  messages: LLMMessage[]
  /** Attribution for the LLM log. */
  logCharacterId?: string
  /** Read the answer into draft batches (the pass's cap applied). */
  parse(raw: string): DraftBatch[]
}

export interface ExtractionPass {
  name: ExtractionPassName
  /** The candidate provenance (`carina` for an answer run on `self-turn`). */
  candidatePass: CandidatePass
  /** The cheap-LLM task type logged with every call. */
  taskType: string
  /** The calls over a window (none when the window holds nothing for this pass). */
  calls(ctx: ExtractionContext, window: TranscriptWindow): Promise<PassCall[]>
  /** After a batch's candidates are admitted (the episode pass links its fragments here). */
  afterBatch?(ctx: ExtractionContext, window: TranscriptWindow, admitted: AdmittedCandidate[]): Promise<void>
}

/** One candidate a pass produced, and what admission did (or, in a dry run, would do) with it. */
export interface AdmittedCandidate {
  candidate: MemoryCandidate
  occurredAt: string | null
  narrativeTime: string | null
  holderName: string
  aboutName: string
  outcome: AdmissionOutcome
}

export interface PassResult {
  pass: ExtractionPassName
  calls: number
  /** Calls lost to a cheap-LLM timeout — work that never happened (bug 107). */
  timedOut: number
  /** Calls that failed otherwise (a refusal, an unparseable answer). */
  failed: number
  admitted: AdmittedCandidate[]
  createdIds: string[]
  reinforcedIds: string[]
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  debugLogs: string[]
  /**
   * Set when a `deferOnRateLimit` run made no call because one of its calls'
   * holders were all at the hourly cap: the window was not read, and a fold
   * must not move its cursor past it.
   */
  rateDeferred: boolean
}

export interface RunPassOptions {
  /**
   * Make no call at all when any call's holders are all at the rate limit's
   * cap, and report `rateDeferred` (the fold passes: a skipped call there
   * would otherwise pass for a read slice and its messages would never be
   * read again). The turn passes leave this off — a capped holder simply
   * forms nothing from that turn.
   */
  deferOnRateLimit?: boolean
}

export function emptyPassResult(pass: ExtractionPassName): PassResult {
  return {
    pass,
    calls: 0,
    timedOut: 0,
    failed: 0,
    admitted: [],
    createdIds: [],
    reinforcedIds: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    debugLogs: [],
    rateDeferred: false,
  }
}

/** Fold `next` into `into` (same pass or not); returns `into`. */
export function mergePassResult(into: PassResult, next: PassResult): PassResult {
  into.calls += next.calls
  into.timedOut += next.timedOut
  into.failed += next.failed
  into.admitted.push(...next.admitted)
  into.createdIds.push(...next.createdIds)
  into.reinforcedIds.push(...next.reinforcedIds)
  into.usage.promptTokens += next.usage.promptTokens
  into.usage.completionTokens += next.usage.completionTokens
  into.usage.totalTokens += next.usage.totalTokens
  into.debugLogs.push(...next.debugLogs)
  into.rateDeferred = into.rateDeferred || next.rateDeferred
  return into
}

function describeLimit(member: CastMember, rl: RateLimitDecision): string | null {
  if (rl.mode === 'skip') {
    return `[Memory] SKIPPED extraction for ${member.name} — rate limit reached (${rl.recentCount}/${rl.cap} memories in last hour)`
  }
  if (rl.mode === 'throttle') {
    return `[Memory] THROTTLING ${member.name} — ${rl.recentCount}/${rl.cap}; floor ${rl.floor}`
  }
  return null
}

/**
 * Run one pass over one window: extract → cap → floor → admit (or decide only,
 * in a dry run). Never throws for a model failure; a timeout is counted in
 * `timedOut` so the caller can fail its job for a retry.
 */
export async function runPass(
  pass: ExtractionPass,
  ctx: ExtractionContext,
  window: TranscriptWindow,
  opts: RunPassOptions = {},
): Promise<PassResult> {
  const result = emptyPassResult(pass.name)
  const calls = await pass.calls(ctx, window)

  if (opts.deferOnRateLimit) {
    for (const call of calls) {
      if (call.holders.length === 0) continue
      const decisions = await Promise.all(call.holders.map(h => ctx.rateLimit.decide(h.characterId)))
      if (decisions.every(d => d.mode === 'skip')) {
        result.rateDeferred = true
        result.debugLogs.push(`[Memory] ${call.label} deferred — every holder is at the hourly cap; the window is left unread`)
        logger.info('[Memory] Pass deferred by the rate limit; window left unread', {
          chatId: ctx.chat.id,
          pass: pass.name,
          call: call.label,
        })
        return result
      }
    }
  }

  for (const call of calls) {
    // The rate limit gates each holder; a call none of its holders may use is not made.
    const limits = new Map<string, RateLimitDecision>()
    for (const holder of call.holders) {
      const rl = await ctx.rateLimit.decide(holder.characterId)
      limits.set(holder.characterId, rl)
      const line = describeLimit(holder, rl)
      if (line) result.debugLogs.push(line)
    }
    if (call.holders.length > 0 && call.holders.every(h => limits.get(h.characterId)?.mode === 'skip')) {
      logger.debug('[Memory] Call skipped: every holder is rate-limited', { chatId: ctx.chat.id, pass: pass.name, call: call.label })
      continue
    }

    result.calls++
    const answer = await executeCheapLLMTask(
      ctx.route.cheapLLM,
      call.messages,
      ctx.userId,
      (raw: string) => call.parse(raw),
      pass.taskType,
      ctx.chat.id,
      undefined,
      ctx.route.uncensoredFallback ?? undefined,
      ctx.route.maxTokens,
      call.logCharacterId,
    )
    if (answer.usage) {
      result.usage.promptTokens += answer.usage.promptTokens
      result.usage.completionTokens += answer.usage.completionTokens
      result.usage.totalTokens += answer.usage.totalTokens
    }
    if (!answer.success) {
      if (answer.timedOut) result.timedOut++
      else result.failed++
      result.debugLogs.push(
        `[Memory] ${call.label} ${answer.timedOut ? 'was LOST to a timeout, not refused' : 'failed'}: ${answer.error}`,
      )
      logger.warn('[Memory] Extraction call failed', {
        chatId: ctx.chat.id,
        pass: pass.name,
        call: call.label,
        timedOut: answer.timedOut === true,
        error: answer.error,
      })
      continue
    }

    for (const batch of answer.result ?? []) {
      const admitted = await admitBatch(pass, ctx, batch, limits, call.label, result)
      if (pass.afterBatch && admitted.length > 0) await pass.afterBatch(ctx, window, admitted)
    }
  }

  logger.debug('[Memory] Pass complete', {
    chatId: ctx.chat.id,
    pass: pass.name,
    dryRun: ctx.dryRun,
    calls: result.calls,
    timedOut: result.timedOut,
    candidates: result.admitted.length,
    created: result.createdIds.length,
    reinforced: result.reinforcedIds.length,
  })
  return result
}

async function admitBatch(
  pass: ExtractionPass,
  ctx: ExtractionContext,
  batch: DraftBatch,
  limits: ReadonlyMap<string, RateLimitDecision>,
  callLabel: string,
  result: PassResult,
): Promise<AdmittedCandidate[]> {
  let drafts = batch.drafts
  const aboutName = batch.about?.name
  if (batch.floor) {
    const floored = applyImportanceFloor(drafts, batch.floor.value)
    if (floored.length < drafts.length) {
      result.debugLogs.push(
        `[Memory] ${batch.floor.reason} dropped ${drafts.length - floored.length} candidate(s) ` +
        `(${callLabel}${aboutName ? ` about ${aboutName}` : ''}) below importance ${batch.floor.value}`,
      )
    }
    drafts = floored
  }

  const admitted: AdmittedCandidate[] = []
  for (const holder of batch.holders) {
    const rl = limits.get(holder.characterId) ?? { mode: 'allow' as const }
    if (rl.mode === 'skip') continue
    const kept = rl.mode === 'throttle' ? applyImportanceFloor(drafts, rl.floor) : drafts
    if (rl.mode === 'throttle' && kept.length < drafts.length) {
      result.debugLogs.push(
        `[Memory] Throttle dropped ${drafts.length - kept.length} candidate(s) for ${holder.name}` +
        `${aboutName ? ` about ${aboutName}` : ''} below importance ${rl.floor}`,
      )
    }
    const label = batch.about
      ? `${callLabel} — ${holder.name} about ${batch.about.name}`
      : batch.holders.length > 1 ? `${callLabel} — for ${holder.name}` : callLabel
    result.debugLogs.push(`[Memory] ${label}: ${kept.length} candidate(s)`)

    for (const draft of kept) {
      const one = await admitDraft(pass, ctx, batch, holder, draft, label, result)
      if (one) admitted.push(one)
    }
  }
  return admitted
}

async function admitDraft(
  pass: ExtractionPass,
  ctx: ExtractionContext,
  batch: DraftBatch,
  holder: CastMember,
  draft: MemoryDraft,
  label: string,
  result: PassResult,
): Promise<AdmittedCandidate | null> {
  const anchorIsos = [batch.anchors.referenceIso, batch.anchors.fallbackIso]
  const anchorTimeMs = anchorTimeMsFrom(anchorIsos)
  const anchorIso = anchorIsos.find((iso): iso is string => !!iso && Number.isFinite(Date.parse(iso)))
    ?? new Date(anchorTimeMs).toISOString()
  const fallbackIso = batch.anchors.fallbackIso && Number.isFinite(Date.parse(batch.anchors.fallbackIso))
    ? batch.anchors.fallbackIso
    : anchorIso
  const { occurredAt, narrativeTime } = resolveEpisodicAnchors({
    when: draft.when,
    referenceIso: anchorIso,
    fallbackIso,
    timelineMode: ctx.clock.timelineMode,
    narrativeTime: draft.narrativeTime,
    timeZone: ctx.clock.timeZone,
  })

  const candidate = candidateFromDraft(
    draft,
    { holderId: holder.characterId, aboutId: batch.about?.characterId ?? null },
    {
      source: 'AUTO',
      witnessedContext: ctx.inAutonomousRoom ? 'autonomous_room' : 'user_present',
      chatId: ctx.chat.id,
      projectId: ctx.project.id,
      sourceMessageId: batch.source.messageId,
      anchorTimeMs,
      pass: pass.candidatePass,
    },
  )
  if (!candidate) {
    result.debugLogs.push(`[Memory] ${label} — skipped a draft with no usable text`)
    return null
  }

  const createdAt = batch.source.createdAt && Number.isFinite(Date.parse(batch.source.createdAt))
    ? batch.source.createdAt
    : undefined
  // One candidate's failed admission costs that candidate alone, never the
  // holder's other candidates, the batch's other holders or the rest of the pass.
  let outcome: AdmissionOutcome
  try {
    outcome = await admitCandidate(
      candidate,
      { occurredAt, narrativeTime, sourceMessageTimestamp: createdAt },
      { userId: ctx.userId, ...(ctx.dryRun ? { dryRun: true } : {}), ...(ctx.backfill ? { backfill: true } : {}) },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('[Memory] Admission failed for one candidate; continuing', {
      chatId: ctx.chat.id,
      pass: pass.name,
      holderId: holder.characterId,
      error: message,
    })
    result.debugLogs.push(`[Memory] ${label} — admission failed (${message}): ${candidate.summary}`)
    return null
  }

  const action = outcome.action
  if (admissionInserted(outcome)) {
    ctx.rateLimit.record(holder.characterId)
    if (outcome.memory && !ctx.dryRun) result.createdIds.push(outcome.memory.id)
  } else if (
    outcome.memory &&
    !ctx.dryRun &&
    (action.kind === 'reinforce' || (action.kind === 'promote-and-reinforce' && action.withFootnotes))
  ) {
    // A near-duplicate absorption counts on its row but adds no detail; the debug line reports it.
    result.reinforcedIds.push(outcome.memory.id)
  }
  result.debugLogs.push(
    ctx.dryRun
      ? `[Memory] DRY-RUN ${label} — would ${action.kind}: ${candidate.summary}`
      : describeAdmission(outcome, label, candidate.summary),
  )

  const admitted: AdmittedCandidate = {
    candidate,
    occurredAt,
    narrativeTime,
    holderName: holder.name,
    aboutName: batch.about?.name ?? holder.name,
    outcome,
  }
  result.admitted.push(admitted)
  return admitted
}
