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
 * Three guards keep the parent half honest:
 *
 *  - **One admission per character at a time.** Search → decide → write spans
 *    several awaits; two jobs admitting for one character would each miss the
 *    other's new row and both insert. A per-character lock serialises them.
 *  - **A retried job does not count twice.** Admission commits at once, outside
 *    the job's write batch, so a job that fails after admitting and is retried
 *    would otherwise reinforce the same observations again. From the child each
 *    admission carries a key (`jobId : content : occurrence-in-attempt`); the
 *    parent remembers the outcome per key and answers a repeat from memory.
 *  - **A target that vanishes is not a lost observation.** If the row the
 *    decision folded into is retired before the write lands, admission decides
 *    once more against the index as it now stands, and inserts if the target
 *    vanishes again.
 *
 * @module memory/admission/admit
 */

import { createHash } from 'node:crypto'
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
import { foldInto, FOLD_CAPS } from './fold'
import { ADMISSION_TOP_K, gatherNeighbours, type NeighbourProbe } from './neighbours'
import { bookNeighbours, recordBookInsert, type DryRunBook } from './dry-run-book'
import { applyEpisodicFallbackAnchors, applyNamePresenceCheck } from './prepare'
import { applyFold, insertRow, raiseImportance, withoutEmbedding } from './apply'
import { linkBothWays } from './links'
import { maybeEnqueueHousekeeping } from './after-insert'
import { admissionInserted } from './outcome'
import { recordAdmissionInsert } from './rate-ledger'
import type { AdmissionAction, AdmissionOutcome, AdmissionRow, AdmissionTrace } from './types'
import { processSingleton } from '@/lib/utils/process-singleton'

const log = logger.child({ module: 'memory:admission' })

/** Milliseconds before the one embedding retry. */
const EMBEDDING_RETRY_DELAY_MS = 500

/** How long the parent remembers a keyed admission's outcome (covers a job's retries). */
const ADMISSION_LEDGER_TTL_MS = 24 * 60 * 60 * 1000
/** Most keyed outcomes the parent keeps; the oldest go first. */
const ADMISSION_LEDGER_MAX = 5000

export interface AdmitOptions {
  userId: string
  /**
   * Decide and return without writing (the extraction dry run). The candidate
   * is still embedded and its neighbours searched, so the outcome names the
   * action live admission would take; nothing is inserted, folded, linked or
   * counted, and the outcome's `memory` is the row it would fold into (null
   * for an insert).
   */
  dryRun?: boolean
  /** A rebuild of history: the insert is not counted towards the extraction rate limit. */
  backfill?: boolean
  /**
   * With `dryRun`, in the parent: the dry run's scratch book — rows the
   * regenerate would retire are searched past, and this run's would-be
   * inserts are neighbours too (`dry-run-book.ts`).
   */
  dryRunBook?: DryRunBook
}

/** What the child hands the parent over host-RPC (`admitMemory`). Structured-clone safe. */
export interface AdmitPreparedRequest {
  row: AdmissionRow
  embedding: Float32Array
  userId: string
  embeddingAttempts: number
  notes: string[]
  /** `jobId:content:n` from the job child; absent outside a job. */
  idempotencyKey?: string | null
  /** Decide only; see {@link AdmitOptions.dryRun}. */
  dryRun?: boolean
  /** Not counted towards the rate limit; see {@link AdmitOptions.backfill}. */
  backfill?: boolean
}

/** The candidate's text, for neighbours the index cannot compare (bug 237). */
function neighbourProbe(row: AdmissionRow, userId: string): NeighbourProbe {
  return { text: `${row.summary}\n${row.content}`, userId }
}

function isJobChild(): boolean {
  return process.env.QUILLTAP_JOB_CHILD === '1'
}

