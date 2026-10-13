/**
 * Admission's dry run (memory refactor Phase D, invariant 10): given the same
 * book and the same candidate, `dryRun: true` decides exactly what live
 * admission does and writes nothing. And the parent's rate ledger counts the
 * AUTO rows live admission inserts — the extraction rate limit's baseline.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {},
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  cosineSimilarity: jest.requireActual('@/lib/embedding/embedding-service').cosineSimilarity,
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
}))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/background-jobs/host/processor-host', () => ({ patchChildMemoryIndex: jest.fn() }))
jest.mock('@/lib/memory/consolidation-triggers', () => ({ maybeEnqueueConsolidationForCharacters: jest.fn(async () => []) }))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryMaintenanceSettings: jest.fn(async () => ({ enabled: false })) }))

import { admitCandidate, admitPrepared } from '@/lib/memory/admission'
import { resetAdmissionStateForTests } from '@/lib/memory/admission/admit'
import { countRecentAdmissionsLocal, resetRateLedgerForTests } from '@/lib/memory/admission/rate-ledger'
import { createDryRunBook } from '@/lib/memory/admission/dry-run-book'
import { MemoryCandidateSchema, type MemoryCandidate } from '@/lib/memory/candidate'
import { createFakeMemoryStore, fakeMemoryIndex, fakeRepositories, seedMemory, type FakeMemoryStore } from '../../../helpers/memory-admission-fake'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const indexMock = jest.requireMock('@/lib/memory/index-store') as { memoryIndex: Record<string, unknown> }
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock }
const busMock = jest.requireMock('@/lib/realtime/bus') as { publishRealtime: jest.Mock }
const processorHostMock = jest.requireMock('@/lib/background-jobs/host/processor-host') as { patchChildMemoryIndex: jest.Mock }

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

describe('admitCandidate — dry run decides as live does, and writes nothing', () => {
  let store: FakeMemoryStore
  let vectors: Map<string, Float32Array>

  beforeEach(() => {
    jest.clearAllMocks()
    resetAdmissionStateForTests()
    resetRateLedgerForTests()
    store = createFakeMemoryStore()
    vectors = new Map()
    factoryMock.getRepositories.mockReturnValue(fakeRepositories(store))
    Object.assign(indexMock.memoryIndex, fakeMemoryIndex(store))
    embedMock.generateEmbeddingForUser.mockImplementation(async (text: string) => {
      for (const [key, vec] of vectors) if (text.startsWith(key)) return { embedding: vec }
      return { embedding: OTHER }
    })
  })

  const scenarios: Array<{ name: string; seed: boolean; text: string; vector: Float32Array; kind: string }> = [
    { name: 'an insert into an empty book', seed: false, text: 'Friday keeps the ledger', vector: LEDGER, kind: 'insert' },
    { name: 'a near-duplicate absorption', seed: true, text: 'Friday keeps the ledger', vector: LEDGER, kind: 'absorb' },
    { name: 'a reinforcement in the band', seed: true, text: 'Friday keeps the ledger for Marguerite', vector: NEAR_LEDGER, kind: 'reinforce' },
    { name: 'a related-band link', seed: true, text: 'Friday audits the books', vector: BAND_LEDGER, kind: 'insert-linked' },
  ]

  it.each(scenarios)('$name', async ({ seed, text, vector, kind }) => {
    if (seed) seedMemory(store, { id: 'ledger', content: 'Friday keeps the ledger.', summary: 'Ledger', embedding: LEDGER })
    vectors.set(text, vector)
    const before = JSON.stringify([...store.rows.values()].map(r => ({ ...r, embedding: undefined })))

    const dry = await admitCandidate(candidate(text), NO_TIME, { ...OPTS, dryRun: true })
    expect(dry.action.kind).toBe(kind)
    expect(store.writes).toEqual([])
    expect(JSON.stringify([...store.rows.values()].map(r => ({ ...r, embedding: undefined })))).toBe(before)
    expect(busMock.publishRealtime).not.toHaveBeenCalled()
    expect(processorHostMock.patchChildMemoryIndex).not.toHaveBeenCalled()
    // The fold target is named; an insert names none.
    expect(dry.memory?.id ?? null).toBe(kind === 'insert' || kind === 'insert-linked' ? null : 'ledger')

    const live = await admitCandidate(candidate(text), NO_TIME, OPTS)
    expect(live.action).toEqual(dry.action)
    expect(store.writes.length).toBeGreaterThan(0)
  })

  it('a dry run never reaches the parent half\'s write path even through admitPrepared', async () => {
    seedMemory(store, { id: 'ledger', content: 'Friday keeps the ledger.', embedding: LEDGER })
    const outcome = await admitPrepared({
      row: { characterId: 'char-1', aboutCharacterId: null, content: 'Friday keeps the ledger', summary: 'Friday keeps the ledger', importance: 0.5, source: 'AUTO', kind: 'semantic' } as never,
      embedding: LEDGER,
      userId: 'user-1',
      embeddingAttempts: 1,
      notes: [],
      dryRun: true,
    })
    expect(outcome.action).toEqual({ kind: 'absorb', into: 'ledger' })
    expect(outcome.trace.notes).toContain('dry run: decided, nothing written')
    expect(store.writes).toEqual([])
    expect(store.rows.get('ledger')!.reinforcementCount ?? 1).toBe(1)
  })
})

describe('the dry-run book: deciding as a regenerate would (review of PR 94)', () => {
  let store: FakeMemoryStore
  let vectors: Map<string, Float32Array>

  beforeEach(() => {
    jest.clearAllMocks()
    resetAdmissionStateForTests()
    store = createFakeMemoryStore()
    vectors = new Map()
    factoryMock.getRepositories.mockReturnValue(fakeRepositories(store))
    Object.assign(indexMock.memoryIndex, fakeMemoryIndex(store))
    embedMock.generateEmbeddingForUser.mockImplementation(async (text: string) => {
      for (const [key, vec] of vectors) if (text.startsWith(key)) return { embedding: vec }
      return { embedding: OTHER }
    })
  })

  it('searches past the rows the chat wipe would retire', async () => {
    seedMemory(store, { id: 'doomed', content: 'Friday keeps the ledger.', embedding: LEDGER })
    vectors.set('Friday keeps the ledger', LEDGER)
    const book = createDryRunBook(['doomed'])
    const outcome = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, { ...OPTS, dryRun: true, dryRunBook: book })
    expect(outcome.action.kind).toBe('insert')
    expect(store.writes).toEqual([])
  })

  it('lets a later candidate fold into an earlier would-be insert', async () => {
    vectors.set('Friday keeps the ledger for Marguerite', NEAR_LEDGER)
    vectors.set('Friday keeps the ledger', LEDGER)
    const book = createDryRunBook()
    const first = await admitCandidate(candidate('Friday keeps the ledger'), NO_TIME, { ...OPTS, dryRun: true, dryRunBook: book })
    expect(first.action.kind).toBe('insert')
    const second = await admitCandidate(candidate('Friday keeps the ledger for Marguerite'), NO_TIME, { ...OPTS, dryRun: true, dryRunBook: book })
    expect(second.action).toEqual({ kind: 'reinforce', into: 'dry-run:char-1:1' })
    expect(store.writes).toEqual([])
    expect(store.rows.size).toBe(0)
  })
})

describe('the admission rate ledger', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetAdmissionStateForTests()
    resetRateLedgerForTests()
    const store = createFakeMemoryStore()
    factoryMock.getRepositories.mockReturnValue(fakeRepositories(store))
    Object.assign(indexMock.memoryIndex, fakeMemoryIndex(store))
    let n = 0
    embedMock.generateEmbeddingForUser.mockImplementation(async () => {
      // Orthogonal vectors: every candidate is a fresh insert.
      const v = new Float32Array(8)
      v[n++ % 8] = 1
      return { embedding: v }
    })
  })

  it('counts AUTO inserts as they land, and not dry runs', async () => {
    const since = Date.now() - 1000
    await admitCandidate(candidate('one'), NO_TIME, OPTS)
    await admitCandidate(candidate('two'), NO_TIME, OPTS)
    await admitCandidate(candidate('three'), NO_TIME, { ...OPTS, dryRun: true })
    expect(countRecentAdmissionsLocal('char-1', since)).toBe(2)
    expect(countRecentAdmissionsLocal('char-2', since)).toBe(0)
  })

  it('does not count a backfill\'s inserts (a regenerate must not trip the live cap)', async () => {
    const since = Date.now() - 1000
    await admitCandidate(candidate('rebuilt one'), NO_TIME, { ...OPTS, backfill: true })
    await admitCandidate(candidate('rebuilt two'), NO_TIME, { ...OPTS, backfill: true })
    await admitCandidate(candidate('live'), NO_TIME, OPTS)
    expect(countRecentAdmissionsLocal('char-1', since)).toBe(1)
  })

  it('does not count hand-written rows', async () => {
    const since = Date.now() - 1000
    const manual = candidate('a note', {
      provenance: { source: 'MANUAL', witnessedContext: 'manual', chatId: null, projectId: null, sourceMessageId: null, anchorTimeMs: 0, pass: 'manual' },
    })
    await admitCandidate(manual, NO_TIME, OPTS)
    expect(countRecentAdmissionsLocal('char-1', since)).toBe(0)
  })
})
