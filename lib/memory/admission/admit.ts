/**
 * `admitCandidate` — how a memory enters the Commonplace Book (memory
 * refactor §3.6).
 *
 * Two halves, split across processes:
 *
 *  1. **Wherever it is called** (the job child for an extraction, the parent
 *     for the Memories API): the candidate becomes its row, passes the safety
 *     nets (`prepare.ts`), and is embedded — the expensive part, one retry.
 *     A candidate that cannot be embedded is rejected; nothing is written
 *     (invariant 4).
 *  2. **In the parent** ({@link admitPrepared}): top-K search over both tiers,
 *     hydrate, {@link decideAdmission}, write, update the index, publish
 *     `memories`. From the child this is one host-RPC call (`admitMemory`), so
 *     every admission reads and writes the real rows on the read-write
 *     connection: a second candidate in the same job sees the first's row and
 *     reinforces it instead of inserting a twin (bug 209), and the count moves
 *     only through the atomic `incrementReinforcement`.
 *
 * Dry run: the same search and decision, no writes; the outcome names what
 * would have happened.
 *
 * @module memory/admission/admit
 */

import type { Memory } from '@/lib/schemas/types'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { generateEmbeddingForUser, EmbeddingError } from '@/lib/embedding/embedding-service'
import { trackActivity } from '@/lib/background-jobs/activity-registry'
import { publishRealtime } from '@/lib/realtime/bus'
import { embeddingTextFor, memoryIndex } from '../index-store'
import { refreshMemoryTimeZone } from '../time/calendar-refresh'
import { ADMISSION_THRESHOLDS } from '../settings-defaults'
import { toAdmissionRow, type MemoryCandidate, type ResolvedCandidateTime } from '../candidate'
import { decideAdmission } from './decide'
import { foldInto } from './fold'
import { gatherNeighbours } from './neighbours'
import { applyEpisodicFallbackAnchors, applyNamePresenceCheck } from './prepare'
import { applyFold, insertRow, linkBothWays, raiseImportance, withoutEmbedding } from './apply'
import { maybeEnqueueHousekeeping } from './after-insert'
import { admissionInserted } from './outcome'
import type { AdmissionAction, AdmissionOutcome, AdmissionRow, AdmissionTrace } from './types'

const log = logger.child({ module: 'memory:admission' })

/** Milliseconds before the one embedding retry. */
const EMBEDDING_RETRY_DELAY_MS = 500

/** Entity bound on a folded row (the candidate schema's). */
const ENTITY_CAP = 12

export interface AdmitOptions {
  userId: string
  embeddingProfileId?: string
  /** Search and decide, write nothing. */
  dryRun?: boolean
}

/** What the child hands the parent over host-RPC (`admitMemory`). Structured-clone safe. */
export interface AdmitPreparedRequest {
  row: AdmissionRow
  embedding: Float32Array
  userId: string
  embeddingProfileId?: string
  dryRun: boolean
  embeddingAttempts: number
  notes: string[]
}

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

function emptyTrace(notes: string[], embeddingAttempts: number): AdmissionTrace {
  return {
    thresholds: ADMISSION_THRESHOLDS,
    assessments: [],
    embeddingAttempts,
    orphansIgnored: 0,
    searchedK: 0,
    notes,
  }
}

function rejected(reason: 'embedding-failed' | 'empty', notes: string[], attempts: number, dryRun: boolean): AdmissionOutcome {
  return {
    action: { kind: 'reject', reason },
    memory: null,
    novelDetails: [],
    linkedIds: [],
    dryRun,
    trace: emptyTrace(notes, attempts),
  }
}

/** Embed the row as it will be stored (anchor line included), one retry. */
async function embedRow(
  row: AdmissionRow,
  timeZone: string,
  opts: AdmitOptions,
  notes: string[],
): Promise<{ embedding: Float32Array | null; attempts: number }> {
  const text = embeddingTextFor(row, timeZone)
  const describe = (e: unknown) => (e instanceof EmbeddingError ? e.message : String(e))
  try {
    const { embedding } = await generateEmbeddingForUser(text, opts.userId, opts.embeddingProfileId, { priority: 'background' })
    return { embedding, attempts: 1 }
  } catch (first) {
    notes.push(`embedding attempt 1 failed (${describe(first)})`)
    try {
      await new Promise((resolve) => setTimeout(resolve, EMBEDDING_RETRY_DELAY_MS))
      const { embedding } = await generateEmbeddingForUser(text, opts.userId, opts.embeddingProfileId, { priority: 'background' })
      return { embedding, attempts: 2 }
    } catch (second) {
      notes.push(`embedding failed after retry (${describe(second)})`)
      log.warn('Memory not admitted: embedding failed after retry', {
        characterId: row.characterId,
        userId: opts.userId,
        error: describe(second),
      })
      return { embedding: null, attempts: 2 }
    }
  }
}

