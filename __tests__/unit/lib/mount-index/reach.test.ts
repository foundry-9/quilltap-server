/**
 * lib/mount-index/reach.ts — the settled tier walk (Refactor 4.12).
 *
 * @jest-environment node
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockGetGeneralMountPointId = jest.fn<() => Promise<string | null>>()
const mockEnsureFolderPath = jest.fn<(mp: string, folder: string) => Promise<string>>()
const mockEnsureOwnerOfficialStore = jest.fn<(kind: string, id: string, name: string) => Promise<{ mountPointId: string; created: boolean } | null>>()

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: () => mockGetGeneralMountPointId(),
}))
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: (mp: string, folder: string) => mockEnsureFolderPath(mp, folder),
}))
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({
  ensureOwnerOfficialStore: (kind: string, id: string, name: string) => mockEnsureOwnerOfficialStore(kind, id, name),
}))
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

type Row = Record<string, unknown>
let characters: Record<string, Row>
let projects: Record<string, Row>
let groups: Record<string, Row>
let projectLinks: Record<string, string[]>
let groupLinks: Record<string, string[]>
let memberships: Record<string, string[]>

const repos = () => ({
  characters: {
    findByIdRaw: async (id: string) => characters[id] ?? null,
    findByDocumentMountPointIdRaw: async (mp: string) =>
      Object.values(characters).find((c) => c.characterDocumentMountPointId === mp) ?? null,
  },
  projects: {
    findByIdRaw: async (id: string) => projects[id] ?? null,
    findByOfficialMountPointIdRaw: async (mp: string) =>
      Object.values(projects).find((p) => p.officialMountPointId === mp) ?? null,
  },
  groups: {
    findByIdRaw: async (id: string) => groups[id] ?? null,
    findByOfficialMountPointIdRaw: async (mp: string) =>
      Object.values(groups).find((g) => g.officialMountPointId === mp) ?? null,
  },
  projectDocMountLinks: {
    findByProjectId: async (id: string) => (projectLinks[id] ?? []).map((mountPointId) => ({ mountPointId })),
  },
  groupDocMountLinks: {
    findByGroupId: async (id: string) => (groupLinks[id] ?? []).map((mountPointId) => ({ mountPointId })),
  },
  groupCharacterMembers: {
    findByCharacterId: async (id: string) => (memberships[id] ?? []).map((groupId) => ({ groupId })),
  },
})

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => repos(),
}))

const {
  bucketMounts,
  castGroupMounts,
  classifyMount,
  groupMountsFor,
  groupOriginMap,
  orderMounts,
  resolveCastPool,
  resolveOwnerStore,
} = require('@/lib/mount-index/reach') as typeof import('@/lib/mount-index/reach')
type TieredMountPool = import('@/lib/mount-index/reach').TieredMountPool

const USER = 'user-1'

beforeEach(() => {
  jest.clearAllMocks()
  mockGetGeneralMountPointId.mockResolvedValue('general')
  mockEnsureFolderPath.mockResolvedValue('folder')
  mockEnsureOwnerOfficialStore.mockImplementation(async (kind, id) => ({ mountPointId: `${kind}-new-${id}`, created: true }))
  characters = {
    ada: { id: 'ada', name: 'Ada', userId: USER, characterDocumentMountPointId: 'vault-ada' },
    bo: { id: 'bo', name: 'Bo', userId: USER, characterDocumentMountPointId: 'vault-bo' },
    gone: { id: 'gone', name: 'Gone', userId: USER, characterDocumentMountPointId: 'vault-gone', archivedAt: '2026-01-01' },
    theirs: { id: 'theirs', name: 'Theirs', userId: 'someone-else', characterDocumentMountPointId: 'vault-theirs' },
  }
  projects = {
    manor: { id: 'manor', name: 'Manor', officialMountPointId: 'proj-official' },
    bare: { id: 'bare', name: 'Bare', officialMountPointId: null },
  }
  groups = {
    first: { id: 'first', name: 'First', officialMountPointId: 'grp-first' },
    second: { id: 'second', name: 'Second', officialMountPointId: 'grp-second' },
  }
  projectLinks = { manor: ['proj-linked', 'proj-official'] }
  groupLinks = { second: ['grp-shared'], first: ['grp-shared'] }
  memberships = { ada: ['first', 'second'], bo: ['second'] }
})

describe('resolveOwnerStore', () => {
  const read = { archived: 'allow' as const }

  it('resolves General, a character vault, and a project or group official store', async () => {
    await expect(resolveOwnerStore('general', null, repos() as never, USER, read)).resolves.toMatchObject({
      scope: 'general',
      mountPointId: 'general',
      owner: { id: null },
    })
    await expect(resolveOwnerStore('character', 'ada', repos() as never, USER, read)).resolves.toMatchObject({
      scope: 'character',
      mountPointId: 'vault-ada',
      owner: { id: 'ada', name: 'Ada' },
    })
    await expect(resolveOwnerStore('project', 'manor', repos() as never, USER, read)).resolves.toMatchObject({
      scope: 'project',
      mountPointId: 'proj-official',
      owner: { id: 'manor', name: 'Manor' },
    })
  })

  it('a read never provisions: an owner with no store is null', async () => {
    await expect(resolveOwnerStore('project', 'bare', repos() as never, USER, read)).resolves.toBeNull()
    expect(mockEnsureOwnerOfficialStore).not.toHaveBeenCalled()
    expect(mockEnsureFolderPath).not.toHaveBeenCalled()
  })

  it('a writer provisions the store and heals its folder', async () => {
    const store = await resolveOwnerStore('project', 'bare', repos() as never, USER, {
      ...read,
      ensure: { folder: 'Wardrobe', onFolderFailure: 'swallow' },
    })
    expect(store?.mountPointId).toBe('project-new-bare')
    expect(mockEnsureOwnerOfficialStore).toHaveBeenCalledWith('project', 'bare', 'Bare')
    expect(mockEnsureFolderPath).toHaveBeenCalledWith('project-new-bare', 'Wardrobe')
  })

  it("a folder failure is swallowed or rethrown as the caller asks", async () => {
    mockEnsureFolderPath.mockRejectedValue(new Error('disk full'))
    await expect(
      resolveOwnerStore('general', null, repos() as never, USER, { ...read, ensure: { folder: 'Inventory', onFolderFailure: 'swallow' } }),
    ).resolves.toMatchObject({ mountPointId: 'general' })
    await expect(
      resolveOwnerStore('general', null, repos() as never, USER, { ...read, ensure: { folder: 'Scenarios', onFolderFailure: 'throw' } }),
    ).rejects.toThrow('disk full')
  })

  it("refuses another user's character, and an archived one only under archived: 'refuse'", async () => {
    await expect(resolveOwnerStore('character', 'theirs', repos() as never, USER, read)).resolves.toBeNull()
    await expect(resolveOwnerStore('character', 'gone', repos() as never, USER, read)).resolves.toMatchObject({
      mountPointId: 'vault-gone',
    })
    await expect(
      resolveOwnerStore('character', 'gone', repos() as never, USER, { archived: 'refuse' }),
    ).resolves.toBeNull()
  })

  it('a non-General scope without an id is null', async () => {
    await expect(resolveOwnerStore('group', null, repos() as never, USER, read)).resolves.toBeNull()
  })
})

describe('the group tier', () => {
  it('is in membership order, the first group claiming a shared store', async () => {
    const groupsOfAda = await groupMountsFor('ada')
    expect(groupsOfAda).toEqual([
      { group: { id: 'first', name: 'First' }, mountPointIds: ['grp-first', 'grp-shared'] },
      { group: { id: 'second', name: 'Second' }, mountPointIds: ['grp-second'] },
    ])
    const origins = groupOriginMap(groupsOfAda)
    expect([...origins.keys()]).toEqual(['grp-first', 'grp-shared', 'grp-second'])
    expect(origins.get('grp-shared')).toEqual({ scope: 'group', id: 'first', name: 'First' })
  })

  it('keeps a group with no stores of its own only when asked', async () => {
    groupLinks = { first: ['grp-x'], second: ['grp-x'] }
    groups.second = { ...groups.second, officialMountPointId: null }
    expect((await groupMountsFor('ada')).map((g) => g.group.id)).toEqual(['first'])
    expect((await groupMountsFor('ada', { includeEmpty: true })).map((g) => g.group.id)).toEqual(['first', 'second'])
  })
})

describe('a cast', () => {
  it('castGroupMounts: named groups first, then each character in cast order, deduped', async () => {
    await expect(castGroupMounts(['bo', 'ada'], ['first'])).resolves.toEqual([
      'grp-first',
      'grp-shared',
      'grp-second',
    ])
  })

  it("resolveCastPool: live cast vaults, the cast's groups, the project official-first, General", async () => {
    const pool = await resolveCastPool({
      userId: USER,
      projectId: 'manor',
      characterIds: ['ada', 'gone', 'theirs', 'bo'],
    })
    expect(pool.characterMountPointId).toBeNull()
    expect(pool.castVaults).toEqual([
      { characterId: 'ada', mountPointId: 'vault-ada' },
      { characterId: 'bo', mountPointId: 'vault-bo' },
    ])
    expect(pool.participantMountPointIds).toEqual(['vault-ada', 'vault-bo'])
    expect(pool.liveCharacterIds).toEqual(['ada', 'bo'])
    expect(pool.groupMountPointIds).toEqual(['grp-first', 'grp-shared', 'grp-second'])
    expect(pool.projectMountPointIds).toEqual(['proj-official', 'proj-linked'])
    expect(pool.globalMountPointId).toBe('general')
  })
})

describe('a pool, ordered', () => {
  const pool: TieredMountPool = {
    characterMountPointId: 'vault',
    participantMountPointIds: ['peer'],
    groupMountPointIds: ['g-z', 'g-a'],
    projectMountPointIds: ['p-official', 'p-linked'],
    globalMountPointId: 'general',
  }

  it('orderMounts: tier by tier, the pool\'s own order inside a tier — never by id', () => {
    expect(orderMounts(pool)).toEqual([
      { tier: 'character', mountPointId: 'vault' },
      { tier: 'group', mountPointId: 'g-z' },
      { tier: 'group', mountPointId: 'g-a' },
      { tier: 'project', mountPointId: 'p-official' },
      { tier: 'project', mountPointId: 'p-linked' },
      { tier: 'global', mountPointId: 'general' },
    ])
    expect(orderMounts(pool, { includeParticipants: true })[1]).toEqual({ tier: 'participant', mountPointId: 'peer' })
  })

  it('bucketMounts: the knowledge tiers with boosts, narrowed by scope', () => {
    const all = bucketMounts(pool)
    expect(all.map((b) => [b.tier, b.mountPointIds])).toEqual([
      ['character', ['vault']],
      ['group', ['g-z', 'g-a']],
      ['project', ['p-official', 'p-linked']],
      ['global', ['general']],
    ])
    expect(all[0].boost).toBeGreaterThan(all[3].boost)
    expect(bucketMounts(pool, { scope: 'group' }).map((b) => b.tier)).toEqual(['group'])
    expect(bucketMounts(pool, { participantsAsCharacter: true }).map((b) => b.mountPointIds)[1]).toEqual(['peer'])
  })
})

describe('classifyMount', () => {
  it('names General, a vault (with its archive flag), and official project and group stores', async () => {
    await expect(classifyMount('general', repos() as never)).resolves.toMatchObject({ scope: 'general', ownerId: null })
    await expect(classifyMount('vault-gone', repos() as never)).resolves.toMatchObject({
      scope: 'character',
      ownerId: 'gone',
      archived: true,
    })
    await expect(classifyMount('proj-official', repos() as never)).resolves.toMatchObject({ scope: 'project', ownerId: 'manor' })
    await expect(classifyMount('grp-second', repos() as never)).resolves.toMatchObject({ scope: 'group', ownerId: 'second' })
  })

  it('a store that is merely linked belongs to no one owner', async () => {
    await expect(classifyMount('proj-linked', repos() as never)).resolves.toBeNull()
  })
})
