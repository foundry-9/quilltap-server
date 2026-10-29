/**
 * listWardrobeGalleryImages (lib/wardrobe/gallery-images.ts): reads the
 * character's wearable pool with no project tier, keeps only GENERATED IMAGE
 * files linked to a reachable item, captions each with the item's title and
 * tier, flags archived items and the item's current pick, and sorts newest
 * first. A missing character throws; an archived one returns nothing.
 *
 * @jest-environment node
 */

jest.mock('@/lib/logger', () => {
  const mock = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

jest.mock('@/lib/wardrobe/pool', () => ({
  loadWearablePool: jest.fn(),
}))

jest.mock('@/lib/wardrobe/item-images', () => ({
  wardrobeImageUrl: (id: string) => `/api/v1/files/${id}`,
  wardrobeImageThumbnailUrl: (id: string) => `/api/v1/files/${id}?action=thumbnail`,
}))

import { listWardrobeGalleryImages, OWN_WARDROBE_LABEL } from '@/lib/wardrobe/gallery-images'
import { loadWearablePool } from '@/lib/wardrobe/pool'

const mockLoadPool = loadWearablePool as jest.Mock

const CHAR = 'char-1'

function item(id: string, title: string, origin: any, extra: Record<string, unknown> = {}) {
  return { id, title, types: ['top'], origin, ...extra }
}

function file(id: string, linkedTo: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    linkedTo,
    originalFilename: `${id}.webp`,
    category: 'IMAGE',
    source: 'GENERATED',
    mimeType: 'image/webp',
    size: 100,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  }
}

function makeRepos(character: any, files: any[]) {
  return {
    characters: { findById: jest.fn().mockResolvedValue(character) },
    files: { findByLinkedToAny: jest.fn().mockResolvedValue(files) },
    wardrobe: {},
    projects: {},
    chats: {},
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('listWardrobeGalleryImages', () => {
  it('captions generated pictures across tiers, newest first', async () => {
    const own = item('i-own', 'Velvet Coat', { scope: 'character', id: CHAR, name: '' }, { imageFileId: 'f-own' })
    const grp = item('i-grp', 'Guild Sash', { scope: 'group', id: 'g1', name: 'The Guild' }, { archivedAt: '2026-09-01T00:00:00.000Z' })
    const gen = item('i-gen', 'Plain Boots', { scope: 'general', id: null, name: 'Quilltap General' })
    mockLoadPool.mockResolvedValue({ byId: new Map([own, grp, gen].map((i) => [i.id, i])) })

    const repos = makeRepos({ id: CHAR, name: 'Ada' }, [
      file('f-own', ['i-own'], { createdAt: '2026-10-01T00:00:00.000Z' }),
      file('f-grp', ['i-grp'], { createdAt: '2026-10-03T00:00:00.000Z' }),
      file('f-gen', ['i-gen'], { createdAt: '2026-10-02T00:00:00.000Z' }),
      file('f-upload', ['i-own'], { source: 'UPLOADED' }),
      file('f-doc', ['i-own'], { category: 'DOCUMENT' }),
      file('f-stray', ['not-reachable']),
    ])

    const result = await listWardrobeGalleryImages(repos, CHAR)

    expect(mockLoadPool).toHaveBeenCalledWith(repos, CHAR, [])
    expect(repos.files.findByLinkedToAny).toHaveBeenCalledWith(['i-own', 'i-grp', 'i-gen'])
    expect(result.total).toBe(3)
    expect(result.entries.map((e) => e.fileId)).toEqual(['f-grp', 'f-gen', 'f-own'])

    const [grpEntry, genEntry, ownEntry] = result.entries
    expect(grpEntry).toMatchObject({
      itemTitle: 'Guild Sash',
      scope: 'group',
      locationLabel: 'Group · The Guild',
      itemArchived: true,
      isCurrentItemImage: false,
    })
    expect(genEntry.locationLabel).toBe('Shared · Quilltap General')
    expect(ownEntry).toMatchObject({
      itemTitle: 'Velvet Coat',
      locationLabel: OWN_WARDROBE_LABEL,
      isCurrentItemImage: true,
      url: '/api/v1/files/f-own',
      thumbnailUrl: '/api/v1/files/f-own?action=thumbnail',
    })
  })

  it('returns nothing for an archived character without reading the pool', async () => {
    const repos = makeRepos({ id: CHAR, archivedAt: '2026-09-01T00:00:00.000Z' }, [])
    await expect(listWardrobeGalleryImages(repos, CHAR)).resolves.toEqual({ entries: [], total: 0 })
    expect(mockLoadPool).not.toHaveBeenCalled()
  })

  it('throws for a missing character', async () => {
    const repos = makeRepos(null, [])
    await expect(listWardrobeGalleryImages(repos, CHAR)).rejects.toThrow('Character not found')
  })

  it('skips the file lookup when the pool is empty', async () => {
    mockLoadPool.mockResolvedValue({ byId: new Map() })
    const repos = makeRepos({ id: CHAR }, [])
    await expect(listWardrobeGalleryImages(repos, CHAR)).resolves.toEqual({ entries: [], total: 0 })
    expect(repos.files.findByLinkedToAny).not.toHaveBeenCalled()
  })
})
