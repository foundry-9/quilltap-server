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
// Keystone rows by holder; findKeystones filters them as the repository does.
let keystoneRows: Memory[] = []
const findKeystones = jest.fn(async (holder: string, subjects: readonly string[] | 'self') =>
  keystoneRows.filter(m => m.characterId === holder && (subjects === 'self'
    ? !m.aboutCharacterId || m.aboutCharacterId === holder
    : !!m.aboutCharacterId && subjects.includes(m.aboutCharacterId))))

// Group membership: [groupId, characterId] rows, with group names and
// character names beside them. Empty by default — no inner circle.
let memberships: Array<[string, string]> = []
let groupNames: Record<string, string> = {}
let characterNames: Record<string, string> = {}
let archivedIds = new Set<string>()
const findNamesByIds = jest.fn(async (ids: string[], options?: { excludeArchived?: boolean }) =>
  new Map(ids
    .filter(id => characterNames[id] && !(options?.excludeArchived && archivedIds.has(id)))
    .map(id => [id, characterNames[id]] as [string, string])))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    memories: { findMostImportant, findHotDigests, findKeystones },
    groupCharacterMembers: {
      findByCharacterId: async (characterId: string) =>
        memberships.filter(([, c]) => c === characterId).map(([groupId, c]) => ({ groupId, characterId: c })),
      findByGroupId: async (groupId: string) =>
        memberships.filter(([g]) => g === groupId).map(([g, characterId]) => ({ groupId: g, characterId })),
    },
    groups: { findByIdRaw: async (id: string) => (groupNames[id] ? { id, name: groupNames[id] } : null) },
    characters: { findNamesByIds },
  }),
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
} = require('@/lib/memory/recall/archive') as typeof import('@/lib/memory/recall/archive')

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
    memberships = []
    keystoneRows = []
    groupNames = {}
    characterNames = {}
    archivedIds = new Set()
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

    expect(archive.anchors.map(m => m.id)).toEqual(['aa-1', 'mm-1', 'zz-1'])
  })

  it('caps result at FROZEN_ARCHIVE_SIZE', async () => {
    const surplus = Array.from({ length: FROZEN_ARCHIVE_SIZE + 10 }, (_, i) =>
      memory(`id-${i.toString().padStart(3, '0')}`, 0.5 + (i / 100)),
    )
    findMostImportant.mockResolvedValue(surplus)

    const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    expect(archive.anchors.length).toBe(FROZEN_ARCHIVE_SIZE)
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

    expect(a.anchors[0].id).toBe('a-1')
    expect(b.anchors[0].id).toBe('b-1')
  })

  it('does not hand a new chat another chat\'s generation-0 archive', async () => {
    findMostImportant.mockResolvedValueOnce([memory('old-1')]).mockResolvedValueOnce([memory('new-1')])

    const first = await getOrComputeFrozenArchive('char-1', 'chat-1', 0)
    const second = await getOrComputeFrozenArchive('char-1', 'chat-2', 0)

    expect(findMostImportant).toHaveBeenCalledTimes(2)
    expect(first.anchors[0].id).toBe('old-1')
    expect(second.anchors[0].id).toBe('new-1')
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
      expect(archive.anchors.map(m => m.id)).toEqual(['d-laura-1', 'd-laura-2', 'd-self-1', 'm-1', 'm-2'])
    })

    it('dedupes a digest that also appears in the fill pool', async () => {
      findHotDigests.mockImplementation(async (_cid: string, subject: string) =>
        subject === 'self' ? [digest('dup-1')] : [])
      findMostImportant.mockResolvedValue([memory('dup-1', 0.95), memory('m-1', 0.5)])

      const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { size: 10 })
      expect(archive.anchors.map(m => m.id)).toEqual(['dup-1', 'm-1'])
    })

    it('caps the whole archive at size with digests taking priority', async () => {
      findHotDigests.mockImplementation(async (_cid: string, subject: string) =>
        subject === 'self' ? [digest('s-1'), digest('s-2'), digest('s-3')] : [])
      findMostImportant.mockResolvedValue([memory('m-1'), memory('m-2')])

      const archive = await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { size: 4 })
      expect(archive.anchors.map(m => m.id)).toEqual(['m-1', 's-1', 's-2', 's-3'])
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
      expect(a.anchors.map(m => m.id)).toEqual(['d-amy', 'd-zed'])
      expect(b.anchors.map(m => m.id)).toEqual(a.anchors.map(m => m.id))
    })

    it('recomputes when the set of present characters changes', async () => {
      findMostImportant.mockResolvedValue([])
      await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { presentCharacterIds: ['amy'] })
      await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { presentCharacterIds: ['amy'] })
      await getOrComputeFrozenArchive('char-1', 'chat-1', 0, { presentCharacterIds: ['amy', 'bob'] })
      expect(findMostImportant).toHaveBeenCalledTimes(2)
    })
  })

  describe('inner circle (inner-circle-recall.md Part B)', () => {
    function digest(id: string, about: string): Memory {
      return { ...memory(id, 0.9), source: 'CONSOLIDATED', consolidatedFrom: ['x', 'y'], aboutCharacterId: about } as unknown as Memory
    }

    /** Amy's groups: a family of 3, a crew of 4, a club of 6. */
    function seedGroups() {
      groupNames = { family: 'Family', crew: 'Crew', club: 'Club' }
      characterNames = {
        amy: 'Amy', abigail: 'Abigail', laura: 'Laura',
        ariel: 'Ariel', vergil: 'Vergil',
        sarah: 'Sarah', greg: 'Greg', manjit: 'Manjit',
      }
      memberships = [
        ['family', 'amy'], ['family', 'laura'], ['family', 'abigail'],
        ['crew', 'amy'], ['crew', 'abigail'], ['crew', 'vergil'], ['crew', 'ariel'],
        ['club', 'amy'], ['club', 'sarah'], ['club', 'greg'], ['club', 'manjit'], ['club', 'ariel'], ['club', 'laura'],
      ]
      findHotDigests.mockImplementation(async (_cid: string, about: string, limit: number) =>
        about === 'self' ? [] : Array.from({ length: 4 }, (_, i) => digest(`d-${about}-${i}`, about)).slice(0, limit))
      findMostImportant.mockResolvedValue([memory('m-1', 0.9)])
    }

    it('draws each member by the tier of their tightest group, in circle order, apart from the anchors', async () => {
      seedGroups()
      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60 })

      // Tier 0 (Family): Abigail, Laura ×3. Tier 1 (Crew): Ariel, Vergil ×2. Tier 2 (Club): Greg, Manjit, Sarah ×1.
      expect(archive.circle.map(e => e.memory.id)).toEqual([
        'd-abigail-0', 'd-abigail-1', 'd-abigail-2',
        'd-laura-0', 'd-laura-1', 'd-laura-2',
        'd-ariel-0', 'd-ariel-1',
        'd-vergil-0', 'd-vergil-1',
        'd-greg-0', 'd-manjit-0', 'd-sarah-0',
      ])
      expect(archive.circle.map(e => e.tier)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2])
      expect(archive.anchors.map(m => m.id)).toEqual(['m-1'])
    })

    it('leaves out whoever is present and archived characters', async () => {
      seedGroups()
      archivedIds = new Set(['vergil'])
      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60, presentCharacterIds: ['laura'] })

      const members = new Set(archive.circle.map(e => e.characterId))
      expect(members.has('laura')).toBe(false)
      expect(members.has('vergil')).toBe(false)
      expect(members.has('abigail')).toBe(true)
      expect(findNamesByIds).toHaveBeenCalledWith(expect.any(Array), { excludeArchived: true })
      // Laura's digests are the present step's, not the circle's.
      expect(archive.anchors.map(m => m.id)).toEqual(expect.arrayContaining(['d-laura-0', 'd-laura-1', 'd-laura-2']))
    })

    it('caps the circle at its share; the loosest tier and later digests give way first', async () => {
      seedGroups()
      // size 21 → cap 7: tier 0's six rows, then the first of tier 1's ranks.
      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 21 })
      expect(archive.circle.map(e => e.memory.id)).toEqual([
        'd-abigail-0', 'd-abigail-1', 'd-abigail-2',
        'd-laura-0', 'd-laura-1', 'd-laura-2',
        'd-ariel-0',
      ])
      // Tier 2 was never read: tiers 0 and 1 already filled the cap.
      expect(findHotDigests).not.toHaveBeenCalledWith('amy', 'sarah', expect.anything())
    })

    it('takes its knobs from the caller', async () => {
      seedGroups()
      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, {
        size: 60,
        innerCircle: { share: 1, allowance: [1] },
      })
      expect(archive.circle.map(e => e.memory.id)).toEqual([
        'd-abigail-0', 'd-laura-0', 'd-ariel-0', 'd-vergil-0', 'd-greg-0', 'd-manjit-0', 'd-sarah-0',
      ])
    })

    it('holds still while the circle does, and recomputes when membership changes', async () => {
      seedGroups()
      await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60 })
      await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60 })
      expect(findMostImportant).toHaveBeenCalledTimes(1)

      memberships.push(['family', 'greg'])
      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60 })
      expect(findMostImportant).toHaveBeenCalledTimes(2)
      expect(archive.circle.find(e => e.characterId === 'greg')?.tier).toBe(0)
    })

    it('recomputes when a member is archived', async () => {
      seedGroups()
      await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60 })
      archivedIds = new Set(['abigail'])
      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60 })
      expect(findMostImportant).toHaveBeenCalledTimes(2)
      expect(archive.circle.some(e => e.characterId === 'abigail')).toBe(false)
    })
  })

  describe('keystones (inner-circle-recall.md Part C)', () => {
    function keystone(id: string, holder: string, about: string | null, createdAt: string): Memory {
      return { ...memory(id, 0.4), characterId: holder, aboutCharacterId: about, keystone: true, createdAt } as unknown as Memory
    }
    function digest(id: string, about: string): Memory {
      return { ...memory(id, 0.9), characterId: 'amy', source: 'CONSOLIDATED', consolidatedFrom: ['x'], aboutCharacterId: about } as unknown as Memory
    }

    it('lifts a present character\'s keystones into the circle section, in creation order, ahead of their digests', async () => {
      keystoneRows = [
        keystone('k-laura-2', 'amy', 'laura', '2026-02-01T00:00:00.000Z'),
        keystone('k-laura-1', 'amy', 'laura', '2026-01-01T00:00:00.000Z'),
      ]
      // The repository orders by creation; the mock hands them in that order.
      keystoneRows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      findHotDigests.mockImplementation(async (_c: string, about: string) => (about === 'laura' ? [digest('d-laura', 'laura')] : []))
      findMostImportant.mockResolvedValue([])

      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 10, presentCharacterIds: ['laura'] })

      expect(archive.circle.map(e => [e.memory.id, e.tier, e.keystone])).toEqual([
        ['k-laura-1', -1, true],
        ['k-laura-2', -1, true],
      ])
      expect(archive.anchors.map(m => m.id)).toEqual(['d-laura'])
    })

    it('keeps self keystones among the anchors', async () => {
      keystoneRows = [keystone('k-self', 'amy', 'amy', '2026-01-01T00:00:00.000Z'), keystone('k-none', 'amy', null, '2026-01-02T00:00:00.000Z')]
      findMostImportant.mockResolvedValue([])
      const archive = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 10 })
      expect(archive.anchors.map(m => m.id)).toEqual(['k-none', 'k-self'])
      expect(archive.circle).toEqual([])
    })

    it('gives a circle member\'s keystones the first lines, and keeps them when the cap cuts tighter digests', async () => {
      groupNames = { family: 'Family', club: 'Club' }
      characterNames = { amy: 'Amy', abigail: 'Abigail', greg: 'Greg' }
      memberships = [['family', 'amy'], ['family', 'abigail'], ['club', 'amy'], ['club', 'abigail'], ['club', 'greg']]
      keystoneRows = [keystone('k-greg', 'amy', 'greg', '2026-01-01T00:00:00.000Z')]
      findHotDigests.mockImplementation(async (_c: string, about: string, limit: number) =>
        about === 'self' ? [] : [0, 1, 2].map(i => digest(`d-${about}-${i}`, about)).slice(0, limit))
      findMostImportant.mockResolvedValue([])

      const roomy = await getOrComputeFrozenArchive('amy', 'chat-1', 0, { size: 60 })
      // Family (2) is tier 0 → 3 digests; the club (3) is tier 1 → 2, after Greg's keystone.
      expect(roomy.circle.map(e => e.memory.id)).toEqual(['d-abigail-0', 'd-abigail-1', 'd-abigail-2', 'k-greg', 'd-greg-0', 'd-greg-1'])

      // size 6 → cap 2: Greg's keystone (the looser tier) outlasts Abigail's later digests.
      const tight = await getOrComputeFrozenArchive('amy', 'chat-2', 0, { size: 6 })
      expect(tight.circle.map(e => e.memory.id)).toEqual(['d-abigail-0', 'k-greg'])
    })
  })
})
