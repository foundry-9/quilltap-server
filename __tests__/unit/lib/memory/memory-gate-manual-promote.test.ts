/**
 * A hand-written memory that the gate folds into an existing extracted row
 * (REINFORCE / SKIP_NEAR_DUPLICATE) promotes the survivor: it becomes MANUAL —
 * so housekeeping can no longer demote or delete it — and keeps the higher of
 * the two importances, with reinforcedImportance recomputed to match.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {
    search: jest.fn(),
    shape: jest.fn(),
    upsert: jest.fn(),
    indexInserted: jest.fn(),
    setTier: jest.fn(),
    remove: jest.fn(),
    reload: jest.fn(),
    reloadAll: jest.fn(),
    entries: jest.fn(),
  },
  embeddingTextFor: (jest.requireActual('@/lib/memory/index-store/embedding-text') as any).embeddingTextFor,
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  cosineSimilarity: jest.fn(),
  EmbeddingError: class extends Error {},
}))
jest.mock('@/lib/logger', () => {
  const make = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(() => make()),
  })
  return { logger: make() }
})
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))

import type { Memory } from '@/lib/schemas/types'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock<any> }
const indexMock = jest.requireMock('@/lib/memory/index-store') as { memoryIndex: Record<string, jest.Mock<any>> }
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock<any> }

const service = require('@/lib/memory/memory-service') as typeof import('@/lib/memory/memory-service')
const { calculateReinforcedImportance } = require('@/lib/memory/scoring/reinforced-importance') as typeof import('@/lib/memory/scoring/reinforced-importance')

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'auto-1', characterId: 'char-1', content: 'Friday keeps the ledger.', summary: 'Ledger.',
    keywords: [], tags: [], importance: 0.4, embedding: new Float32Array([1, 0]), source: 'AUTO',
    sourceMessageId: null, lastAccessedAt: null, reinforcementCount: 2, lastReinforcedAt: null,
    relatedMemoryIds: [], reinforcedImportance: calculateReinforcedImportance(0.4, 2), tier: 'hot',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

let row: Memory
let memories: Record<string, jest.Mock<any>>

function setup(existing: Memory, score: number, opts: { buffered?: boolean } = {}) {
  row = { ...existing }
  memories = {
    findByIds: jest.fn(async (ids: string[]) => (ids.includes(row.id) ? [{ ...row }] : [])),
    updateForCharacter: jest.fn(async (_c: string, _id: string, patch: Partial<Memory>) => {
      row = { ...row, ...patch }
      return opts.buffered ? undefined : { ...row }
    }),
    incrementReinforcement: jest.fn(async (_c: string, _id: string, at: string, by = 1) => {
      const reinforcementCount = (row.reinforcementCount ?? 1) + by
      row = {
        ...row,
        reinforcementCount,
        lastReinforcedAt: at,
        reinforcedImportance: calculateReinforcedImportance(row.importance, reinforcementCount),
      }
      return opts.buffered
        ? undefined
        : { reinforcementCount, lastReinforcedAt: at, reinforcedImportance: row.reinforcedImportance }
    }),
    create: jest.fn(),
  }
  factoryMock.getRepositories.mockReturnValue({ memories, chatSettings: { findByUserId: jest.fn(async () => null) } })
  indexMock.memoryIndex.search.mockResolvedValue([
    { id: row.id, score, metadata: { memoryId: row.id, characterId: row.characterId, tier: 'hot' } },
  ])
  indexMock.memoryIndex.upsert.mockResolvedValue([])
  indexMock.memoryIndex.setTier.mockResolvedValue(1)
  embedMock.generateEmbeddingForUser.mockResolvedValue({ embedding: new Float32Array([1, 0]) })
}

const manual = {
  characterId: 'char-1',
  content: 'Friday keeps the ledger.',
  summary: 'Ledger.',
  importance: 0.9,
  source: 'MANUAL' as const,
  witnessedContext: 'manual' as const,
}

describe('manual create folded into an AUTO row', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each([
    ['SKIP_NEAR_DUPLICATE', 0.95],
    ['REINFORCE', 0.87],
  ])('%s with promoteOnMatch: survivor becomes MANUAL at the higher importance', async (action, score) => {
    setup(makeMemory(), score)
    const outcome = await service.createMemoryWithGate(manual, { userId: 'u1', promoteOnMatch: true })

    expect(outcome.action).toBe(action)
    expect(row.source).toBe('MANUAL')
    expect(row.importance).toBe(0.9)
    expect(row.reinforcedImportance).toBeCloseTo(calculateReinforcedImportance(0.9, row.reinforcementCount!))
    expect(outcome.memory).toMatchObject({ source: 'MANUAL', importance: 0.9 })
    expect(memories.create).not.toHaveBeenCalled()
  })

  it('never lowers the existing importance', async () => {
    setup(makeMemory({ importance: 0.95, reinforcedImportance: calculateReinforcedImportance(0.95, 2) }), 0.95)
    await service.createMemoryWithGate({ ...manual, importance: 0.2 }, { userId: 'u1', promoteOnMatch: true })
    expect(row.source).toBe('MANUAL')
    expect(row.importance).toBe(0.95)
  })

  it('a digest survivor keeps its CONSOLIDATED source', async () => {
    setup(makeMemory({ source: 'CONSOLIDATED' }), 0.95)
    await service.createMemoryWithGate(manual, { userId: 'u1', promoteOnMatch: true })
    expect(row.source).toBe('CONSOLIDATED')
    expect(row.importance).toBe(0.9)
  })

  it('works in the job child, where writes buffer', async () => {
    setup(makeMemory(), 0.95, { buffered: true })
    const outcome = await service.createMemoryWithGate(manual, { userId: 'u1', promoteOnMatch: true })
    expect(row.source).toBe('MANUAL')
    expect(outcome.memory).toMatchObject({ source: 'MANUAL', importance: 0.9 })
  })

  it('without promoteOnMatch (extraction) the survivor stays AUTO', async () => {
    setup(makeMemory(), 0.95)
    await service.createMemoryWithGate({ ...manual, source: 'AUTO' }, { userId: 'u1' })
    expect(row.source).toBe('AUTO')
    expect(row.importance).toBe(0.4)
  })
})
