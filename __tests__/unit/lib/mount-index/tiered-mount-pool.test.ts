import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockFindCharacterById = jest.fn()
const mockFindProjectMountLinks = jest.fn()
const mockFindChatById = jest.fn()
const mockGetGeneralMountPointId = jest.fn()
const mockGetRepositories = jest.fn()
// Group tier mocks
const mockFindMembersByCharacterId = jest.fn()
const mockFindGroupByIdRaw = jest.fn()
const mockFindGroupLinks = jest.fn()
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
  resolveGroupMountPointIdsForCharacter,
} = require('@/lib/mount-index/tiered-mount-pool') as typeof import('@/lib/mount-index/tiered-mount-pool')

describe('tiered-mount-pool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue({
      characters: { findById: mockFindCharacterById },
      projectDocMountLinks: { findByProjectId: mockFindProjectMountLinks },
      chats: { findById: mockFindChatById },
      groupCharacterMembers: { findByCharacterId: mockFindMembersByCharacterId },
      groups: { findByIdRaw: mockFindGroupByIdRaw },
      groupDocMountLinks: { findByGroupId: mockFindGroupLinks },
    })
    mockFindProjectMountLinks.mockResolvedValue([])
    mockGetGeneralMountPointId.mockResolvedValue(null)
    // Default: the responding character belongs to no groups.
    mockFindMembersByCharacterId.mockResolvedValue([])
    mockFindGroupByIdRaw.mockResolvedValue(null)
    mockFindGroupLinks.mockResolvedValue([])
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
        groupMountPointIds: [],
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

    it('precedence character > group > project > global: a shared mount lands in the closer tier', () => {
      const result = dedupeTierTriple({
        characterMountPointId: 'char',
        groupMountPointIds: ['char', 'g1', 'g2', 'g1'], // char excluded, g1 deduped
        projectMountPointIds: ['g2', 'p1', 'global'],    // g2 is a group mount → excluded; global excluded
        globalMountPointId: 'global',
      })
      expect(result).toEqual({
        characterMountPointId: 'char',
        groupMountPointIds: ['g1', 'g2'],
        projectMountPointIds: ['p1'],
        globalMountPointId: 'global',
      })
    })

    it('nulls the global mount when it equals a group mount', () => {
      const result = dedupeTierTriple({
        characterMountPointId: null,
        groupMountPointIds: ['shared'],
        projectMountPointIds: [],
        globalMountPointId: 'shared',
      })
      expect(result.globalMountPointId).toBeNull()
      expect(result.groupMountPointIds).toEqual(['shared'])
    })
  })

  describe('flattenTierPool', () => {
    const pool = {
      characterMountPointId: 'char',
      participantMountPointIds: ['part1'],
      groupMountPointIds: ['grp1'],
      projectMountPointIds: ['p1', 'p2'],
      globalMountPointId: 'global',
    }

    it('all scope unions character + group + project + global (no participants by default)', () => {
      expect(flattenTierPool(pool)).toEqual(['char', 'grp1', 'p1', 'p2', 'global'])
    })

    it('all scope folds in participants when requested', () => {
      expect(flattenTierPool(pool, { includeParticipants: true })).toEqual([
        'char', 'part1', 'grp1', 'p1', 'p2', 'global',
      ])
    })

    it('character scope yields only the character vault (not group)', () => {
      expect(flattenTierPool(pool, { scope: 'character' })).toEqual(['char'])
    })

    it('group scope yields only the group stores', () => {
      expect(flattenTierPool(pool, { scope: 'group' })).toEqual(['grp1'])
    })

    it('project scope yields only project stores (not group)', () => {
      expect(flattenTierPool(pool, { scope: 'project' })).toEqual(['p1', 'p2'])
    })
  })

  describe('classifyMountTier', () => {
    const pool = {
      characterMountPointId: 'char',
      participantMountPointIds: ['part1'],
      groupMountPointIds: ['grp1'],
      projectMountPointIds: ['p1'],
      globalMountPointId: 'global',
    }
    it('classifies each tier (character > participant > group > project > global) and returns null for outsiders', () => {
      expect(classifyMountTier('char', pool)).toBe('character')
      expect(classifyMountTier('part1', pool)).toBe('participant')
      expect(classifyMountTier('grp1', pool)).toBe('group')
      expect(classifyMountTier('p1', pool)).toBe('project')
      expect(classifyMountTier('global', pool)).toBe('global')
      expect(classifyMountTier('nope', pool)).toBeNull()
    })
  })

  describe('resolveTieredMountPool', () => {
    it('uses the pre-resolved characterMountPointId fast path (no lookup)', async () => {
      const pool = await resolveTieredMountPool({ characterMountPointId: 'char' })
      expect(pool.characterMountPointId).toBe('char')
      expect(pool.groupMountPointIds).toEqual([])
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

    // ----- Group tier -----

    it('resolves the union of the responding character\'s groups (official + linked stores)', async () => {
      // Character c1 belongs to G1 and G2.
      mockFindMembersByCharacterId.mockResolvedValue([{ groupId: 'G1' }, { groupId: 'G2' }])
      mockFindGroupByIdRaw.mockImplementation(async (id: string) => ({
        id,
        officialMountPointId: id === 'G1' ? 'g1-official' : 'g2-official',
      }))
      mockFindGroupLinks.mockImplementation(async (id: string) =>
        id === 'G1' ? [{ mountPointId: 'g1-linked' }] : [],
      )
      const pool = await resolveTieredMountPool({ characterId: 'c1', characterMountPointId: 'char' })
      expect(pool.groupMountPointIds.sort()).toEqual(['g1-linked', 'g1-official', 'g2-official'].sort())
    })

    it('keys the group tier on the RESPONDING character — a non-member resolving in the same chat sees no group stores', async () => {
      mockFindMembersByCharacterId.mockImplementation(async (characterId: string) =>
        characterId === 'member' ? [{ groupId: 'G1' }] : [],
      )
      mockFindGroupByIdRaw.mockResolvedValue({ id: 'G1', officialMountPointId: 'g1-official' })
      mockFindGroupLinks.mockResolvedValue([])

      const memberPool = await resolveTieredMountPool({ characterId: 'member', characterMountPointId: 'm' })
      expect(memberPool.groupMountPointIds).toEqual(['g1-official'])

      const nonMemberPool = await resolveTieredMountPool({ characterId: 'other', characterMountPointId: 'o' })
      expect(nonMemberPool.groupMountPointIds).toEqual([])
    })

    it('dedups the group tier against the character vault and excludes group mounts from project/global', async () => {
      mockFindMembersByCharacterId.mockResolvedValue([{ groupId: 'G1' }])
      mockFindGroupByIdRaw.mockResolvedValue({ id: 'G1', officialMountPointId: 'shared' })
      mockFindGroupLinks.mockResolvedValue([{ mountPointId: 'char' }]) // collides with vault → dropped
      mockFindProjectMountLinks.mockResolvedValue([{ mountPointId: 'shared' }, { mountPointId: 'p1' }])
      mockGetGeneralMountPointId.mockResolvedValue('shared')

      const pool = await resolveTieredMountPool({
        characterId: 'c1',
        characterMountPointId: 'char',
        projectId: 'proj1',
      })
      expect(pool.groupMountPointIds).toEqual(['shared'])      // 'char' dropped (== vault)
      expect(pool.projectMountPointIds).toEqual(['p1'])         // 'shared' removed (in group)
      expect(pool.globalMountPointId).toBeNull()                // 'shared' removed (in group)
    })

    it('excludes group mounts from the participant tier', async () => {
      mockFindMembersByCharacterId.mockResolvedValue([{ groupId: 'G1' }])
      mockFindGroupByIdRaw.mockResolvedValue({ id: 'G1', officialMountPointId: 'g1-official' })
      mockFindGroupLinks.mockResolvedValue([])
      mockFindCharacterById.mockImplementation(async (id: string) => {
        const map: Record<string, string> = { partA: 'g1-official', partB: 'vaultB' }
        return { id, userId: 'u1', characterDocumentMountPointId: map[id] ?? null }
      })
      const pool = await resolveTieredMountPool(
        { characterId: 'c1', characterMountPointId: 'char', characterIds: ['partA', 'partB'] },
        { includeParticipants: true },
      )
      // partA's vault is a group mount → excluded from participants; partB stays.
      expect(pool.participantMountPointIds).toEqual(['vaultB'])
      expect(pool.groupMountPointIds).toEqual(['g1-official'])
    })

    it('fails soft when group membership lookup throws (drops the tier)', async () => {
      mockFindMembersByCharacterId.mockRejectedValue(new Error('mount index degraded'))
      const pool = await resolveTieredMountPool({ characterId: 'c1', characterMountPointId: 'char' })
      expect(pool.groupMountPointIds).toEqual([])
      expect(pool.characterMountPointId).toBe('char')
    })

    it('does not resolve groups without a characterId', async () => {
      const pool = await resolveTieredMountPool({ characterMountPointId: 'char' })
      expect(pool.groupMountPointIds).toEqual([])
      expect(mockFindMembersByCharacterId).not.toHaveBeenCalled()
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

  describe('resolveGroupMountPointIdsForCharacter', () => {
    it('returns [] for a missing character id', async () => {
      expect(await resolveGroupMountPointIdsForCharacter(null)).toEqual([])
      expect(mockFindMembersByCharacterId).not.toHaveBeenCalled()
    })

    it('returns [] when the character belongs to no groups', async () => {
      mockFindMembersByCharacterId.mockResolvedValue([])
      expect(await resolveGroupMountPointIdsForCharacter('c1')).toEqual([])
    })

    it('unions official + linked stores across memberships and dedups', async () => {
      mockFindMembersByCharacterId.mockResolvedValue([{ groupId: 'G1' }, { groupId: 'G2' }])
      mockFindGroupByIdRaw.mockImplementation(async (id: string) => ({
        id,
        officialMountPointId: id === 'G1' ? 'shared-official' : 'shared-official', // same store in both
      }))
      mockFindGroupLinks.mockImplementation(async (id: string) =>
        id === 'G1' ? [{ mountPointId: 'g1-linked' }] : [{ mountPointId: 'g2-linked' }],
      )
      const ids = await resolveGroupMountPointIdsForCharacter('c1')
      expect(ids.sort()).toEqual(['g1-linked', 'g2-linked', 'shared-official'].sort())
    })

    it('fails soft to [] when the membership lookup throws', async () => {
      mockFindMembersByCharacterId.mockRejectedValue(new Error('degraded'))
      expect(await resolveGroupMountPointIdsForCharacter('c1')).toEqual([])
    })
  })
})