/**
 * Admit one candidate. The only way an AUTO row is created (invariant 4); the
 * Memories API's hand-written rows come through here too.
 */
export async function admitCandidate(
  candidate: MemoryCandidate,
  resolved: ResolvedCandidateTime,
  opts: AdmitOptions,
): Promise<AdmissionOutcome> {
  return admitRow(toAdmissionRow(candidate, resolved), opts)
}

/** {@link admitCandidate} for a row already built from a candidate. */
export async function admitRow(row: AdmissionRow, opts: AdmitOptions): Promise<AdmissionOutcome> {
  // Memories formed outside a job (a tool call, the API) have no job row to
  // count them, so admission registers itself. Re-entrant by kind.
  return trackActivity('memory', async () => {
    const notes: string[] = []
    const dryRun = opts.dryRun === true
    if (!row.content?.trim() || !row.summary?.trim()) {
      log.debug('Memory not admitted: empty text', { characterId: row.characterId })
      return rejected('empty', notes, 0, dryRun)
    }

    const timeZone = await refreshMemoryTimeZone()
    let prepared = await applyNamePresenceCheck(row, notes)
    prepared = applyEpisodicFallbackAnchors(prepared, timeZone)

    const { embedding, attempts } = await embedRow(prepared, timeZone, opts, notes)
    if (!embedding) return rejected('embedding-failed', notes, attempts, dryRun)

    const request: AdmitPreparedRequest = {
      row: prepared,
      embedding,
      userId: opts.userId,
      embeddingProfileId: opts.embeddingProfileId,
      dryRun,
      embeddingAttempts: attempts,
      notes,
    }
    let outcome: AdmissionOutcome
    if (isJobChild()) {
      const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client')
      outcome = await callHost<AdmissionOutcome>('admitMemory', request)
    } else {
      outcome = await admitPrepared(request)
    }

    if (!outcome.dryRun && admissionInserted(outcome)) {
      // Fire-and-forget; never blocks the write that just landed.
      void maybeEnqueueHousekeeping(prepared.characterId, opts.userId)
    }
    return outcome
  })
}

