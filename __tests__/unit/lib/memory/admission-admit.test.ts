/**
 * `admitCandidate` in the parent (memory refactor Phase C): embed, gather,
 * decide, write — against an in-memory table whose writes land at once, as
 * they do on the parent's read-write connection.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {},
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
}))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/background-jobs/host/processor-host', () => ({ notifyChild: jest.fn() }))
jest.mock('@/lib/memory/consolidation-triggers', () => ({ maybeEnqueueConsolidationForCharacters: jest.fn(async () => []) }))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryMaintenanceSettings: jest.fn(async () => ({ enabled: false })) }))

import { admitCandidate, admitPrepared } from '@/lib/memory/admission'
import { MemoryCandidateSchema, type MemoryCandidate } from '@/lib/memory/candidate'
import { createFakeMemoryStore, fakeMemoryIndex, fakeRepositories, seedMemory, type FakeMemoryStore } from '../../../helpers/memory-admission-fake'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const indexMock = jest.requireMock('@/lib/memory/index-store') as { memoryIndex: Record<string, unknown> }
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock }
const busMock = jest.requireMock('@/lib/realtime/bus') as { publishRealtime: jest.Mock }

const LEDGER = new Float32Array([1, 0, 0])
/** cos(LEDGER, NEAR_LEDGER) ≈ 0.87 — the reinforce band. */
const NEAR_LEDGER = new Float32Array([0.87, Math.sqrt(1 - 0.87 ** 2), 0])
/** cos ≈ 0.75 — the related band. */
const BAND_LEDGER = new Float32Array([0.75, Math.sqrt(1 - 0.75 ** 2), 0])
const OTHER = new Float32Array([0, 0, 1])

function candidate(summary: string, overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return MemoryCandidateSchema.parse({
    content: summary,
    summary,
    keywords: [],
    targeting: null,
    importance: 0.5,
    kind: 'semantic',
    when: null,
    entities: [],
    subject: { holderId: 'char-1', aboutId: null },
    provenance: {
      source: 'AUTO',
      witnessedContext: 'user_present',
      chatId: null,
      projectId: null,
      sourceMessageId: null,
      anchorTimeMs: Date.parse('2026-06-01T00:00:00.000Z'),
      pass: 'self-turn',
    },
    ...overrides,
  })
}

const NO_TIME = { occurredAt: null, narrativeTime: null }
const OPTS = { userId: 'user-1' }

