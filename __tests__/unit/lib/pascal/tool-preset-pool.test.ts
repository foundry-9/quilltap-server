/**
 * Custom-tool run presets — the tier walk.
 *
 * Presets are found where definitions are found: character → group → project
 * → General, nearest first, a nearer preset of a name shadowing a farther one.
 * Every enabled store on the walk is also a save destination, in that order.
 */

import { resolveToolPresetPool } from '@/lib/pascal/tool-preset-pool'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveTieredMountPool: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {},
}))

jest.mock('@/lib/mount-index/read-file', () => ({
  readMountFileBytes: jest.fn(),
}))

import { getRepositories } from '@/lib/repositories/factory'
import { resolveTieredMountPool } from '@/lib/mount-index/tiered-mount-pool'
import { listDatabaseFiles } from '@/lib/mount-index/database-store'

const mockGetRepositories = getRepositories as jest.Mock
const mockResolvePool = resolveTieredMountPool as jest.Mock
const mockListDatabaseFiles = listDatabaseFiles as jest.Mock

/** Paths per mount id. A mount id absent from `disabled` is enabled. */
function primeMounts(files: Record<string, string[]>, disabled: string[] = []) {
  mockGetRepositories.mockReturnValue({
    docMountPoints: {
      findById: jest.fn(async (id: string) =>
        files[id]
          ? { id, name: `store-${id}`, enabled: !disabled.includes(id), mountType: 'database', basePath: '' }
          : null,
      ),
    },
  })
  mockListDatabaseFiles.mockImplementation(async (mountId: string) => {
    if (mountId === 'broken') throw new Error('index unavailable')
    return (files[mountId] ?? []).map((relativePath) => ({ kind: 'file', relativePath }))
  })
}

function primePool(pool: Partial<{
  characterMountPointId: string | null
  groupMountPointIds: string[]
  projectMountPointIds: string[]
  globalMountPointId: string | null
}>) {
  mockResolvePool.mockResolvedValue({
    characterMountPointId: null,
    participantMountPointIds: [],
    groupMountPointIds: [],
    projectMountPointIds: [],
    globalMountPointId: null,
    ...pool,
  })
}

const ctx = { userId: 'u1', characterId: 'c1', characterMountPointId: 'vault', projectId: 'p1', toolName: 'unlock' }

beforeEach(() => {
  jest.clearAllMocks()
})

describe('resolveToolPresetPool', () => {
  it('finds presets in every tier, nearest store winning a shared name', async () => {
    primeMounts({
      vault: ['Tools/unlock.aggressive.settings.json'],
      group: ['Tools/unlock.aggressive.settings.json', 'Tools/unlock.careful.settings.json'],
      project: ['Tools/unlock.quiet.settings.json'],
      general: ['Tools/unlock.careful.settings.json', 'Tools/unlock.house.settings.json'],
    })
    primePool({
      characterMountPointId: 'vault',
      groupMountPointIds: ['group'],
      projectMountPointIds: ['project'],
      globalMountPointId: 'general',
    })

    const pool = await resolveToolPresetPool(ctx)

    expect(pool.presets.map((p) => [p.name, p.mountPointId, p.tier])).toEqual([
      ['aggressive', 'vault', 'character'],
      ['careful', 'group', 'group'],
      ['house', 'general', 'global'],
      ['quiet', 'project', 'project'],
    ])
    expect(pool.presets.find((p) => p.name === 'aggressive')!.shadows.map((s) => s.mountPointId)).toEqual(['group'])
    expect(pool.presets.find((p) => p.name === 'careful')!.shadows.map((s) => s.mountPointId)).toEqual(['general'])
    expect(pool.presets.find((p) => p.name === 'aggressive')!.path).toBe('Tools/unlock.aggressive.settings.json')
  })

  it('names every enabled store on the walk as a save destination, nearest first', async () => {
    primeMounts({ vault: [], group: [], off: [], general: [] }, ['off'])
    primePool({
      characterMountPointId: 'vault',
      groupMountPointIds: ['group'],
      projectMountPointIds: ['off'],
      globalMountPointId: 'general',
    })

    const pool = await resolveToolPresetPool(ctx)

    expect(pool.stores.map((s) => [s.mountPointId, s.tier])).toEqual([
      ['vault', 'character'],
      ['group', 'group'],
      ['general', 'global'],
    ])
  })

  it("ignores other tools' presets, definitions, nested files and malformed names", async () => {
    primeMounts({
      vault: [
        'Tools/unlock.tool.json',
        'Tools/lockpick.aggressive.settings.json',
        'Tools/old/unlock.archived.settings.json',
        'Tools/unlock.Bad Name.settings.json',
        'Tools/unlock.fine.settings.json',
      ],
    })
    primePool({ characterMountPointId: 'vault' })

    const pool = await resolveToolPresetPool(ctx)

    expect(pool.presets.map((p) => p.name)).toEqual(['fine'])
  })

  it('still reads the shared tiers when the character has no vault', async () => {
    primeMounts({ general: ['Tools/unlock.house.settings.json'] })
    primePool({ globalMountPointId: 'general' })

    const pool = await resolveToolPresetPool({ ...ctx, characterMountPointId: null })

    expect(pool.presets.map((p) => [p.name, p.tier])).toEqual([['house', 'global']])
    expect(pool.stores.map((s) => s.mountPointId)).toEqual(['general'])
  })

  it('reports a store that will not list without losing the rest', async () => {
    primeMounts({ broken: [], general: ['Tools/unlock.house.settings.json'] })
    primePool({ groupMountPointIds: ['broken'], globalMountPointId: 'general' })

    const pool = await resolveToolPresetPool(ctx)

    expect(pool.unread.map((s) => s.mountPointId)).toEqual(['broken'])
    expect(pool.presets.map((p) => p.name)).toEqual(['house'])
    // Still a place a preset may be filed — listing failed, not the store.
    expect(pool.stores.map((s) => s.mountPointId)).toEqual(['broken', 'general'])
  })
})