/** Tell the job child its cache of this character's vectors is stale. Best-effort. */
async function notifyChildIndexChanged(characterId: string): Promise<void> {
  try {
    const { notifyChild } = await import('@/lib/background-jobs/host/processor-host')
    notifyChild('vectorStore', characterId)
  } catch (error) {
    log.debug('Could not notify the job child of an index change', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The parent half: search, decide, write. Never call it from the job child —
 * `admitRow` reaches it over host-RPC.
 */
export async function admitPrepared(request: AdmitPreparedRequest): Promise<AdmissionOutcome> {
  if (isJobChild()) {
    throw new Error('admitPrepared runs in the parent; the job child admits through host-RPC (admitMemory)')
  }
  const { row, embedding, userId, embeddingProfileId, dryRun } = request
  const notes = [...request.notes]
  const characterId = row.characterId
  const thresholds = ADMISSION_THRESHOLDS

  const gathered = await gatherNeighbours(characterId, embedding)
  const decision = decideAdmission({
    candidate: {
      holderId: characterId,
      aboutId: row.aboutCharacterId,
      kind: row.kind,
      source: row.source,
      occurredAt: row.occurredAt,
    },
    neighbours: gathered.neighbours,
    thresholds,
  })
  const action = decision.action
  const trace: AdmissionTrace = {
    thresholds,
    assessments: decision.assessments,
    embeddingAttempts: request.embeddingAttempts,
    orphansIgnored: gathered.orphanIds.length,
    searchedK: gathered.searchedK,
    notes,
  }
  const neighbourById = new Map(gathered.neighbours.map((n) => [n.memory.id, n.memory]))

  if (dryRun) {
    const target = 'into' in action ? neighbourById.get(action.into) ?? null : null
    log.debug('Admission dry run', { characterId, action: action.kind })
    return {
      action,
      memory: target ? withoutEmbedding(target) : null,
      novelDetails: [],
      linkedIds: action.kind === 'insert-linked' ? action.linkTo : [],
      dryRun: true,
      trace,
    }
  }

  const outcome = await applyAction(action, row, embedding, neighbourById, { userId, embeddingProfileId }, notes)
  if (outcome.memory) {
    publishRealtime('memories')
    void notifyChildIndexChanged(characterId)
  }
  if (admissionInserted({ action })) {
    // The consolidation watermark counts the row just written (it used to run
    // from the job dispatcher's commit hook, when admission buffered its rows).
    void import('../consolidation-triggers')
      .then((mod) => mod.maybeEnqueueConsolidationForCharacters([characterId]))
      .catch((error) => log.debug('Consolidation watermark check skipped after admission', { characterId, error: String(error) }))
  }

  log.debug('Memory admitted', {
    characterId,
    action: action.kind,
    memoryId: outcome.memory?.id ?? null,
    neighbours: gathered.neighbours.length,
    bestCosine: gathered.neighbours[0]?.cosine ?? null,
    novelDetails: outcome.novelDetails.length,
    linked: outcome.linkedIds.length,
  })
  return { ...outcome, dryRun: false, trace }
}

async function applyAction(
  action: AdmissionAction,
  row: AdmissionRow,
  embedding: Float32Array,
  neighbours: ReadonlyMap<string, Memory>,
  opts: { userId: string; embeddingProfileId?: string },
  notes: string[],
): Promise<Omit<AdmissionOutcome, 'dryRun' | 'trace'>> {
  const none = { novelDetails: [] as string[], linkedIds: [] as string[] }
  switch (action.kind) {
    case 'reject':
      return { action, memory: null, ...none }

    case 'insert': {
      const memory = await insertRow(row, embedding)
      return { action, memory: withoutEmbedding(memory), ...none }
    }

    case 'insert-linked': {
      const memory = await insertRow(row, embedding)
      const linkedIds = await linkBothWays(row.characterId, memory.id, action.linkTo)
      // The post-link row: callers that union `relatedMemoryIds` must start
      // from the links written here (bug 26).
      return { action, memory: withoutEmbedding({ ...memory, relatedMemoryIds: linkedIds }), novelDetails: [], linkedIds }
    }

    case 'absorb':
    case 'reinforce':
    case 'promote-and-reinforce': {
      let target = neighbours.get(action.into)
      if (!target) {
        // The decider only names neighbours it was shown.
        throw new Error(`Admission target ${action.into} is not among the gathered neighbours`)
      }
      if (action.kind === 'promote-and-reinforce') {
        // The world asked for a cap-demoted row again: back to the hot tier.
        await memoryIndex.setTier(target.characterId, [target.id], 'hot', { supersededById: null })
        target = { ...target, tier: 'hot', supersededById: null }
        notes.push(`promoted cold row ${target.id} to hot`)
      }

      const withFootnotes =
        action.kind === 'reinforce' || (action.kind === 'promote-and-reinforce' && action.withFootnotes)
      let memory: Memory | null
      let novelDetails: string[] = []
      if (withFootnotes) {
        // The one combine: the candidate is a source of one observation.
        const plan = foldInto(
          target,
          [{
            content: row.content,
            occurredAt: row.occurredAt,
            narrativeTime: row.narrativeTime,
            entities: row.entities,
            reinforcementCount: 1,
            lastReinforcedAt: new Date().toISOString(),
          }],
          { footnoteCap: ADMISSION_THRESHOLDS.footnoteCap, entityCap: ENTITY_CAP },
        )
        memory = await applyFold(target, plan, opts)
        novelDetails = memory ? plan.footnotes : []
      } else {
        // Count only: a near-duplicate's text and vector stay as they are.
        const counted = await getRepositories().memories.incrementReinforcement(
          target.characterId,
          target.id,
          new Date().toISOString(),
          1,
        )
        memory = counted ? { ...target, ...counted } : null
      }
      if (!memory) {
        notes.push(`target ${action.into} vanished before the write`)
        log.warn('Admission target vanished before the write; nothing counted', { memoryId: action.into })
        return { action, memory: null, ...none }
      }
      if (row.source === 'MANUAL') memory = await raiseImportance(memory, row.importance)
      return { action, memory: withoutEmbedding(memory), novelDetails, linkedIds: [] }
    }
  }
}
