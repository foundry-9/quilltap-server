/**
 * Tests for `resolveScenarioBuilderMountPool` — the by-hand assembly of "what
 * this chat could see" for a cast that has no chat (and no acting character)
 * yet. Runs against the REAL `lib/mount-index/tiered-mount-pool` helpers
 * (`dedupeTierTriple`, `resolveGroupMountPointIdsForCharacter`,
 * `resolveProjectMountPointIds`); only `getRepositories` and
 * `getGeneralMountPointId` are mocked, matching the style of
 * `lib/doc-edit/__tests__/path-resolver-opacity-group-stores.test.ts`.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { resolveScenarioBuilderMountPool } from '../mount-pool'

// ── Mocks ─────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory'
import { getGeneralMountPointId } from '@/lib/instance-settings'

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}))

const USER = 'user-1'
const OTHER_USER = 'user-2'

interface CharacterRow {
  id: string
  userId?: string | null
  archivedAt?: string | null
  characterDocumentMountPointId?: string | null
}

interface GroupMembership {
  groupId: string
}

/**
 * Builds a `getRepositories()` mock from simple lookup tables. Callers pass
 * only the pieces a given test cares about; everything else defaults to
 * "nothing found" so an unexercised tier resolves to empty rather than
 * throwing.
 */
function mockWorld(opts: {
  characters: Record<string, CharacterRow>
  memberships?: Record<string, GroupMembership[]>
  groups?: Record<string, { id: string; officialMountPointId?: string | null }>
  groupDocMountLinks?: Record<string, { mountPointId: string }[]>
  projectDocMountLinks?: { mountPointId: string }[]
}) {
  const {
    characters,
    memberships = {},
    groups = {},
    groupDocMountLinks = {},
    projectDocMountLinks = [],
  } = opts

  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findByIdRaw: jest.fn().mockImplementation(async (id: string) => characters[id] ?? null),
    },
    groupCharacterMembers: {
      findByCharacterId: jest.fn().mockImplementation(async (id: string) => memberships[id] ?? []),
    },
    groups: {
      findByIdRaw: jest.fn().mockImplementation(async (id: string) => groups[id] ?? null),
    },
    groupDocMountLinks: {
      findByGroupId: jest.fn().mockImplementation(async (id: string) => groupDocMountLinks[id] ?? []),
    },
    projectDocMountLinks: {
      findByProjectId: jest.fn().mockResolvedValue(projectDocMountLinks),
    },
  } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null)
})

