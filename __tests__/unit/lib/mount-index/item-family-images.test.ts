/**
 * @jest-environment node
 *
 * The item-store kernel's pictures (`createItemImages`): a parent's pictures
 * show through for an item with none, the error classes carry the family's
 * names, and deleting the current picture promotes the next-newest.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
const files: Record<string, Array<{ id: string }>> = {}
jest.mock('@/lib/wardrobe/item-images', () => ({
  ...jest.requireActual('@/lib/wardrobe/item-images'),
  listWardrobeItemImages: jest.fn(async (_repos: unknown, itemId: string) => files[itemId] ?? []),
  toWardrobeImageSummary: jest.fn((file: { id: string }) => ({ fileId: file.id })),
  removeImageFile: jest.fn(async () => undefined),
}))

import { createItemImages, ForeignItemImageError, type ItemImageLocation } from '@/lib/mount-index/item-family-images'

type Rec = { id: string; imageFileId?: string | null; parentId?: string | null }

function location(): ItemImageLocation<Rec> & { update: jest.Mock } {
  return {
    scope: 'general',
    id: null,
    characterId: null,
    writableMountPointId: jest.fn(async () => 'mp-1'),
    update: jest.fn(async (id: string, patch: { imageFileId: string | null }) => ({ id, ...patch })),
  }
}

const images = createItemImages<Rec, Rec, ItemImageLocation<Rec>>({
  kind: 'inventory',
  imagesFolder: 'Toys/images',
  tags: { images: '[ToyImages]', generation: '[ToyImage]' },
  noun: 'toy',
  idKey: 'toyId',
  describe: (item) => `Toy ${item.id}`,
  logType: 'INVENTORY_ITEM_IMAGE',
  buildPrompt: (item) => `A toy ${item.id}`,
  noProfileMessage: 'No profile for toys',
  errorNames: { noProfile: 'NoToyImageProfileError', generation: 'ToyImageGenerationError' },
  parentOf: (item) => item.parentId,
  resolveLocation: async () => location(),
  find: async (_location, id) => ({ id }),
  resolveItem: async (_repos, _location, record) => record,
})

const repos = {} as never

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key]
})

it("shows an item's own pictures, or its parent's marked inherited when it has none", async () => {
  files['parent'] = [{ id: 'p1' }]
  expect(await images.listShown(repos, { id: 'child', parentId: 'parent' })).toEqual([{ fileId: 'p1', inherited: true }])
  files['child'] = [{ id: 'c1' }]
  expect(await images.listShown(repos, { id: 'child', parentId: 'parent' })).toEqual([{ fileId: 'c1' }])
  expect(await images.listShown(repos, { id: 'orphan' })).toEqual([])
})

it("names its error classes for the family", () => {
  expect(new images.NoProfileError().name).toBe('NoToyImageProfileError')
  expect(new images.NoProfileError().message).toBe('No profile for toys')
  const failed = new images.GenerationError('refused', null, true)
  expect(failed.name).toBe('ToyImageGenerationError')
  expect(failed.refused).toBe(true)
})

it('deleting the current picture makes the next-newest current; a foreign one is refused', async () => {
  files['t1'] = [{ id: 'new' }, { id: 'old' }]
  const loc = location()
  const home = { location: loc, record: { id: 't1', imageFileId: 'new' }, item: { id: 't1' } }
  expect(await images.remove(repos, home, 'new')).toBe('old')
  expect(loc.update).toHaveBeenCalledWith('t1', { imageFileId: 'old' })
  await expect(images.remove(repos, home, 'stranger')).rejects.toBeInstanceOf(ForeignItemImageError)
})

it('resolves a home in the named tier', async () => {
  const home = await images.resolveHome(repos, 'user-1', 'general', null, 't9')
  expect(home?.record).toEqual({ id: 't9' })
  expect(home?.item).toEqual({ id: 't9' })
})
