/**
 * @jest-environment node
 *
 * The Wardrobe's location chokepoint, as the Inventory's is pinned in
 * `__tests__/unit/lib/inventory/chokepoints.test.ts`: every write through a
 * wardrobe location publishes the `wardrobe` realtime topic once it lands
 * (reads never do, nor a write that matched nothing), and a job child's
 * buffered write to a `Wardrobe/` file names the topic at commit.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn(async () => 'general-mp') }))
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/mount-index/shared-wardrobe', () => ({ ensureSharedWardrobeFolder: jest.fn() }))

const ITEM = { id: 'item-1', title: 'Opera coat', folder: '' }
const mockWrites = {
  readMountItems: jest.fn(async () => [ITEM]),
  createInMount: jest.fn(async (_m: unknown, item: unknown) => item),
  updateManyInMount: jest.fn(async () => [ITEM]),
  deleteInMount: jest.fn(async () => true),
  listFoldersInMount: jest.fn(async () => []),
  listFolderPathsInMount: jest.fn(async () => ['Coats']),
  createFolderInMount: jest.fn(async () => ({ path: 'Coats' })),
  renameFolderInMount: jest.fn(async () => ({ path: 'Cloaks' })),
  deleteFolderInMount: jest.fn(async () => ({ movedItems: 0, movedFolders: 0 })),
  resolveWardrobeMount: jest.fn(),
}
jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => mockWrites)

// Required after the mocks: `mockWrites` is initialised above, and an import
// would be hoisted past it.
const { publishRealtime } = require('@/lib/realtime/bus') as typeof import('@/lib/realtime/bus')
const { resolveWardrobeLocation } = require('@/lib/wardrobe/location') as typeof import('@/lib/wardrobe/location')
const { topicsForWriteBatch } = require('@/lib/realtime/job-topics') as typeof import('@/lib/realtime/job-topics')
type WardrobeLocation = import('@/lib/wardrobe/location').WardrobeLocation

const published = () => (publishRealtime as jest.Mock).mock.calls.filter(([topic]) => topic === 'wardrobe').length

async function general(): Promise<WardrobeLocation> {
  return (await resolveWardrobeLocation('general', null, {} as never, 'user-1')) as WardrobeLocation
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('a wardrobe location write', () => {
  it('publishes the wardrobe topic on every item write; a read publishes nothing', async () => {
    const loc = await general()
    await loc.readItems(true)
    await loc.findItem(ITEM.id)
    await loc.listFolders()
    await loc.resolveFolder('Coats')
    expect(published()).toBe(0)

    await loc.create(ITEM as never)
    expect(published()).toBe(1)
    await loc.update(ITEM.id, { title: 'Evening coat' })
    expect(published()).toBe(2)
    await loc.updateMany([{ id: ITEM.id, patch: { folder: 'Coats' } }])
    expect(published()).toBe(3)
    await loc.delete(ITEM.id)
    expect(published()).toBe(4)
  })

  it('publishes on every folder write', async () => {
    const loc = await general()
    await loc.createFolder('Coats')
    await loc.renameFolder('Coats', 'Cloaks')
    await loc.deleteFolder('Cloaks')
    expect(published()).toBe(3)
  })

  it('publishes nothing for a write that matched nothing', async () => {
    const loc = await general()
    mockWrites.updateManyInMount.mockResolvedValueOnce([])
    mockWrites.deleteInMount.mockResolvedValueOnce(false)
    expect(await loc.update('stale', { title: 'gone' })).toBeNull()
    expect(await loc.delete('stale')).toBe(false)
    expect(published()).toBe(0)
  })

  it('publishes nothing when the write throws', async () => {
    const loc = await general()
    mockWrites.createFolderInMount.mockRejectedValueOnce(new Error('taken'))
    await expect(loc.createFolder('Coats')).rejects.toThrow('taken')
    expect(published()).toBe(0)
  })
})

describe('a job child\'s buffered wardrobe write', () => {
  it('names the wardrobe topic once per batch for a Wardrobe/ file', () => {
    const hints = topicsForWriteBatch([
      { method: 'docMountDocuments.upsert', args: [{ mountPointId: 'mp-1', relativePath: 'Wardrobe/coat.md' }] },
      { method: 'docMountDocuments.delete', args: ['mp-1', 'Wardrobe/hat.md'] },
    ])
    expect(hints.filter((hint) => hint.topic === 'wardrobe')).toEqual([{ topic: 'wardrobe' }])
  })

  it('names it for a buffered wardrobe repository write too', () => {
    expect(topicsForWriteBatch([{ method: 'wardrobe.update', args: ['item-1', {}] }])).toEqual([{ topic: 'wardrobe' }])
  })

  it('does not name it for a write elsewhere in the store, or for an Inventory/ file', () => {
    const hints = topicsForWriteBatch([
      { method: 'docMountDocuments.upsert', args: [{ mountPointId: 'mp-1', relativePath: 'Notes/Wardrobe ideas.md' }] },
      { method: 'docMountDocuments.upsert', args: [{ mountPointId: 'mp-1', relativePath: 'Inventory/rope.json' }] },
    ])
    expect(hints.some((hint) => hint.topic === 'wardrobe')).toBe(false)
    expect(hints).toContainEqual({ topic: 'inventory' })
  })
})