describe('resolveScenarioBuilderMountPool', () => {
  it('unions both groups stores for a cast of two characters in different groups', async () => {
    mockWorld({
      characters: {
        'char-a': { id: 'char-a', userId: USER, characterDocumentMountPointId: 'vault-a' },
        'char-b': { id: 'char-b', userId: USER, characterDocumentMountPointId: 'vault-b' },
      },
      memberships: {
        'char-a': [{ groupId: 'grp-1' }],
        'char-b': [{ groupId: 'grp-2' }],
      },
      groups: {
        'grp-1': { id: 'grp-1', officialMountPointId: 'mp-group-1' },
        'grp-2': { id: 'grp-2', officialMountPointId: 'mp-group-2' },
      },
    })

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: ['char-a', 'char-b'],
    })

    expect(pool.groupMountPointIds).toEqual(
      expect.arrayContaining(['mp-group-1', 'mp-group-2']),
    )
    expect(pool.groupMountPointIds).toHaveLength(2)
  })

  it('an archived character contributes no vault and no groups', async () => {
    mockWorld({
      characters: {
        'char-archived': {
          id: 'char-archived',
          userId: USER,
          archivedAt: '2026-01-01T00:00:00.000Z',
          characterDocumentMountPointId: 'vault-archived',
        },
      },
      memberships: {
        'char-archived': [{ groupId: 'grp-archived' }],
      },
      groups: {
        'grp-archived': { id: 'grp-archived', officialMountPointId: 'mp-group-archived' },
      },
    })

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: ['char-archived'],
    })

    expect(pool.participantMountPointIds).toEqual([])
    expect(pool.groupMountPointIds).toEqual([])
  })

  it('resolves an empty projectMountPointIds when no project is given', async () => {
    mockWorld({ characters: {} })

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: [],
    })

    expect(pool.projectMountPointIds).toEqual([])
  })

  it('does not throw and leaves globalMountPointId null when the general lookup throws', async () => {
    mockWorld({ characters: {} })
    jest.mocked(getGeneralMountPointId).mockRejectedValue(new Error('not provisioned'))

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: [],
    })

    expect(pool.globalMountPointId).toBeNull()
  })

  it('does not throw and leaves globalMountPointId null when the general lookup resolves null', async () => {
    mockWorld({ characters: {} })
    jest.mocked(getGeneralMountPointId).mockResolvedValue(null)

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: [],
    })

    expect(pool.globalMountPointId).toBeNull()
  })

  it('excludes a character owned by another user: no vault, no groups', async () => {
    mockWorld({
      characters: {
        'char-foreign': {
          id: 'char-foreign',
          userId: OTHER_USER,
          characterDocumentMountPointId: 'vault-foreign',
        },
      },
      memberships: {
        'char-foreign': [{ groupId: 'grp-foreign' }],
      },
      groups: {
        'grp-foreign': { id: 'grp-foreign', officialMountPointId: 'mp-group-foreign' },
      },
    })

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: ['char-foreign'],
    })

    expect(pool.participantMountPointIds).toEqual([])
    expect(pool.groupMountPointIds).toEqual([])
  })

  it('places cast vaults in participantMountPointIds; characterMountPointId is always null', async () => {
    mockWorld({
      characters: {
        'char-a': { id: 'char-a', userId: USER, characterDocumentMountPointId: 'vault-a' },
      },
    })

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: ['char-a'],
    })

    expect(pool.participantMountPointIds).toEqual(['vault-a'])
    expect(pool.characterMountPointId).toBeNull()
  })

  it('excludes a cast vault from participantMountPointIds when it collides with a scoped tier', async () => {
    // char-a's own vault mount id is *also* char-b's group's official store —
    // an edge case, but the pool must still classify it into exactly one
    // bucket. mount-pool.ts builds `excluded` from the deduped group/project/
    // global tiers and filters vaultIds against it, so the shared id must
    // surface only in groupMountPointIds, never in participantMountPointIds.
    const SHARED_ID = 'mp-shared'
    mockWorld({
      characters: {
        'char-a': { id: 'char-a', userId: USER, characterDocumentMountPointId: SHARED_ID },
        'char-b': { id: 'char-b', userId: USER, characterDocumentMountPointId: 'vault-b' },
      },
      memberships: {
        'char-b': [{ groupId: 'grp-b' }],
      },
      groups: {
        'grp-b': { id: 'grp-b', officialMountPointId: SHARED_ID },
      },
    })

    const pool = await resolveScenarioBuilderMountPool({
      userId: USER,
      characterIds: ['char-a', 'char-b'],
    })

    expect(pool.groupMountPointIds).toEqual([SHARED_ID])
    expect(pool.participantMountPointIds).toEqual(
      expect.arrayContaining(['vault-b']),
    )
    expect(pool.participantMountPointIds).not.toContain(SHARED_ID)
    // Not duplicated anywhere in the pool.
    const allIds = [
      ...(pool.characterMountPointId ? [pool.characterMountPointId] : []),
      ...pool.participantMountPointIds,
      ...pool.groupMountPointIds,
      ...pool.projectMountPointIds,
      ...(pool.globalMountPointId ? [pool.globalMountPointId] : []),
    ]
    expect(allIds.filter((id) => id === SHARED_ID)).toHaveLength(1)
  })
})