function rejected(reason: 'embedding-failed' | 'empty', notes: string[], attempts: number): AdmissionOutcome {
  return {
    action: { kind: 'reject', reason },
    memory: null,
    novelDetails: [],
    linkedIds: [],
    trace: {
      thresholds: ADMISSION_THRESHOLDS,
      assessments: [],
      embeddingAttempts: attempts,
      orphansIgnored: 0,
      searchedK: 0,
      notes,
    },
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
    const { embedding } = await generateEmbeddingForUser(text, opts.userId, undefined, { priority: 'background' })
    return { embedding, attempts: 1 }
  } catch (first) {
    notes.push(`embedding attempt 1 failed (${describe(first)})`)
    try {
      await new Promise((resolve) => setTimeout(resolve, EMBEDDING_RETRY_DELAY_MS))
      const { embedding } = await generateEmbeddingForUser(text, opts.userId, undefined, { priority: 'background' })
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

/** A stable key for what a row says and whom it is about (not where it came from in time). */
export function admissionContentKey(row: AdmissionRow): string {
  return createHash('sha1')
    .update(JSON.stringify([
      row.characterId,
      row.aboutCharacterId ?? null,
      row.kind ?? 'semantic',
      row.source ?? 'MANUAL',
      row.summary,
      row.content,
      row.sourceMessageId ?? null,
      row.occurredAt ?? null,
    ]))
    .digest('hex')
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
    if (!row.content?.trim() || !row.summary?.trim()) {
      log.debug('Memory not admitted: empty text', { characterId: row.characterId })
      return rejected('empty', notes, 0)
    }

    const timeZone = await refreshMemoryTimeZone()
    let prepared = await applyNamePresenceCheck(row, notes)
    prepared = applyEpisodicFallbackAnchors(prepared, timeZone)

    const { embedding, attempts } = await embedRow(prepared, timeZone, opts, notes)
    if (!embedding) return rejected('embedding-failed', notes, attempts)

    const request: AdmitPreparedRequest = {
      row: prepared,
      embedding,
      userId: opts.userId,
      embeddingAttempts: attempts,
      notes,
      ...(opts.dryRun ? { dryRun: true } : {}),
      ...(opts.backfill ? { backfill: true } : {}),
    }
    let outcome: AdmissionOutcome
    if (opts.dryRun && !isJobChild()) {
      outcome = await decideOnly(request, opts.dryRunBook)
    } else if (isJobChild()) {
      // A dry run writes nothing, so it carries no idempotency key.
      if (!opts.dryRun) {
        const { nextAdmissionKey } = await import('@/lib/background-jobs/child/child-repositories-proxy')
        request.idempotencyKey = nextAdmissionKey(admissionContentKey(prepared))
      }
      const { callHost } = await import('@/lib/background-jobs/child/host-rpc-client')
      outcome = await callHost<AdmissionOutcome>('admitMemory', request)
    } else {
      outcome = await admitPrepared(request)
    }

    if (admissionInserted(outcome) && !opts.dryRun) {
      // Fire-and-forget; never blocks the write that just landed.
      void maybeEnqueueHousekeeping(prepared.characterId, opts.userId)
    }
    return outcome
  })
}

// ---------------------------------------------------------------------------
// Parent-side guards
// ---------------------------------------------------------------------------

/** Tail of each character's admission chain. */
const characterLocks = processSingleton('memory.admission.characterLocks', () => new Map<string, Promise<void>>())

/** Run `fn` after every earlier admission for this character has finished. */
async function withCharacterLock<T>(characterId: string, fn: () => Promise<T>): Promise<T> {
  const prior = characterLocks.get(characterId) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((resolve) => { release = resolve })
  const tail = prior.then(() => mine)
  characterLocks.set(characterId, tail)
  await prior
  try {
    return await fn()
  } finally {
    release()
    if (characterLocks.get(characterId) === tail) characterLocks.delete(characterId)
  }
}

/** Outcomes of keyed admissions, oldest first (Map keeps insertion order). */
const admissionLedger = processSingleton('memory.admission.ledger', () => new Map<string, { outcome: AdmissionOutcome; at: number }>())

function recallAdmission(key: string, now: number): AdmissionOutcome | null {
  const entry = admissionLedger.get(key)
  if (!entry) return null
  if (now - entry.at > ADMISSION_LEDGER_TTL_MS) {
    admissionLedger.delete(key)
    return null
  }
  return entry.outcome
}

function recordAdmission(key: string, outcome: AdmissionOutcome, now: number): void {
  admissionLedger.set(key, { outcome, at: now })
  for (const [oldest, entry] of admissionLedger) {
    if (admissionLedger.size <= ADMISSION_LEDGER_MAX && now - entry.at <= ADMISSION_LEDGER_TTL_MS) break
    admissionLedger.delete(oldest)
  }
}

/** Test hook. */
export function resetAdmissionStateForTests(): void {
  characterLocks.clear()
  admissionLedger.clear()
}

/**
 * Hand the job child the vectors and tiers just written, so its cache is
 * patched rather than dropped. Best-effort.
 */
async function patchChildIndex(characterId: string, entries: IndexEntry[]): Promise<void> {
  if (entries.length === 0) return
  try {
    const { patchChildMemoryIndex } = await import('@/lib/background-jobs/host/processor-host')
    patchChildMemoryIndex(characterId, entries)
  } catch (error) {
    log.debug('Could not patch the job child\'s memory index cache', {
      characterId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ---------------------------------------------------------------------------
// The parent half
// ---------------------------------------------------------------------------

/**
 * The parent half: search, decide, write. Never call it from the job child —
 * `admitRow` reaches it over host-RPC.
 */
export async function admitPrepared(request: AdmitPreparedRequest): Promise<AdmissionOutcome> {
  if (isJobChild()) {
    throw new Error('admitPrepared runs in the parent; the job child admits through host-RPC (admitMemory)')
  }
  const { row, embedding, userId, idempotencyKey } = request
  const characterId = row.characterId

  if (request.dryRun) return decideOnly(request)

  return withCharacterLock(characterId, async () => {
    const now = Date.now()
    if (idempotencyKey) {
      const earlier = recallAdmission(idempotencyKey, now)
      if (earlier) {
        log.debug('Admission already made by an earlier attempt of this job; nothing written', {
          characterId,
          action: earlier.action.kind,
          memoryId: earlier.memory?.id ?? null,
        })
        return {
          ...earlier,
          trace: { ...earlier.trace, notes: [...earlier.trace.notes, 'already admitted by an earlier attempt of this job'] },
        }
      }
    }

    const notes = [...request.notes]
    let trace: AdmissionTrace | null = null
    let applied: Applied | null = null
    let neighbourCount = 0
    let bestCosine: number | null = null

    for (let attempt = 0; attempt < 2 && !applied; attempt++) {
      const gathered = await gatherNeighbours(characterId, embedding, { probe: neighbourProbe(row, userId) })
      const decision = decideAdmission({
        candidate: {
          holderId: characterId,
          aboutId: row.aboutCharacterId,
          kind: row.kind,
          source: row.source,
          occurredAt: row.occurredAt,
        },
        neighbours: gathered.neighbours,
        thresholds: ADMISSION_THRESHOLDS,
      })
      trace = {
        thresholds: ADMISSION_THRESHOLDS,
        assessments: decision.assessments,
        embeddingAttempts: request.embeddingAttempts,
        orphansIgnored: gathered.orphanIds.length,
        searchedK: gathered.searchedK,
        notes,
      }
      neighbourCount = gathered.neighbours.length
      bestCosine = gathered.neighbours[0]?.cosine ?? null
      const neighbourById = new Map(gathered.neighbours.map((n) => [n.memory.id, n.memory]))

      const result = await applyAction(decision.action, row, embedding, neighbourById, userId, notes)
      if (result !== 'vanished') {
        applied = result
      } else if (attempt === 0) {
        notes.push('target retired before the write; deciding again')
        log.debug('Admission target vanished; deciding again', { characterId, action: decision.action.kind })
      } else {
        notes.push('target retired again; inserted instead')
        log.warn('Admission target vanished twice; inserting the candidate', { characterId })
        applied = (await applyAction({ kind: 'insert' }, row, embedding, new Map(), userId, notes)) as Applied
      }
    }

    const outcome: AdmissionOutcome = {
      action: applied!.action,
      memory: applied!.memory,
      novelDetails: applied!.novelDetails,
      linkedIds: applied!.linkedIds,
      trace: trace!,
    }

    if (outcome.memory) publishRealtime('memories')
    if (admissionInserted(outcome) && row.source === 'AUTO' && !request.backfill) recordAdmissionInsert(characterId)
    void patchChildIndex(characterId, applied!.indexEntries)
    if (admissionInserted(outcome)) {
      // The consolidation watermark counts the row just written (it used to run
      // from the job dispatcher's commit hook, when admission buffered its rows).
      void import('../consolidation-triggers')
        .then((mod) => mod.maybeEnqueueConsolidationForCharacters([characterId]))
        .catch((error) => log.debug('Consolidation watermark check skipped after admission', { characterId, error: String(error) }))
    }
    if (idempotencyKey) recordAdmission(idempotencyKey, outcome, now)

    log.debug('Memory admitted', {
      characterId,
      action: outcome.action.kind,
      memoryId: outcome.memory?.id ?? null,
      neighbours: neighbourCount,
      bestCosine,
      novelDetails: outcome.novelDetails.length,
      linked: outcome.linkedIds.length,
      keyed: !!idempotencyKey,
    })
    return outcome
  })
}

/**
 * The dry run's parent half: search and decide as live admission would, and
 * write nothing. The outcome's `memory` is the row the action names (the fold
 * target), or null for an insert.
 */
async function decideOnly(request: AdmitPreparedRequest, book?: DryRunBook): Promise<AdmissionOutcome> {
  const { row, embedding } = request
  const gathered = await gatherNeighbours(row.characterId, embedding, {
    ...(book ? { exclude: book.retiring } : {}),
    probe: neighbourProbe(row, request.userId),
  })
  if (book) {
    gathered.neighbours = [...gathered.neighbours, ...bookNeighbours(book, row.characterId, embedding)]
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, ADMISSION_TOP_K)
  }
  const decision = decideAdmission({
    candidate: {
      holderId: row.characterId,
      aboutId: row.aboutCharacterId,
      kind: row.kind,
      source: row.source,
      occurredAt: row.occurredAt,
    },
    neighbours: gathered.neighbours,
    thresholds: ADMISSION_THRESHOLDS,
  })
  const action = decision.action
  const target =
    action.kind === 'absorb' || action.kind === 'reinforce' || action.kind === 'promote-and-reinforce'
      ? gathered.neighbours.find((n) => n.memory.id === action.into)?.memory ?? null
      : null
  if (book && (action.kind === 'insert' || action.kind === 'insert-linked')) recordBookInsert(book, row, embedding)
  log.debug('Admission decided (dry run; nothing written)', {
    characterId: row.characterId,
    action: action.kind,
    targetId: target?.id ?? null,
    neighbours: gathered.neighbours.length,
  })
  return {
    action,
    memory: target ? withoutEmbedding(target) : null,
    novelDetails: [],
    linkedIds: action.kind === 'insert-linked' ? [...action.linkTo] : [],
    trace: {
      thresholds: ADMISSION_THRESHOLDS,
      assessments: decision.assessments,
      embeddingAttempts: request.embeddingAttempts,
      orphansIgnored: gathered.orphanIds.length,
      searchedK: gathered.searchedK,
      notes: [...request.notes, 'dry run: decided, nothing written'],
    },
  }
}

type IndexEntry = { id: string; embedding: Float32Array; tier: 'hot' | 'cold' }

interface Applied {
  action: AdmissionAction
  memory: Memory | null
  novelDetails: string[]
  linkedIds: string[]
  /** Vectors and tiers this write changed, for the job child's cache. */
  indexEntries: IndexEntry[]
}

/** The row's vector and tier as a cache entry, when it carries one. */
function indexEntryOf(memory: Memory): IndexEntry[] {
  const embedding = memory.embedding
  if (!(embedding instanceof Float32Array) || embedding.length === 0) return []
  return [{ id: memory.id, embedding, tier: memory.tier === 'cold' ? 'cold' : 'hot' }]
}

/**
 * Write one decision. `'vanished'` when the row it folds into is gone before
 * the write lands (retired meanwhile); the caller decides again.
 */
async function applyAction(
  action: AdmissionAction,
  row: AdmissionRow,
  embedding: Float32Array,
  neighbours: ReadonlyMap<string, Memory>,
  userId: string,
  notes: string[],
): Promise<Applied | 'vanished'> {
  const none = { novelDetails: [] as string[], linkedIds: [] as string[], indexEntries: [] as IndexEntry[] }
  switch (action.kind) {
    case 'reject':
      return { action, memory: null, ...none }

    case 'insert': {
      const memory = await insertRow(row, embedding)
      return { action, memory: withoutEmbedding(memory), ...none, indexEntries: [{ id: memory.id, embedding, tier: 'hot' }] }
    }

    case 'insert-linked': {
      const memory = await insertRow(row, embedding)
      const linkedIds = await linkBothWays(row.characterId, memory.id, action.linkTo)
      // The post-link row: callers that union `relatedMemoryIds` must start
      // from the links written here (bug 26).
      return {
        action,
        memory: withoutEmbedding({ ...memory, relatedMemoryIds: linkedIds }),
        novelDetails: [],
        linkedIds,
        indexEntries: [{ id: memory.id, embedding, tier: 'hot' }],
      }
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
        // Retired meanwhile, the tier move touches nothing.
        const moved = await memoryIndex.setTier(target.characterId, [target.id], 'hot', { supersededById: null })
        if (moved === 0) return 'vanished'
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
          FOLD_CAPS,
        )
        memory = await applyFold(target, plan, { userId })
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
        log.debug('Admission target vanished before the write', { memoryId: action.into })
        return 'vanished'
      }
      if (row.source === 'MANUAL') memory = await raiseImportance(memory, row.importance)
      const changedIndex = action.kind === 'promote-and-reinforce' || (withFootnotes && memory.embedding !== target.embedding)
      return {
        action,
        memory: withoutEmbedding(memory),
        novelDetails,
        linkedIds: [],
        indexEntries: changedIndex ? indexEntryOf(memory) : [],
      }
    }
  }
}
