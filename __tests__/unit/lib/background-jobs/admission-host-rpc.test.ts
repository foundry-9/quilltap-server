/**
 * @jest-environment node
 */

/**
 * Admission from the job child goes to the parent (memory refactor Phase C).
 *
 * The child extracts and embeds; `admitMemory` over host-RPC searches, decides
 * and writes in the parent against the real rows. So within one extraction
 * job a second candidate sees the first's row (bug 209 closed structurally,
 * not by the child's overlay), and two jobs reinforcing one row both land
 * (bug 231). The child's own repository proxy is never asked to write.
 *
 * `callHost` is wired straight to the parent's dispatcher, with the job-child
 * flag lowered while the parent half runs and every argument and result
 * passed through V8 serialization, as the `serialization: 'advanced'` IPC
 * channel does.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {},
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
  lexicalEmbeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').lexicalEmbeddingTextFor,
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
}))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/background-jobs/host/processor-host', () => ({ patchChildMemoryIndex: jest.fn() }))
jest.mock('@/lib/memory/maintenance/triggers', () => ({ maybeEnqueueMaintenance: jest.fn(async () => []) }))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))
jest.mock('@/lib/instance-settings', () => ({ getMemoryMaintenanceSettings: jest.fn(async () => ({ enabled: false })) }))
jest.mock('@/lib/background-jobs/child/host-rpc-client', () => ({ callHost: jest.fn() }))

import v8 from 'node:v8'
import { admitCandidate } from '@/lib/memory/admission'
import { resetAdmissionStateForTests } from '@/lib/memory/admission/admit'
import { runWithJobScope } from '@/lib/background-jobs/child/child-repositories-proxy'
import { MemoryCandidateSchema, type MemoryCandidate } from '@/lib/memory/candidate'
import { dispatchHostRpc } from '@/lib/background-jobs/host/host-rpc-dispatcher'
import { createFakeMemoryStore, fakeMemoryIndex, fakeRepositories, seedMemory, type FakeMemoryStore } from '../../../helpers/memory-admission-fake'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock }
const indexMock = jest.requireMock('@/lib/memory/index-store') as { memoryIndex: Record<string, unknown> }
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock }
const rpcMock = jest.requireMock('@/lib/background-jobs/child/host-rpc-client') as { callHost: jest.Mock }
const processorHostMock = jest.requireMock('@/lib/background-jobs/host/processor-host') as { patchChildMemoryIndex: jest.Mock }

/** What the advanced-serialization IPC channel does to a message. */
const overIpc = <T>(value: T): T => v8.deserialize(v8.serialize(value)) as T

const LEDGER = new Float32Array([1, 0, 0])
const NEAR_LEDGER = new Float32Array([0.87, Math.sqrt(1 - 0.87 ** 2), 0])
const NEAR_LEDGER_2 = new Float32Array([0.88, 0, Math.sqrt(1 - 0.88 ** 2)])

function candidate(summary: string): MemoryCandidate {
  return MemoryCandidateSchema.parse({
    content: summary,
    summary,
    keywords: [],
    targeting: { temporal: 'present', scope: 'wide', context: 'information' },
    importance: 0.6,
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
  })
}
const NO_TIME = { occurredAt: null, narrativeTime: null }

