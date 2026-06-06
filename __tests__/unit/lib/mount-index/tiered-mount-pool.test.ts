import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockFindCharacterById = jest.fn()
const mockFindProjectMountLinks = jest.fn()
const mockFindChatById = jest.fn()
const mockGetGeneralMountPointId = jest.fn()
const mockGetRepositories = jest.fn()
const mockLogger = {
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: (...args: unknown[]) => mockGetGeneralMountPointId(...args),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockGetRepositories(),
}))

jest.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

const {
  dedupeTierTriple,
  flattenTierPool,
  classifyMountTier,
  resolveTieredMountPool,
  resolveProjectMountPointIds,
  resolveProjectMountPointIdsForChat,
} = require('@/lib/mount-index/tiered-mount-pool') as typeof import('@/lib/mount-index/tiered-mount-pool')

describe('tiered-mount-pool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue({
      characters: { findById: mockFindCharacterById },
      projectDocMountLinks: { findByProjectId: mockFindProjectMountLinks },
      chats: { findById: mockFindChatById },
    })
    mockFindProjectMountLinks.mockResolvedValue([])
    mockGetGeneralMountPointId.mockResolvedValue(null)
  })

  describe('dedupeTierTriple', () => {
    it('removes the character vault and global mount from the project list', () => {
      const result = dedupeTierTriple({
        characterMountPointId: 'char',
        projectMountPointIds: ['char', 'p1', 'global', 'p2'],
        globalMountPointId: 'global',
      })
      expect(result).toEqual({
        characterMountPointId: 'char',
        projectMountPointIds: ['p1', 'p2'],
        globalMountPointId: 'global',
      })
    })

    it('nulls the global mount when it equals the character vault', () => {
      const result = dedupeTierTriple({
        characterMountPointId: 'same',
        projectMountPointIds: [],
        globalMountPointId: 'same',
      })
      expect(result.globalMountPointId).toBeNull()
    })

    it('dedupes repeats within the project list and preserves order', () => {
      const result = dedupeTierTriple({
        characterMountPointId: null,
        projectMountPointIds: ['p2', 'p1', 'p2', 'p1'],
        globalMountPointId: null,
      })
      expect(result.projectMountPointIds).toEqual(['p2', 'p1'])
    })
  })

  describe('flattenTierPool', () => {
    const pool = {
      characterMountPointId: 'char',
      participantMountPointIds: ['part1'],
      projectMountPointIds: ['p1', 'p2'],
      globalMountPointId: 'global',
    }

    it('all scope unions character + project + global (no participants by default)', () => {
      expect(flattenTierPool(pool)).toEqual(['char', 'p1', 'p2', 'global'])
    })

    it('all scope folds in participants when requested', () => {
      expect(flattenTierPool(pool, { includeParticipants: true })).toEqual([
        'char', 'part1', 'p1', 'p2', 'global',
      ])
    })

    it('character scope yields only the character vault', () => {
      expect(flattenTierPool(pool, { scope: 'character' })).toEqual(['char'])
    })

    it('project scope yields only project stores', () => {
      expect(flattenTierPool(pool, { scope: 'project' })).toEqual(['p1', 'p2'])
    })
  })

  describe('classifyMountTier', () => {
    const pool = {
      characterMountPointId: 'char',
      participantMountPointIds: ['part1'],
      projectMountPointIds: ['p1'],
      globalMountPointId: 'global',
    }
    it('classifies each tier and returns null for outsiders', () => {
      expect(classifyMountTier('char', pool)).toBe('character')
      expect(classifyMountTier('part1', pool)).toBe('participant')
      expect(classifyMountTier('p1', pool)).toBe('project')
      expect(classifyMountTier('global', pool)).toBe('global')
      expect(classifyMountTier('nope', pool)).toBeNull()
    })
  })

  describe('resolveTieredMountPool', () => {
    it('uses the pre-resolved characterMountPointId fast path (no lookup)', async () => {
      const pool = await resolveTieredMountPool({ characterMountPointId: 'char' })
      expect(pool.characterMountPointId).toBe('char')
      expect(mockFindCharacterById).not.toHaveBeenCalled()
    })

    it('ownership gate admits the vault when the user owns the character', async () => {
      mockFindCharacterById.mockResolvedValue({
        id: 'c1', userId: 'u1', characterDocumentMountPointId: 'vault1',
      })
      const pool = await resolveTieredMountPool(
        { userId: 'u1', characterId: 'c1' },
        { requireOwnership: true },
      )
      expect(pool.characterMountPointId).toBe('vault1')
    })

    it('ownership gate excludes the vault when the user does not own the character', async () => {
      mockFindCharacterById.mockResolvedValue({
        id: 'c1', userId: 'someone-else', characterDocumentMountPointId: 'vault1',
      })
      const pool = await resolveTieredMountPool(
        { userId: 'u1', characterId: 'c1' },
        { requireOwnership: true },
      )
      expect(pool.characterMountPointId).toBeNull()
    })

    it('resolves and dedups the project tier against character + global', async () => {
      mockFindProjectMountLinks.mockResolvedValue([
        { mountPointId: 'char' },
        { mountPointId: 'p1' },
        { mountPointId: 'global' },
      ])
      mockGetGeneralMountPointId.mockResolvedValue('global')
      const pool = await resolveTieredMountPool({
        characterMountPointId: 'char',
        projectId: 'proj1',
      })
      expect(pool.projectMountPointIds).toEqual(['p1'])
      expect(pool.globalMountPointId).toBe('global')
    })

    it('tolerates an unprovisioned general mount (null)', async () => {
      mockGetGeneralMountPointId.mockResolvedValue(null)
      const pool = await resolveTieredMountPool({ characterMountPointId: 'char' })
      expect(pool.globalMountPointId).toBeNull()
    })

    it('includes participant vaults, excluding any already in another tier', async () => {
      mockFindProjectMountLinks.mockResolvedValue([{ mountPointId: 'p1' }])
      mockGetGeneralMountPointId.mockResolvedValue('global')
      mockFindCharacterById.mockImplementation(async (id: string) => {
        const map: Record<string, string> = {
          partA: 'vaultA',
          partB: 'p1', // already a project mount → must be excluded from participants
        }
        return { id, userId: 'u1', characterDocumentMountPointId: map[id] ?? null }
      })
      const pool = await resolveTieredMountPool(
        { characterMountPointId: 'char', projectId: 'proj1', characterIds: ['partA', 'partB'] },
        { includeParticipants: true },
      )
      expect(pool.participantMountPointIds).toEqual(['vaultA'])
    })
  })

  describe('resolveProjectMountPointIds', () => {
    it('returns [] for a missing project id', async () => {
      expect(await resolveProjectMountPointIds(null)).toEqual([])
      expect(mockFindProjectMountLinks).not.toHaveBeenCalled()
    })

    it('maps project links to mount ids', async () => {
      mockFindProjectMountLinks.mockResolvedValue([{ mountPointId: 'p1' }, { mountPointId: 'p2' }])
      expect(await resolveProjectMountPointIds('proj1')).toEqual(['p1', 'p2'])
    })
  })

  describe('resolveProjectMountPointIdsForChat', () => {
    it('loads the chat then resolves its project tier', async () => {
      mockFindChatById.mockResolvedValue({ id: 'chat1', projectId: 'proj1' })
      mockFindProjectMountLinks.mockResolvedValue([{ mountPointId: 'p1' }])
      expect(await resolveProjectMountPointIdsForChat('chat1')).toEqual(['p1'])
    })

    it('returns [] for a project-less chat', async () => {
      mockFindChatById.mockResolvedValue({ id: 'chat1', projectId: null })
      expect(await resolveProjectMountPointIdsForChat('chat1')).toEqual([])
    })
  })
})
