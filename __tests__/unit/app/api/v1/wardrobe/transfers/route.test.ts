// Use global `jest` so module mocks are hoisted before route import.
//
// The transfer route addresses every tier through `resolveWardrobeLocation`
// (real here). Only the folder I/O, store provisioning and the instance
// setting are mocked: each mount's `Wardrobe/` folder is an in-memory list in
// `folders`, keyed by mount id.

let mockCtx: any

jest.mock('crypto', () => ({
  randomUUID: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler: (handler: (req: any, ctx: any) => Promise<any>) => {
    return async (req: any) => handler(req, mockCtx)
  },
}))

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  WardrobeComponentCycleError: class WardrobeComponentCycleError extends Error {},
  readMountItems: jest.fn(),
  createInMount: jest.fn(),
  updateInMount: jest.fn(),
  deleteInMount: jest.fn(),
  resolveWardrobeMount: jest.fn(),
}))

jest.mock('@/lib/database/repositories/characters.repository', () => ({
  CharacterArchivedError: class CharacterArchivedError extends Error {
    constructor(id: string) {
      super(`Character ${id} is archived`)
      this.name = 'CharacterArchivedError'
    }
  },
}))

jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }))
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/mount-index/shared-wardrobe', () => ({ ensureSharedWardrobeFolder: jest.fn() }))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({ resolveGroupMountsForCharacter: jest.fn() }))
jest.mock('@/lib/wardrobe/pool', () => ({ loadWearablePool: jest.fn() }))

// Spy on the location resolver (the real one runs) so a test can see which
// lookups asked to provision.
jest.mock('@/lib/wardrobe/location', () => {
  const actual = jest.requireActual('@/lib/wardrobe/location')
  return { ...actual, resolveWardrobeLocation: jest.fn(actual.resolveWardrobeLocation) }
})

// Pictures: the transfer carries each traveller's images through
// lib/wardrobe/item-images; here they are stubbed so the item plumbing is
// what these tests exercise (item-images has its own suite).
jest.mock('@/lib/wardrobe/item-images', () => ({
  carryItemImages: jest.fn(),
  commitMovedImages: jest.fn(),
}))

import { randomUUID } from 'crypto'
import { GET, POST } from '@/app/api/v1/wardrobe/transfers/route'
import {
  createInMount,
  deleteInMount,
  readMountItems,
  resolveWardrobeMount,
} from '@/lib/database/repositories/vault-overlay/wardrobe-writes'
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository'
import { getGeneralMountPointId } from '@/lib/instance-settings'
import { ensureOwnerOfficialStore } from '@/lib/mount-index/ensure-owner-store'
import { ensureSharedWardrobeFolder } from '@/lib/mount-index/shared-wardrobe'
import { resolveGroupMountsForCharacter } from '@/lib/mount-index/tiered-mount-pool'
import { resolveWardrobeLocation } from '@/lib/wardrobe/location'
import { carryItemImages, commitMovedImages } from '@/lib/wardrobe/item-images'

const GENERAL_MOUNT = 'general-mount'

/** Each mount's `Wardrobe/` folder, in memory. */
let folders: Map<string, any[]>

function vaultOf(characterId: string) {
  return `vault-${characterId}`
}

function vaultMount(characterId: string) {
  return { mountPointId: vaultOf(characterId), scope: 'character', characterId }
}

function seed(mountPointId: string, items: any[]) {
  folders.set(mountPointId, [...items])
}

function folder(mountPointId: string): any[] {
  return folders.get(mountPointId) ?? []
}

/** Mount ids that `deleteInMount` was called against, with the item id. */
function deletes(): Array<[string, string]> {
  return (deleteInMount as jest.Mock).mock.calls.map(([mount, id]: [any, string]) => [mount.mountPointId, id])
}