describe('admission from the job child runs in the parent', () => {
  let store: FakeMemoryStore
  let vectors: Map<string, Float32Array>
  let childWrites: string[]

  beforeEach(() => {
    jest.clearAllMocks()
    resetAdmissionStateForTests()
    store = createFakeMemoryStore()
    vectors = new Map()
    childWrites = []
    const parentRepos = fakeRepositories(store)
    // In the child every memories *write* would buffer; record any attempt.
    const childRepos = {
      ...parentRepos,
      memories: new Proxy(parentRepos.memories, {
        get(target, key: string) {
          const value = (target as Record<string, unknown>)[key]
          if (typeof value === 'function' && !/^(find|count)/.test(key)) {
            return (...args: unknown[]) => {
              childWrites.push(key)
              return (value as (...a: unknown[]) => unknown)(...args)
            }
          }
          return value
        },
      }),
    }
    factoryMock.getRepositories.mockImplementation(() =>
      process.env.QUILLTAP_JOB_CHILD === '1' ? childRepos : parentRepos,
    )
    Object.assign(indexMock.memoryIndex, fakeMemoryIndex(store))
    embedMock.generateEmbeddingForUser.mockImplementation(async (text: string) => {
      for (const [key, vec] of vectors) if (text.startsWith(key)) return { embedding: vec }
      return { embedding: new Float32Array([0, 0, 1]) }
    })
    rpcMock.callHost.mockImplementation(async (method: string, ...args: unknown[]) => {
      delete process.env.QUILLTAP_JOB_CHILD
      try {
        const response = await dispatchHostRpc({
          type: 'host-rpc',
          requestId: 'r',
          method: method as 'admitMemory',
          args: overIpc(args),
        })
        if (!response.ok) throw new Error(response.error?.message)
        return overIpc(response.result)
      } finally {
        process.env.QUILLTAP_JOB_CHILD = '1'
      }
    })
    process.env.QUILLTAP_JOB_CHILD = '1'
  })

  afterEach(() => {
    delete process.env.QUILLTAP_JOB_CHILD
  })

  it('two near-identical candidates in one job make one row with count 2 (bug 209)', async () => {
    vectors.set('Friday keeps the ledger', LEDGER)

    const first = await admitCandidate(candidate('Friday keeps the ledger.'), NO_TIME, { userId: 'user-1' })
    const second = await admitCandidate(candidate('Friday keeps the ledger!'), NO_TIME, { userId: 'user-1' })

    expect(first.action.kind).toBe('insert')
    expect(second.action).toEqual({ kind: 'absorb', into: first.memory!.id })
    expect(store.rows.size).toBe(1)
    expect(store.rows.get(first.memory!.id)!.reinforcementCount).toBe(2)
    expect(rpcMock.callHost).toHaveBeenCalledTimes(2)
    expect(rpcMock.callHost.mock.calls[0][0]).toBe('admitMemory')
    // The child never wrote a memory row; it only read characters/rows.
    expect(childWrites).toEqual([])
    // The parent patches the child's cache with the new vector.
    await new Promise((resolve) => setImmediate(resolve))
    expect(processorHostMock.patchChildMemoryIndex).toHaveBeenCalledWith('char-1', [
      { id: first.memory!.id, embedding: LEDGER, tier: 'hot' },
    ])
  })

  it('the child embeds; the parent never calls the embedding provider for a plain insert', async () => {
    vectors.set('Friday keeps the ledger', LEDGER)
    const calls: Array<string | undefined> = []
    embedMock.generateEmbeddingForUser.mockImplementation(async () => {
      calls.push(process.env.QUILLTAP_JOB_CHILD)
      return { embedding: LEDGER }
    })
    await admitCandidate(candidate('Friday keeps the ledger.'), NO_TIME, { userId: 'user-1' })
    expect(calls).toEqual(['1'])
  })

  it('two band candidates against one neighbour leave both links', async () => {
    seedMemory(store, { id: 'ledger', content: 'Friday keeps the harbour ledger.', embedding: LEDGER })
    vectors.set('Friday audits', new Float32Array([0.78, Math.sqrt(1 - 0.78 ** 2), 0]))
    vectors.set('Friday locks', new Float32Array([0.76, 0, Math.sqrt(1 - 0.76 ** 2)]))

    const a = await admitCandidate(candidate('Friday audits the ledger at dawn.'), NO_TIME, { userId: 'user-1' })
    const b = await admitCandidate(candidate('Friday locks the ledger at dusk.'), NO_TIME, { userId: 'user-1' })

    expect(a.action.kind).toBe('insert-linked')
    expect(b.action.kind).toBe('insert-linked')
    expect(store.rows.get('ledger')!.relatedMemoryIds).toEqual([a.memory!.id, b.memory!.id])
  })

  it('two reinforcements of one row keep both footnotes and both counts (bug 231)', async () => {
    seedMemory(store, { id: 'ledger', summary: 'Friday keeps the ledger', content: 'Friday keeps the ledger.', embedding: LEDGER })
    // The re-embedded row keeps its place.
    vectors.set('Friday keeps the ledger\n\n', LEDGER)
    vectors.set('Friday keeps the ledger for Marguerite', NEAR_LEDGER)
    vectors.set('Friday keeps the ledger in Valparaiso', NEAR_LEDGER_2)

    await admitCandidate(candidate('Friday keeps the ledger for Marguerite.'), NO_TIME, { userId: 'user-1' })
    await admitCandidate(candidate('Friday keeps the ledger in Valparaiso.'), NO_TIME, { userId: 'user-1' })

    const row = store.rows.get('ledger')!
    expect(row.content).toContain('[+] Marguerite')
    expect(row.content).toContain('[+] Valparaiso')
    expect(row.reinforcementCount).toBe(3)
    expect(childWrites).toEqual([])
  })

  it('a retried job does not count its admissions twice (review #1)', async () => {
    vectors.set('Friday keeps the ledger', LEDGER)
    const attempt = () =>
      runWithJobScope('job-retry', async () => {
        await admitCandidate(candidate('Friday keeps the ledger.'), NO_TIME, { userId: 'user-1' })
        // The same observation twice in one attempt is two observations.
        await admitCandidate(candidate('Friday keeps the ledger.'), NO_TIME, { userId: 'user-1' })
      })

    await attempt()
    const [row] = Array.from(store.rows.values())
    expect(row.reinforcementCount).toBe(2)

    // The job failed after admitting and is retried: same job id, new attempt.
    await attempt()
    expect(store.rows.size).toBe(1)
    expect(store.rows.get(row.id)!.reinforcementCount).toBe(2)
  })
})