describe('admitCandidate (parent)', () => {
  let store: FakeMemoryStore
  let vectors: Map<string, Float32Array>

  beforeEach(() => {
    jest.clearAllMocks()
    store = createFakeMemoryStore()
    vectors = new Map()
    factoryMock.getRepositories.mockReturnValue(fakeRepositories(store))
    Object.assign(indexMock.memoryIndex, fakeMemoryIndex(store))
    embedMock.generateEmbeddingForUser.mockImplementation(async (text: string) => {
      for (const [key, vec] of vectors) if (text.startsWith(key)) return { embedding: vec }
      return { embedding: OTHER }
    })
  })

  it('inserts into an empty book, with its vector, at count 1', async () => {
    vectors.set('Friday keeps the ledger', LEDGER)
    const outcome = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'insert' })
    const row = store.rows.get(outcome.memory!.id)!
    expect(row.embedding).toBe(LEDGER)
    expect(row.reinforcementCount).toBe(1)
    expect(outcome.memory).not.toHaveProperty('embedding')
    expect(busMock.publishRealtime).toHaveBeenCalledWith('memories')
  })

  it('absorbs a near-duplicate by count only', async () => {
    seedMemory(store, { id: 'ledger', content: 'Friday keeps the ledger.', embedding: LEDGER })
    vectors.set('Friday keeps the ledger', LEDGER)
    const outcome = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'absorb', into: 'ledger' })
    expect(store.rows.size).toBe(1)
    expect(store.rows.get('ledger')!.reinforcementCount).toBe(2)
    expect(store.rows.get('ledger')!.content).toBe('Friday keeps the ledger.')
    expect(store.writes).toEqual(['incrementReinforcement'])
  })

  it('reinforces in the band with a footnote, the count delta and a re-embed', async () => {
    seedMemory(store, { id: 'ledger', content: 'Friday keeps the ledger.', summary: 'Ledger', embedding: LEDGER })
    vectors.set('Friday keeps the ledger for Marguerite', NEAR_LEDGER)
    const outcome = await admitCandidate(candidate('Friday keeps the ledger for Marguerite'), NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'reinforce', into: 'ledger' })
    expect(outcome.novelDetails).toEqual(['Marguerite'])
    const row = store.rows.get('ledger')!
    expect(row.content).toBe('Friday keeps the ledger.\n[+] Marguerite')
    expect(row.reinforcementCount).toBe(2)
    expect(store.writes).toContain('index.upsert')
    expect(store.writes).not.toContain('create')
  })

  it('links a related-band row both ways and returns the post-link row (bug 26)', async () => {
    seedMemory(store, { id: 'ledger', content: 'Friday keeps the ledger.', embedding: LEDGER })
    vectors.set('Friday audits the books', BAND_LEDGER)
    const outcome = await admitCandidate(candidate('Friday audits the books'), NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'insert-linked', linkTo: ['ledger'], reason: 'band' })
    expect(outcome.memory!.relatedMemoryIds).toEqual(['ledger'])
    expect(outcome.linkedIds).toEqual(['ledger'])
    expect(store.rows.get('ledger')!.relatedMemoryIds).toEqual([outcome.memory!.id])
  })

  it('a hand-written memory is never absorbed into an extracted row', async () => {
    seedMemory(store, { id: 'auto', content: 'Friday keeps the ledger.', embedding: LEDGER })
    vectors.set('Friday keeps the ledger', LEDGER)
    const manual = candidate('Friday keeps the ledger', {
      provenance: { source: 'MANUAL', witnessedContext: 'manual', chatId: null, projectId: null, sourceMessageId: null, anchorTimeMs: 0, pass: 'manual' },
    })
    const outcome = await admitCandidate(manual, NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'insert-linked', linkTo: ['auto'], reason: 'mismatch' })
    expect(store.rows.get(outcome.memory!.id)!.source).toBe('MANUAL')
    expect(store.rows.get('auto')!.reinforcementCount).toBe(1)
  })

  it('a hand-written memory folded into a MANUAL row raises its importance', async () => {
    seedMemory(store, { id: 'manual', content: 'Friday keeps the ledger.', source: 'MANUAL', importance: 0.4, embedding: LEDGER })
    vectors.set('Friday keeps the ledger', LEDGER)
    const manual = candidate('Friday keeps the ledger', {
      importance: 0.9,
      provenance: { source: 'MANUAL', witnessedContext: 'manual', chatId: null, projectId: null, sourceMessageId: null, anchorTimeMs: 0, pass: 'manual' },
    })
    const outcome = await admitCandidate(manual, NO_TIME, OPTS)
    expect(outcome.action.kind).toBe('absorb')
    expect(store.rows.get('manual')!.importance).toBe(0.9)
    expect(store.rows.get('manual')!.reinforcementCount).toBe(2)
  })

  it('a hand-written memory never lowers a row\'s importance, and a digest keeps its source', async () => {
    seedMemory(store, { id: 'digest', content: 'Friday keeps the ledger.', source: 'CONSOLIDATED', importance: 0.95, embedding: LEDGER })
    vectors.set('Friday keeps the ledger', LEDGER)
    const manual = candidate('Friday keeps the ledger', {
      importance: 0.2,
      provenance: { source: 'MANUAL', witnessedContext: 'manual', chatId: null, projectId: null, sourceMessageId: null, anchorTimeMs: 0, pass: 'manual' },
    })
    await admitCandidate(manual, NO_TIME, OPTS)
    expect(store.rows.get('digest')!.importance).toBe(0.95)
    expect(store.rows.get('digest')!.source).toBe('CONSOLIDATED')
  })

  it('promotes a cold row nothing supersedes, then counts it', async () => {
    seedMemory(store, { id: 'cold', content: 'Friday keeps the ledger.', tier: 'cold', embedding: LEDGER })
    vectors.set('Friday keeps the ledger', LEDGER)
    const outcome = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'promote-and-reinforce', into: 'cold', withFootnotes: false })
    expect(store.rows.get('cold')!.tier).toBe('hot')
    expect(store.rows.get('cold')!.reinforcementCount).toBe(2)
  })

  it('absorbs into the digest that supersedes a cold member', async () => {
    seedMemory(store, { id: 'member', tier: 'cold', supersededById: 'digest', embedding: LEDGER })
    seedMemory(store, { id: 'digest', source: 'CONSOLIDATED', embedding: OTHER })
    vectors.set('Friday keeps the ledger', NEAR_LEDGER)
    const outcome = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'absorb', into: 'digest', redirectedFrom: 'member' })
    expect(store.rows.get('digest')!.reinforcementCount).toBe(2)
    expect(store.rows.get('member')!.tier).toBe('cold')
  })

  it('rejects, writing nothing, when the embedding fails twice (invariant 4)', async () => {
    embedMock.generateEmbeddingForUser.mockRejectedValue(new Error('provider down'))
    const outcome = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, OPTS)
    expect(outcome.action).toEqual({ kind: 'reject', reason: 'embedding-failed' })
    expect(outcome.memory).toBeNull()
    expect(outcome.trace.embeddingAttempts).toBe(2)
    expect(embedMock.generateEmbeddingForUser).toHaveBeenCalledTimes(2)
    expect(store.writes).toEqual([])
  })

  it('a dry run decides the same and writes nothing (invariant 10)', async () => {
    seedMemory(store, { id: 'ledger', content: 'Friday keeps the ledger.', embedding: LEDGER })
    vectors.set('Friday keeps the ledger for Marguerite', NEAR_LEDGER)
    const dry = await admitCandidate(candidate('Friday keeps the ledger for Marguerite'), NO_TIME, { ...OPTS, dryRun: true })
    expect(dry.dryRun).toBe(true)
    expect(store.writes).toEqual([])
    const live = await admitCandidate(candidate('Friday keeps the ledger for Marguerite'), NO_TIME, OPTS)
    expect(live.action).toEqual(dry.action)
    expect(live.trace.assessments).toEqual(dry.trace.assessments)
  })

  it('two near-identical candidates make one row with count 2 (bug 209)', async () => {
    vectors.set('Friday keeps the ledger', LEDGER)
    await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, OPTS)
    const second = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, OPTS)
    expect(store.rows.size).toBe(1)
    expect(second.action.kind).toBe('absorb')
    expect(Array.from(store.rows.values())[0].reinforcementCount).toBe(2)
  })

  it('admitPrepared refuses to run in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    try {
      await expect(
        admitPrepared({
          row: { characterId: 'char-1', content: 'x', summary: 'x' },
          embedding: LEDGER,
          userId: 'user-1',
          dryRun: false,
          embeddingAttempts: 1,
          notes: [],
        }),
      ).rejects.toThrow(/parent/)
    } finally {
      delete process.env.QUILLTAP_JOB_CHILD
    }
  })
})
