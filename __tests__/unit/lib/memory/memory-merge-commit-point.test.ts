/**
 * applyMemoryMerge treats the survivor patch as the commit point: once the
 * survivor has absorbed the losers' content and links, a miss on the separate
 * reinforcement step must not report the whole fold as failed — that would
 * leave the losers alive beside a survivor that already holds their details.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/embedding/vector-store', () => ({ getCharacterVectorStore: jest.fn() }))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  EmbeddingError: class extends Error {},
}))
jest.mock('@/lib/logger', () => {
  const make = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn(() => make()),
  })
  return { logger: make() }
})

import type { Memory } from '@/lib/schemas/types'

const factoryMock = jest.requireMock('@/lib/repositories/factory') as { getRepositories: jest.Mock<any> }
const vectorMock = jest.requireMock('@/lib/embedding/vector-store') as { getCharacterVectorStore: jest.Mock<any> }
const embedMock = jest.requireMock('@/lib/embedding/embedding-service') as { generateEmbeddingForUser: jest.Mock<any> }
const loggerMock = jest.requireMock('@/lib/logger') as { logger: { warn: jest.Mock<any> } }

const merge = require('@/lib/memory/memory-merge') as typeof import('@/lib/memory/memory-merge')

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-1', characterId: 'char-1', content: 'Friday keeps the ledger.', summary: 'Ledger.',
    keywords: [], tags: [], importance: 0.6, embedding: new Float32Array([0.6, 0.8]), source: 'AUTO',
    sourceMessageId: null, lastAccessedAt: null, reinforcementCount: 1, lastReinforcedAt: null,
    relatedMemoryIds: [], reinforcedImportance: 0.6,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
}

let updateForCharacter: jest.Mock<any>
let incrementReinforcement: jest.Mock<any>

beforeEach(() => {
  jest.clearAllMocks()
  updateForCharacter = jest.fn(async (characterId: string, id: string, patch: Partial<Memory>) => ({
    ...makeMemory({ id, characterId }), ...patch,
  }))
  incrementReinforcement = jest.fn(async () => null)
  factoryMock.getRepositories.mockReturnValue({ memories: { updateForCharacter, incrementReinforcement } })
  vectorMock.getCharacterVectorStore.mockResolvedValue({
    hasVector: jest.fn(() => true), updateVector: jest.fn(), addVector: jest.fn(), save: jest.fn(),
  })
  embedMock.generateEmbeddingForUser.mockResolvedValue({ embedding: new Float32Array([1, 0]) })
})

describe('applyMemoryMerge commit point', () => {
  it('returns the patched survivor when the reinforcement step misses after the patch landed', async () => {
    const survivor = makeMemory({ id: 'keep' })
    const loser = makeMemory({ id: 'loser', content: 'Friday keeps the ledger for Marguerite.' })
    const plan = merge.planMemoryMerge(survivor, [loser])

    const updated = await merge.applyMemoryMerge(survivor, plan, { userId: 'user-1' })

    expect(updateForCharacter.mock.calls[0][2]).toHaveProperty('content')
    expect(incrementReinforcement).toHaveBeenCalledTimes(1)
    expect(updated).not.toBeNull()
    expect(updated?.content).toContain('[+] Marguerite')
    expect(loggerMock.logger.warn).toHaveBeenCalled()
    // The content changed, so the survivor is still re-embedded.
    expect(embedMock.generateEmbeddingForUser).toHaveBeenCalledTimes(1)
  })

  it('still reports failure when nothing was patched and the reinforcement step misses', async () => {
    const survivor = makeMemory({ id: 'keep', content: 'Same words.' })
    const loser = makeMemory({ id: 'loser', content: 'Same words.' })
    const plan = merge.planMemoryMerge(survivor, [loser])
    expect(Object.keys(plan.patch)).toHaveLength(0)

    const updated = await merge.applyMemoryMerge(survivor, plan, { userId: 'user-1' })

    expect(updateForCharacter).not.toHaveBeenCalled()
    expect(updated).toBeNull()
  })
})
