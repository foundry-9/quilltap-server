/**
 * Bug 200 — an orphan vector must not blind the gate.
 *
 * A vector whose memory row is gone used to stand at rank 1 with no row behind
 * it: `bestMemory` was undefined, the near-duplicate and reinforce branches
 * were skipped, and a live second match at ≥ 0.85 was never considered, so
 * the candidate was inserted as new. The gate now decides on live rows only.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getCharacterVectorStore: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class EmbeddingError extends Error {},
}))

jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: jest.fn((_kind: string, fn: () => unknown) => fn()),
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}))

import { runMemoryGate } from '@/lib/memory/memory-gate'
import { getRepositories } from '@/lib/repositories/factory'
import { getCharacterVectorStore } from '@/lib/embedding/vector-store'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import type { Memory } from '@/lib/schemas/types'

const mockedRepos = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockedStore = getCharacterVectorStore as jest.MockedFunction<typeof getCharacterVectorStore>
const mockedEmbed = generateEmbeddingForUser as jest.MockedFunction<typeof generateEmbeddingForUser>

const liveMemory = {
  id: 'live',
  characterId: 'char-1',
  content: 'Charlie likes lighthouses.',
  summary: 'Likes lighthouses',
  importance: 0.6,
  reinforcedImportance: 0.6,
  reinforcementCount: 1,
  tier: 'hot',
  source: 'AUTO',
  relatedMemoryIds: [],
} as unknown as Memory

function hit(id: string, score: number) {
  return { id, score, metadata: { memoryId: id, characterId: 'char-1' } }
}

describe('runMemoryGate — orphan vectors (bug 200)', () => {
  let search: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockedEmbed.mockResolvedValue({ embedding: new Float32Array([1, 0, 0]) } as never)
    search = jest.fn()
    mockedStore.mockResolvedValue({ search } as never)
    mockedRepos.mockReturnValue({
      memories: {
        // Only the live row exists; 'orphan' has a vector and no row.
        findByIds: jest.fn(async (ids: string[]) => ids.includes('live') ? [liveMemory] : []),
      },
    } as never)
  })

  it('reinforces the live match behind an orphan at rank 1', async () => {
    search.mockReturnValue([hit('orphan', 0.97), hit('live', 0.88)])

    const result = await runMemoryGate('char-1', 'Charlie loves lighthouses.', 'Loves lighthouses', [], 'user-1')

    expect(result.decision).toMatchObject({ action: 'REINFORCE', existingMemory: { id: 'live' } })
  })

  it('absorbs a live near-duplicate behind an orphan', async () => {
    search.mockReturnValue([hit('orphan', 0.99), hit('live', 0.93)])

    const result = await runMemoryGate('char-1', 'Charlie likes lighthouses.', 'Likes lighthouses', [], 'user-1')

    expect(result.decision).toMatchObject({ action: 'SKIP_NEAR_DUPLICATE', existingMemory: { id: 'live' } })
  })

  it('inserts when every hit is an orphan', async () => {
    search.mockReturnValue([hit('orphan', 0.99)])

    const result = await runMemoryGate('char-1', 'Charlie likes lighthouses.', 'Likes lighthouses', [], 'user-1')

    expect(result.decision.action).toBe('INSERT')
  })
})
