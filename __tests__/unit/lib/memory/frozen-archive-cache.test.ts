/**
 * Phase 3a: frozen archive cache tests.
 *
 * Asserts cache hit/miss semantics by (character, chat) and generation, the
 * LRU bound, character-wide invalidation, and that the archive is sorted by
 * memory id so the formatter output is byte-stable across turns.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const findMostImportant = jest.fn<(...args: any[]) => any>()
const findHotDigests = jest.fn<(...args: any[]) => any>()

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({ memories: { findMostImportant, findHotDigests } }),
}))

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const {
  getOrComputeFrozenArchive,
  invalidateFrozenArchive,
  invalidateAllFrozenArchives,
  resetFrozenArchiveCacheForTests,
  FROZEN_ARCHIVE_SIZE,
  FROZEN_ARCHIVE_CACHE_MAX_ENTRIES,
} = require('@/lib/memory/frozen-archive-cache') as typeof import('@/lib/memory/frozen-archive-cache')

import type { Memory } from '@/lib/schemas/types'

function memory(id: string, importance = 0.7): Memory {
  return {
    id,
    characterId: 'char-1',
    content: `content of ${id}`,
    summary: `summary of ${id}`,
    keywords: [],
    tags: [],
    importance,
    source: 'AUTO',
    reinforcementCount: 1,
    relatedMemoryIds: [],
    reinforcedImportance: importance,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  } as unknown as Memory
}

describe('frozen-archive-cache', () => {
  beforeEach(() => {
    resetFrozenArchiveCacheForTests()
    findMostImportant.mockReset()
    findHotDigests.mockReset()
    findHotDigests.mockResolvedValue([])
  })

  it('hits cache when called twice with same generation', async () => {
    findMostImportant.mockResolvedValue([memory('zz-1'), memory('aa-1')])

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)

    expect(findMostImportant).toHaveBeenCalledTimes(1)
  })

  it('recomputes on generation bump', async () => {
    findMostImportant.mockResolvedValue([memory('zz-1'), memory('aa-1')])

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    await getOrComputeFrozenArchive('char-1', 'chat-1', 1)

    expect(findMostImportant).toHaveBeenCalledTimes(2)
  })

  it('returns memories sorted ascending by id (deterministic byte order)', async () => {
    findMostImportant.mockResolvedValue([
      memory('zz-1', 0.9),
      memory('aa-1', 0.8),
      memory('mm-1', 0.7),
    ])

    const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0)

    expect(archive.map(m => m.id)).toEqual(['aa-1', 'mm-1', 'zz-1'])
  })

  it('caps result at FROZEN_ARCHIVE_SIZE', async () => {
    const surplus = Array.from({ length: FROZEN_ARCHIVE_SIZE + 10 }, (_, i) =>
      memory(`id-${i.toString().padStart(3, '0')}`, 0.5 + (i / 100)),
    )
    findMostImportant.mockResolvedValue(surplus)

    const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    expect(archive.length).toBe(FROZEN_ARCHIVE_SIZE)
  })

  it('invalidateFrozenArchive forces recompute', async () => {
    findMostImportant.mockResolvedValue([memory('a-1'), memory('b-1')])

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    invalidateFrozenArchive('char-1')
    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)

    expect(findMostImportant).toHaveBeenCalledTimes(2)
  })

  it('keeps separate entries per character', async () => {
    findMostImportant.mockImplementation(async (charId: string) => {
      return charId === 'char-1' ? [memory('a-1')] : [memory('b-1')]
    })

    const a = await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    const b = await getOrComputeFrozenArchive('char-2', 'chat-1', 0)

    expect(a[0].id).toBe('a-1')
    expect(b[0].id).toBe('b-1')
  })

  it('does not hand a new chat another chat\'s generation-0 archive', async () => {
    findMostImportant.mockResolvedValueOnce([memory('old-1')]).mockResolvedValueOnce([memory('new-1')])

    const first = await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    const second = await getOrComputeFrozenArchive('char-1', 'chat-2', 0)

    expect(findMostImportant).toHaveBeenCalledTimes(2)
    expect(first[0].id).toBe('old-1')
    expect(second[0].id).toBe('new-1')
  })

  it('recomputes when the requested archive size changes', async () => {
    findMostImportant.mockResolvedValue([memory('a-1')])

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { size: 25 })
    await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { size: 25 })
    await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { size: 40 })

    expect(findMostImportant).toHaveBeenCalledTimes(2)
    expect(findMostImportant).toHaveBeenLastCalledWith('char-1', 160)
  })

  it('invalidateFrozenArchive drops every chat for that character and no other', async () => {
    findMostImportant.mockResolvedValue([memory('a-1')])

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    await getOrComputeFrozenArchive('char-1', 'chat-2', 0)
    await getOrComputeFrozenArchive('char-2', 'chat-1', 0)
    expect(findMostImportant).toHaveBeenCalledTimes(3)

    invalidateFrozenArchive('char-1')

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    await getOrComputeFrozenArchive('char-1', 'chat-2', 0)
    await getOrComputeFrozenArchive('char-2', 'chat-1', 0)
    expect(findMostImportant).toHaveBeenCalledTimes(5)
  })

  it('invalidateAllFrozenArchives drops everything', async () => {
    findMostImportant.mockResolvedValue([memory('a-1')])

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    await getOrComputeFrozenArchive('char-2', 'chat-1', 0)
    invalidateAllFrozenArchives()
    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    await getOrComputeFrozenArchive('char-2', 'chat-1', 0)

    expect(findMostImportant).toHaveBeenCalledTimes(4)
  })

  it('evicts the least recently used entry past the bound', async () => {
    findMostImportant.mockResolvedValue([memory('a-1')])

    for (let i = 0; i < FROZEN_ARCHIVE_CACHE_MAX_ENTRIES; i++) {
      await getOrComputeFrozenArchive('char-1', `chat-${i}`, 0)
    }
    // Touch chat-0 so chat-1 becomes the oldest.
    await getOrComputeFrozenArchive('char-1', 'chat-0', 0)
    await getOrComputeFrozenArchive('char-1', 'chat-overflow', 0)
    const callsBefore = findMostImportant.mock.calls.length

    await getOrComputeFrozenArchive('char-1', 'chat-0', 0)
    expect(findMostImportant.mock.calls.length).toBe(callsBefore)

    await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    expect(findMostImportant.mock.calls.length).toBe(callsBefore + 1)
  })

  describe('digest composition', () => {
    function digest(id: string): Memory {
      return { ...memory(id, 0.9), source: 'CONSOLIDATED', consolidatedFrom: ['x', 'y'] } as unknown as Memory
    }

    it('takes digests per present character, then self digests, then fills', async () => {
      findHotDigests.mockImplementation(async (_cid: string, subject: string) => {
        if (subject === 'laura') return [digest('d-laura-1'), digest('d-laura-2')]
        if (subject === 'self') return [digest('d-self-1')]
        return []
      })
      findMostImportant.mockResolvedValue([memory('m-1', 0.9), memory('m-2', 0.8)])

      const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0, {
        size: 10,
        presentCharacterIds: ['laura'],
      })

      expect(findHotDigests).toHaveBeenCalledWith('char-1', 'laura', 3)
      expect(findHotDigests).toHaveBeenCalledWith('char-1', 'self', 5)
      expect(archive.map(m => m.id)).toEqual(['d-laura-1', 'd-laura-2', 'd-self-1', 'm-1', 'm-2'])
    })

    it('dedupes a digest that also appears in the fill pool', async () => {
      findHotDigests.mockImplementation(async (_cid: string, subject: string) =>
        subject === 'self' ? [digest('dup-1')] : [])
      findMostImportant.mockResolvedValue([memory('dup-1', 0.95), memory('m-1', 0.5)])

      const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { size: 10 })
      expect(archive.map(m => m.id)).toEqual(['dup-1', 'm-1'])
    })

    it('caps the whole archive at size with digests taking priority', async () => {
      findHotDigests.mockImplementation(async (_cid: string, subject: string) =>
        subject === 'self' ? [digest('s-1'), digest('s-2'), digest('s-3')] : [])
      findMostImportant.mockResolvedValue([memory('m-1'), memory('m-2')])

      const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { size: 4 })
      expect(archive.map(m => m.id)).toEqual(['m-1', 's-1', 's-2', 's-3'])
    })

    it('is deterministic regardless of present-id order and ignores the responder', async () => {
      findHotDigests.mockImplementation(async (_cid: string, subject: string) =>
        subject === 'self' ? [] : [digest(`d-${subject}`)])
      findMostImportant.mockResolvedValue([])

      const a = await getOrComputeFrozenArchive('char-1', 'chat-a', 0, {
        size: 10,
        presentCharacterIds: ['zed', 'amy', 'char-1'],
      })
      const b = await getOrComputeFrozenArchive('char-1', 'chat-b', 0, {
        size: 10,
        presentCharacterIds: ['amy', 'zed'],
      })
      expect(a.map(m => m.id)).toEqual(['d-amy', 'd-zed'])
      expect(b.map(m => m.id)).toEqual(a.map(m => m.id))
    })

    it('recomputes when the set of present characters changes', async () => {
      findMostImportant.mockResolvedValue([])
      await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { presentCharacterIds: ['amy'] })
      await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { presentCharacterIds: ['amy'] })
      await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { presentCharacterIds: ['amy', 'bob'] })
      expect(findMostImportant).toHaveBeenCalledTimes(2)
    })
  })
})
