/**
 * Wardrobe item pictures — adding one through the shared generated-file row,
 * and linking a picture another item already has (Import from image uploads
 * its photograph once and links it to every other piece).
 */

jest.mock('@/lib/wardrobe/location', () => ({
  resolveWardrobeLocation: jest.fn(),
}))

const mockWriteImage = jest.fn()
jest.mock('@/lib/file-storage/wardrobe-image-bridge', () => ({
  writeWardrobeItemImage: (...args: unknown[]) => mockWriteImage(...args),
  deleteWardrobeItemImageLink: jest.fn(),
}))

const mockReadMountBlob = jest.fn()
jest.mock('@/lib/file-storage/project-store-bridge', () => ({
  buildMountBlobStorageKey: (mount: string, blob: string) => `mount-blob:${mount}:${blob}`,
  parseMountBlobStorageKey: (key: string) => {
    const m = /^mount-blob:([^:]+):(.+)$/.exec(key)
    return m ? { mountPointId: m[1], blobId: m[2] } : null
  },
  readMountBlob: (...args: unknown[]) => mockReadMountBlob(...args),
}))

import {
  UnlinkableWardrobeImageError,
  addWardrobeItemImage,
  linkWardrobeItemImage,
  type WardrobeItemHome,
} from '@/lib/wardrobe/item-images'

const SHA = 'b'.repeat(64)

function makeHome(itemId: string): WardrobeItemHome {
  return {
    scope: 'character',
    characterId: 'char-1',
    item: { id: itemId, title: 'Opera coat', imageFileId: null },
    containerItems: [],
    resolveMount: jest.fn(async () => 'vault-1'),
    update: jest.fn(async (patch: object) => ({ id: itemId, title: 'Opera coat', ...patch })),
  } as unknown as WardrobeItemHome
}

function makeRepos(source: object | null = null) {
  return {
    files: {
      findById: jest.fn(async () => source),
      create: jest.fn(async (data: object, options?: { id?: string }) => ({ ...data, id: options?.id })),
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockWriteImage.mockImplementation(async (input: { mountPointId: string }) => ({
    storageKey: `mount-blob:${input.mountPointId}:blob-1`,
    linkId: 'link-1',
    blobId: 'blob-1',
    relativePath: 'Wardrobe/images/item-2/20261009-120000-imported.webp',
    leafName: '20261009-120000-imported.webp',
    storedMimeType: 'image/webp',
    sha256: SHA,
    sizeBytes: 42,
  }))
})

describe('addWardrobeItemImage', () => {
  it('writes a files row with the stored type and no label (bug 132)', async () => {
    const repos = makeRepos()
    const home = makeHome('item-1')
    const { file } = await addWardrobeItemImage(repos as never, home, {
      userId: 'user-1',
      kind: 'generated',
      content: Buffer.from('x'),
      contentType: 'image/webp',
      width: 800,
      height: 1200,
      generationPrompt: 'the prompt',
    })

    expect(repos.files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        originalFilename: '20261009-120000-imported.webp',
        mimeType: 'image/webp',
        size: 42,
        width: 800,
        height: 1200,
        linkedTo: ['item-1'],
        tags: ['item-1'],
        source: 'GENERATED',
        category: 'IMAGE',
        generationPrompt: 'the prompt',
        description: null,
        storageKey: 'mount-blob:vault-1:blob-1',
      }),
      expect.objectContaining({ id: expect.any(String) }),
    )
    expect(home.update).toHaveBeenCalledWith({ imageFileId: file.id })
  })
})

describe('linkWardrobeItemImage', () => {
  it('re-links the source picture\'s bytes server-side and makes the new picture current', async () => {
    const source = {
      id: 'file-src',
      category: 'IMAGE',
      source: 'IMPORTED',
      mimeType: 'image/webp',
      storageKey: 'mount-blob:vault-1:blob-1',
      width: 640,
      height: 480,
    }
    const repos = makeRepos(source)
    mockReadMountBlob.mockResolvedValue(Buffer.from('photo-bytes'))
    const home = makeHome('item-2')

    const { file } = await linkWardrobeItemImage(repos as never, home, { userId: 'user-1', sourceFileId: 'file-src' })

    expect(mockReadMountBlob).toHaveBeenCalledWith('mount-blob:vault-1:blob-1')
    expect(mockWriteImage).toHaveBeenCalledWith(expect.objectContaining({
      mountPointId: 'vault-1',
      itemId: 'item-2',
      kind: 'imported',
      content: Buffer.from('photo-bytes'),
      contentType: 'image/webp',
    }))
    expect(repos.files.create).toHaveBeenCalledWith(
      expect.objectContaining({ linkedTo: ['item-2'], source: 'IMPORTED', width: 640, height: 480 }),
      expect.anything(),
    )
    expect(file.id).not.toBe('file-src')
    expect(home.update).toHaveBeenCalledWith({ imageFileId: file.id })
  })

  it('refuses a source that is not a stored picture', async () => {
    const home = makeHome('item-2')
    await expect(
      linkWardrobeItemImage(makeRepos(null) as never, home, { userId: 'user-1', sourceFileId: 'gone' }),
    ).rejects.toBeInstanceOf(UnlinkableWardrobeImageError)

    const notAPicture = { id: 'f', category: 'DOCUMENT', storageKey: 'mount-blob:v:b', mimeType: 'text/plain' }
    await expect(
      linkWardrobeItemImage(makeRepos(notAPicture) as never, home, { userId: 'user-1', sourceFileId: 'f' }),
    ).rejects.toBeInstanceOf(UnlinkableWardrobeImageError)
    expect(mockWriteImage).not.toHaveBeenCalled()
  })
})