/** Items written at a mount, in call order. */
function created(mountPointId?: string): any[] {
  return (createInMount as jest.Mock).mock.calls
    .filter(([mount]: [any]) => mountPointId === undefined || mount.mountPointId === mountPointId)
    .map(([, item]: [any, any]) => item)
}

function makeItem(overrides: Record<string, any>) {
  return {
    id: 'item-x',
    characterId: 'char-src',
    title: 'Item',
    description: null,
    imagePrompt: null,
    types: ['top'],
    componentItemIds: [],
    appropriateness: null,
    isDefault: false,
    replace: false,
    migratedFromClothingRecordId: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('wardrobe transfer route', () => {
  let characters: Record<string, any>
  let projects: Record<string, any>
  let groups: Record<string, any>

  beforeEach(() => {
    jest.clearAllMocks()
    folders = new Map()

    // Sequential fake UUIDs so multi-item transfers (outfit + components) get
    // distinct ids; the first minted id stays 'copy-uuid-1'.
    let uuidCounter = 0
    ;(randomUUID as jest.Mock).mockImplementation(() => `copy-uuid-${++uuidCounter}`)

    characters = {
      'char-src': { id: 'char-src', name: 'Vivienne', userId: 'user-1', characterDocumentMountPointId: vaultOf('char-src') },
      'char-dst': { id: 'char-dst', name: 'Bertie', userId: 'user-1', characterDocumentMountPointId: vaultOf('char-dst') },
    }
    projects = {}
    groups = {}

    mockCtx = {
      user: { id: 'user-1' },
      repos: {
        projects: {
          findAll: jest.fn().mockResolvedValue([]),
          findById: jest.fn(async (id: string) => projects[id] ?? null),
        },
        groups: {
          findAll: jest.fn().mockResolvedValue([]),
          findById: jest.fn(async (id: string) => groups[id] ?? null),
        },
        characters: {
          findByUserId: jest.fn().mockResolvedValue([]),
          findByIdRaw: jest.fn(async (id: string) => characters[id] ?? null),
        },
        // The wear ledger: a transfer never writes it. A move keeps the id so
        // the ledger follows; a copy is a new garment whose ledger starts empty.
        wardrobeWear: {
          incrementWears: jest.fn(),
          upsertRows: jest.fn(),
          deleteByItemIds: jest.fn(),
          foldWearerIntoUnattributed: jest.fn(),
        },
      },
    }

    ;(getGeneralMountPointId as jest.Mock).mockResolvedValue(GENERAL_MOUNT)
    ;(ensureOwnerOfficialStore as jest.Mock).mockImplementation(async (kind: string, id: string) => ({
      mountPointId: `${kind}-mount-${id}`,
    }))
    ;(ensureSharedWardrobeFolder as jest.Mock).mockResolvedValue({ folderId: 'folder-1' })
    ;(resolveGroupMountsForCharacter as jest.Mock).mockResolvedValue([])
    ;(resolveWardrobeMount as jest.Mock).mockImplementation(async (characterId: string) => {
      const character = characters[characterId]
      if (character?.archivedAt) throw new CharacterArchivedError(characterId)
      return character ? vaultMount(characterId) : null
    })
    ;(readMountItems as jest.Mock).mockImplementation(async (mount: any) =>
      folder(mount.mountPointId).map((item) => ({ ...item })),
    )
    ;(createInMount as jest.Mock).mockImplementation(async (mount: any, item: any) => {
      folders.set(mount.mountPointId, [...folder(mount.mountPointId), item])
      return item
    })
    ;(deleteInMount as jest.Mock).mockImplementation(async (mount: any, id: string) => {
      const before = folder(mount.mountPointId)
      const after = before.filter((item) => item.id !== id)
      folders.set(mount.mountPointId, after)
      return after.length !== before.length
    })
    ;(carryItemImages as jest.Mock).mockResolvedValue({ fileIdMap: new Map(), pendingMove: { repoints: [] } })
    ;(commitMovedImages as jest.Mock).mockResolvedValue(undefined)
  })

  function expectNoLedgerWrites() {
    for (const fn of Object.values(mockCtx.repos.wardrobeWear) as jest.Mock[]) {
      expect(fn).not.toHaveBeenCalled()
    }
  }

  function req(body: unknown): any {
    return {
      method: 'POST',
      url: 'http://localhost:3000/api/v1/wardrobe/transfers',
      json: async () => body,
    }
  }

  it('GET returns destination buckets for General, projects, groups, and users', async () => {
    mockCtx.repos.projects.findAll.mockResolvedValue([
      { id: 'project-2', name: 'Beta Project' },
      { id: 'project-1', name: 'Alpha Project' },
    ])
    mockCtx.repos.groups.findAll.mockResolvedValue([
      { id: 'group-1', name: 'Main Cast' },
    ])
    mockCtx.repos.characters.findByUserId.mockResolvedValue([
      { id: 'char-2', name: 'Zara' },
      { id: 'char-1', name: 'Ada' },
    ])

    const res = await GET({ method: 'GET', url: 'http://localhost:3000/api/v1/wardrobe/transfers' } as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.destinations.general).toEqual({ available: true, label: 'Quilltap General' })
    expect(body.destinations.projects).toEqual([
      { id: 'project-1', name: 'Alpha Project' },
      { id: 'project-2', name: 'Beta Project' },
    ])
    expect(body.destinations.groups).toEqual([{ id: 'group-1', name: 'Main Cast' }])
    expect(body.destinations.users).toEqual([
      { id: 'char-1', name: 'Ada' },
      { id: 'char-2', name: 'Zara' },
    ])
  })

  it('POST copy regenerates UUID for destination item', async () => {
    seed(vaultOf('char-src'), [makeItem({ id: 'item-1', title: 'Evening coat', description: 'black wool coat' })])

    const res = await POST(req({
      action: 'copy',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      sourceProjectId: null,
      destination: { scope: 'character', id: 'char-dst' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('copy')
    expect(body.wardrobeItem.id).toBe('copy-uuid-1')
    expect(body.wardrobeItem.characterId).toBe('char-dst')
    expect(created(vaultOf('char-dst'))).toEqual([expect.objectContaining({ id: 'copy-uuid-1' })])
    expect(deleteInMount).not.toHaveBeenCalled()
    // A copy is a new garment: no ledger rows are copied to the fresh id.
    expectNoLedgerWrites()
  })

  it('POST move removes source item after successful destination write', async () => {
    seed(vaultOf('char-src'), [makeItem({ id: 'item-1', title: 'Travel boots', types: ['footwear'] })])

    const res = await POST(req({
      action: 'move',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      sourceProjectId: null,
      destination: { scope: 'general' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('move')
    expect(body.wardrobeItem.id).toBe('item-1')
    expect(body.wardrobeItem.characterId).toBeNull()
    expect(created(GENERAL_MOUNT)).toHaveLength(1)
    expect(deletes()).toEqual([[vaultOf('char-src'), 'item-1']])
    const createOrder = (createInMount as jest.Mock).mock.invocationCallOrder[0]
    const deleteOrder = (deleteInMount as jest.Mock).mock.invocationCallOrder[0]
    expect(deleteOrder).toBeGreaterThan(createOrder)
  })

  it('POST move preserves the item id and history at the destination, so the wear ledger follows', async () => {
    seed(vaultOf('char-src'), [makeItem({
      id: 'item-1',
      title: 'Travel boots',
      types: ['footwear'],
      updatedAt: '2026-01-02T00:00:00.000Z',
    })])

    const res = await POST(req({
      action: 'move',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      sourceProjectId: null,
      destination: { scope: 'character', id: 'char-dst' },
    }))

    expect(res.status).toBe(200)
    expect(createInMount).toHaveBeenCalledWith(
      vaultMount('char-dst'),
      expect.objectContaining({
        id: 'item-1',
        characterId: 'char-dst',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    )
    expect(randomUUID).not.toHaveBeenCalled()
    // The ledger is keyed by item id, so nothing needs rewriting — and the
    // source-side delete must not take the item's tally with it.
    expectNoLedgerWrites()
  })

  it('POST refuses a transfer onto the same folder', async () => {
    seed(vaultOf('char-src'), [makeItem({ id: 'item-1' })])

    const res = await POST(req({
      action: 'move',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      destination: { scope: 'character', id: 'char-src' },
    }))

    expect(res.status).toBe(400)
    expect(createInMount).not.toHaveBeenCalled()
  })

  it('POST 404s when the source character is not the user\'s', async () => {
    characters['char-src'].userId = 'someone-else'
    seed(vaultOf('char-src'), [makeItem({ id: 'item-1' })])

    const res = await POST(req({
      action: 'copy',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      destination: { scope: 'general' },
    }))

    expect(res.status).toBe(404)
    expect(createInMount).not.toHaveBeenCalled()
  })

  it('POST provisions a project destination store (projects carry no userId)', async () => {
    seed(vaultOf('char-src'), [makeItem({ id: 'item-1', title: 'Travel cloak' })])
    // Project rows in this codebase don't include userId.
    projects['project-1'] = { id: 'project-1', name: 'Campaign' }

    const res = await POST(req({
      action: 'copy',
      itemId: 'item-1',
      sourceCharacterId: 'char-src',
      sourceProjectId: null,
      destination: { scope: 'project', id: 'project-1' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('copy')
    expect(ensureOwnerOfficialStore).toHaveBeenCalledWith('project', 'project-1', 'Campaign')
    expect(ensureSharedWardrobeFolder).toHaveBeenCalledWith('project-mount-project-1')
    expect(created('project-mount-project-1')).toEqual([
      expect.objectContaining({ id: 'copy-uuid-1', characterId: null }),
    ])
  })

  it('POST resolves an explicit group source without any character probing', async () => {
    groups['group-1'] = { id: 'group-1', name: 'Main Cast', officialMountPointId: 'group-mount-1' }
    seed('group-mount-1', [makeItem({ id: 'item-g1', characterId: null, title: 'Regimental sash', types: ['accessories'] })])

    const res = await POST(req({
      action: 'move',
      itemId: 'item-g1',
      source: { scope: 'group', id: 'group-1' },
      destination: { scope: 'character', id: 'char-dst' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('move')
    expect(body.wardrobeItem.characterId).toBe('char-dst')
    expect(resolveGroupMountsForCharacter).not.toHaveBeenCalled()
    // The move deletes from the group's mount folder.
    expect(deletes()).toEqual([['group-mount-1', 'item-g1']])
  })

  it('POST resolves an explicit general source and copies into a project', async () => {
    seed(GENERAL_MOUNT, [makeItem({ id: 'item-gen', characterId: null, title: 'House cloak' })])
    projects['project-1'] = { id: 'project-1', name: 'Campaign' }

    const res = await POST(req({
      action: 'copy',
      itemId: 'item-gen',
      source: { scope: 'general' },
      destination: { scope: 'project', id: 'project-1' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.action).toBe('copy')
    expect(created('project-mount-project-1')).toEqual([
      expect.objectContaining({ id: 'copy-uuid-1', characterId: null }),
    ])
    // Copy leaves the general original in place.
    expect(deleteInMount).not.toHaveBeenCalled()
  })

  it('POST rejects a body naming neither sourceCharacterId nor source', async () => {
    const res = await POST(req({
      action: 'copy',
      itemId: 'item-1',
      destination: { scope: 'general' },
    }))

    expect(res.status).toBe(400)
  })

  // -------------------------------------------------------------------------
  // Bug 192: source probing order and side effects
  // -------------------------------------------------------------------------

  describe('source probing (bug 192)', () => {
    function probe(body: Record<string, unknown> = {}) {
      return POST(req({
        action: 'move',
        itemId: 'item-1',
        sourceCharacterId: 'char-src',
        destination: { scope: 'character', id: 'char-dst' },
        ...body,
      }))
    }

    function wireGroups() {
      ;(resolveGroupMountsForCharacter as jest.Mock).mockResolvedValue([
        { group: { id: 'group-1', name: 'Main Cast' }, mountPointIds: ['group-mount-1'] },
        { group: { id: 'group-2', name: 'Understudies' }, mountPointIds: ['group-mount-2'] },
      ])
    }

    it('the vault wins over every shared tier', async () => {
      wireGroups()
      seed(vaultOf('char-src'), [makeItem({ id: 'item-1', title: 'Vault copy' })])
      seed('group-mount-1', [makeItem({ id: 'item-1', characterId: null, title: 'Group copy' })])
      seed(GENERAL_MOUNT, [makeItem({ id: 'item-1', characterId: null, title: 'General copy' })])

      const res = await probe()

      expect(res.status).toBe(200)
      expect(deletes()).toEqual([[vaultOf('char-src'), 'item-1']])
    })

    it('a group copy wins over General', async () => {
      wireGroups()
      seed('group-mount-1', [makeItem({ id: 'item-1', characterId: null, title: 'Group copy' })])
      seed(GENERAL_MOUNT, [makeItem({ id: 'item-1', characterId: null, title: 'General copy' })])

      const res = await probe()
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.wardrobeItem.title).toBe('Group copy')
      expect(deletes()).toEqual([['group-mount-1', 'item-1']])
    })

    it('a group copy wins over the project — groups are probed before the project', async () => {
      wireGroups()
      projects['project-1'] = { id: 'project-1', name: 'Campaign', officialMountPointId: 'project-mount-1' }
      seed('group-mount-1', [makeItem({ id: 'item-1', characterId: null, title: 'Group copy' })])
      seed('project-mount-1', [makeItem({ id: 'item-1', characterId: null, title: 'Project copy' })])

      const res = await probe({ sourceProjectId: 'project-1' })
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.wardrobeItem.title).toBe('Group copy')
      expect(deletes()).toEqual([['group-mount-1', 'item-1']])
    })

    it('the later group shadows the earlier one, so it is probed first', async () => {
      wireGroups()
      seed('group-mount-1', [makeItem({ id: 'item-1', characterId: null, title: 'First group' })])
      seed('group-mount-2', [makeItem({ id: 'item-1', characterId: null, title: 'Second group' })])

      const body = await (await probe()).json()

      expect(body.wardrobeItem.title).toBe('Second group')
      expect(deletes()).toEqual([['group-mount-2', 'item-1']])
    })

    it('the project wins over General', async () => {
      projects['project-1'] = { id: 'project-1', name: 'Campaign', officialMountPointId: 'project-mount-1' }
      seed('project-mount-1', [makeItem({ id: 'item-1', characterId: null, title: 'Project copy' })])
      seed(GENERAL_MOUNT, [makeItem({ id: 'item-1', characterId: null, title: 'General copy' })])

      const body = await (await probe({ sourceProjectId: 'project-1' })).json()

      expect(body.wardrobeItem.title).toBe('Project copy')
      expect(deletes()).toEqual([['project-mount-1', 'item-1']])
    })

    it('falls through to General when no nearer tier holds the item', async () => {
      wireGroups()
      projects['project-1'] = { id: 'project-1', name: 'Campaign', officialMountPointId: 'project-mount-1' }
      seed(GENERAL_MOUNT, [makeItem({ id: 'item-1', characterId: null, title: 'General copy' })])

      const body = await (await probe({ sourceProjectId: 'project-1' })).json()

      expect(body.wardrobeItem.title).toBe('General copy')
      expect(deletes()).toEqual([[GENERAL_MOUNT, 'item-1']])
    })

    it('probing never provisions: a project with no store is skipped, not created', async () => {
      wireGroups()
      // The project exists but its official store has not been made yet.
      projects['project-1'] = { id: 'project-1', name: 'Campaign', officialMountPointId: null }
      seed(GENERAL_MOUNT, [makeItem({ id: 'item-1', characterId: null, title: 'General copy' })])

      const res = await probe({ action: 'copy', sourceProjectId: 'project-1' })

      expect(res.status).toBe(200)
      // The destination is a character vault, which provisions nothing — so
      // any provisioning call would have come from the source probe.
      expect(ensureOwnerOfficialStore).not.toHaveBeenCalled()
      expect(ensureSharedWardrobeFolder).not.toHaveBeenCalled()

      const calls = (resolveWardrobeLocation as jest.Mock).mock.calls
      const probes = calls.filter(([scope, id]: [string, string]) => !(scope === 'character' && id === 'char-dst'))
      expect(probes.map(([scope]: [string]) => scope)).toEqual(['character', 'project', 'general'])
      for (const call of probes) expect(call[4]?.ensure ?? false).toBe(false)
      // Only the destination asks to provision.
      expect(calls.filter((call: any[]) => call[4]?.ensure === true)).toEqual([
        ['character', 'char-dst', mockCtx.repos, 'user-1', { ensure: true }],
      ])
    })

    it('an explicit source is resolved without provisioning either', async () => {
      projects['project-1'] = { id: 'project-1', name: 'Campaign', officialMountPointId: null }

      const res = await POST(req({
        action: 'copy',
        itemId: 'item-1',
        source: { scope: 'project', id: 'project-1' },
        destination: { scope: 'character', id: 'char-dst' },
      }))

      expect(res.status).toBe(404)
      expect(ensureOwnerOfficialStore).not.toHaveBeenCalled()
      expect(ensureSharedWardrobeFolder).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Composite (outfit) transfers with components
  // -------------------------------------------------------------------------

  /**
   * Fixture: outfit-1 bundles comp-a and comp-b; comp-b is itself a composite
   * bundling comp-c plus shared-gen (which lives in General, NOT the source
   * container, so it must never travel or be remapped).
   */
  function wireCompositeTransfer() {
    const compA = makeItem({ id: 'comp-a', title: 'Coat', types: ['top'] })
    const compC = makeItem({ id: 'comp-c', title: 'Cufflinks', types: ['accessories'] })
    const compB = makeItem({
      id: 'comp-b',
      title: 'Formal set',
      types: ['accessories'],
      componentItemIds: ['comp-c', 'shared-gen'],
    })
    const outfit = makeItem({
      id: 'outfit-1',
      title: 'Sunday Best',
      types: ['top', 'accessories'],
      componentItemIds: ['comp-a', 'comp-b'],
    })
    seed(vaultOf('char-src'), [outfit, compA, compB, compC])
    return { outfit }
  }

  it('POST copy with components: components get fresh ids and the outfit is rewired to them', async () => {
    wireCompositeTransfer()

    const res = await POST(req({
      action: 'copy',
      itemId: 'outfit-1',
      sourceCharacterId: 'char-src',
      components: 'copy',
      destination: { scope: 'general' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.componentsTransferred).toBe(3)
    expect(body.unresolvedComponentIds).toBeUndefined()

    // Components minted ids in closure order (comp-a, comp-b, comp-c), the
    // outfit last.
    const byTitle = Object.fromEntries(created(GENERAL_MOUNT).map((i) => [i.title, i]))
    expect(byTitle['Coat'].id).toBe('copy-uuid-1')
    expect(byTitle['Formal set'].id).toBe('copy-uuid-2')
    expect(byTitle['Cufflinks'].id).toBe('copy-uuid-3')
    expect(body.wardrobeItem.id).toBe('copy-uuid-4')

    // The IDs MATCH: the stored outfit references exactly the new component
    // ids, and the nested composite is rewired too — except shared-gen, which
    // never travelled and keeps its original reference.
    expect(body.wardrobeItem.componentItemIds).toEqual(['copy-uuid-1', 'copy-uuid-2'])
    expect(byTitle['Formal set'].componentItemIds).toEqual(['copy-uuid-3', 'shared-gen'])

    // Copy leaves the source untouched.
    expect(deleteInMount).not.toHaveBeenCalled()
  })

  it('POST move with components moved: every id is kept and every piece leaves the source', async () => {
    wireCompositeTransfer()

    const res = await POST(req({
      action: 'move',
      itemId: 'outfit-1',
      sourceCharacterId: 'char-src',
      components: 'move',
      destination: { scope: 'general' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.componentsTransferred).toBe(3)
    expect(body.wardrobeItem.id).toBe('outfit-1')
    expect(body.wardrobeItem.componentItemIds).toEqual(['comp-a', 'comp-b'])
    const byTitle = Object.fromEntries(created(GENERAL_MOUNT).map((i) => [i.title, i]))
    expect(byTitle['Formal set'].componentItemIds).toEqual(['comp-c', 'shared-gen'])

    // The outfit and all three components were removed from the character.
    const deletedIds = deletes().map(([, id]) => id)
    expect(deletedIds.sort()).toEqual(['comp-a', 'comp-b', 'comp-c', 'outfit-1'])
    expect(folder(vaultOf('char-src'))).toEqual([])
  })

  it('POST move with components copied: the moved outfit points at the fresh copies, originals stay', async () => {
    wireCompositeTransfer()

    const res = await POST(req({
      action: 'move',
      itemId: 'outfit-1',
      sourceCharacterId: 'char-src',
      components: 'copy',
      destination: { scope: 'general' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    // The outfit keeps its id (move) but references the copies (which minted
    // copy-uuid-1..3), not the originals left behind at the source.
    expect(body.wardrobeItem.id).toBe('outfit-1')
    expect(body.wardrobeItem.componentItemIds).toEqual(['copy-uuid-1', 'copy-uuid-2'])
    // Only the outfit left the source — the component originals stay.
    expect(deletes()).toEqual([[vaultOf('char-src'), 'outfit-1']])
  })

  it('POST refuses copying an outfit while moving its components', async () => {
    wireCompositeTransfer()

    const res = await POST(req({
      action: 'copy',
      itemId: 'outfit-1',
      sourceCharacterId: 'char-src',
      components: 'move',
      destination: { scope: 'general' },
    }))

    expect(res.status).toBe(400)
    expect(createInMount).not.toHaveBeenCalled()
  })

  it('POST refuses the whole transfer before writing when a component id is taken at the destination', async () => {
    wireCompositeTransfer()
    // The destination already holds an item with comp-b's id.
    seed(GENERAL_MOUNT, [makeItem({ id: 'comp-b', characterId: null })])

    const res = await POST(req({
      action: 'move',
      itemId: 'outfit-1',
      sourceCharacterId: 'char-src',
      components: 'move',
      destination: { scope: 'general' },
    }))

    expect(res.status).toBe(400)
    // All-or-nothing: nothing was created and nothing was deleted.
    expect(createInMount).not.toHaveBeenCalled()
    expect(deleteInMount).not.toHaveBeenCalled()
  })

  it('POST with components omitted transfers the outfit alone with references untouched', async () => {
    wireCompositeTransfer()

    const res = await POST(req({
      action: 'copy',
      itemId: 'outfit-1',
      sourceCharacterId: 'char-src',
      destination: { scope: 'general' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.componentsTransferred).toBe(0)
    expect(body.wardrobeItem.componentItemIds).toEqual(['comp-a', 'comp-b'])
    expect(created(GENERAL_MOUNT)).toHaveLength(1)
  })

  describe('pictures travel with the item', () => {
    beforeEach(() => {
      seed(vaultOf('char-src'), [makeItem({ id: 'item-1', title: 'Linen shirt', imageFileId: 'file-old' })])
    })

    it('a copy carries the pictures under the new id and points imageFileId at its own copy', async () => {
      ;(carryItemImages as jest.Mock).mockResolvedValue({
        fileIdMap: new Map([['file-old', 'file-new']]),
        pendingMove: { repoints: [] },
      })

      const res = await POST(req({
        action: 'copy',
        itemId: 'item-1',
        sourceCharacterId: 'char-src',
        sourceProjectId: null,
        destination: { scope: 'character', id: 'char-dst' },
      }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(carryItemImages).toHaveBeenCalledWith(mockCtx.repos, {
        mode: 'copy',
        sourceItemId: 'item-1',
        destinationItemId: 'copy-uuid-1',
        destinationMountPointId: vaultOf('char-dst'),
        userId: 'user-1',
      })
      expect(created(vaultOf('char-dst'))[0].imageFileId).toBe('file-new')
      expect(body.wardrobeItem.imageFileId).toBe('file-new')
      expect(commitMovedImages).not.toHaveBeenCalled()
    })

    it('a move from an archived source is refused (409) before anything is written', async () => {
      characters['char-src'].archivedAt = '2026-09-01T00:00:00.000Z'

      const res = await POST(req({
        action: 'move',
        itemId: 'item-1',
        sourceCharacterId: 'char-src',
        sourceProjectId: null,
        destination: { scope: 'general' },
      }))

      expect(res.status).toBe(409)
      expect(carryItemImages).not.toHaveBeenCalled()
      expect(createInMount).not.toHaveBeenCalled()
      expect(deleteInMount).not.toHaveBeenCalled()
    })

    it('a copy into an archived character is refused (409) before anything is written', async () => {
      characters['char-dst'].archivedAt = '2026-09-01T00:00:00.000Z'

      const res = await POST(req({
        action: 'copy',
        itemId: 'item-1',
        sourceCharacterId: 'char-src',
        destination: { scope: 'character', id: 'char-dst' },
      }))

      expect(res.status).toBe(409)
      expect(carryItemImages).not.toHaveBeenCalled()
      expect(createInMount).not.toHaveBeenCalled()
    })

    it('a move re-links the pictures and commits the repoints only after the source item is gone', async () => {
      const pending = {
        repoints: [{
          fileId: 'file-old',
          storageKey: `mount-blob:${GENERAL_MOUNT}:blob-1`,
          sourceLink: { mountPointId: vaultOf('char-src'), leafName: '20261007-120000-generated-abcd1234.webp' },
        }],
      }
      ;(carryItemImages as jest.Mock).mockResolvedValue({
        fileIdMap: new Map([['file-old', 'file-old']]),
        pendingMove: pending,
      })

      const res = await POST(req({
        action: 'move',
        itemId: 'item-1',
        sourceCharacterId: 'char-src',
        sourceProjectId: null,
        destination: { scope: 'general' },
      }))

      expect(res.status).toBe(200)
      expect((carryItemImages as jest.Mock).mock.calls[0][1]).toMatchObject({
        mode: 'move',
        sourceItemId: 'item-1',
        destinationItemId: 'item-1',
        destinationMountPointId: GENERAL_MOUNT,
      })
      expect(created(GENERAL_MOUNT)[0].imageFileId).toBe('file-old')
      expect(commitMovedImages).toHaveBeenCalledWith(mockCtx.repos, 'item-1', pending)
      const deleteOrder = (deleteInMount as jest.Mock).mock.invocationCallOrder[0]
      const dropOrder = (commitMovedImages as jest.Mock).mock.invocationCallOrder[0]
      expect(dropOrder).toBeGreaterThan(deleteOrder)
    })
  })
})
