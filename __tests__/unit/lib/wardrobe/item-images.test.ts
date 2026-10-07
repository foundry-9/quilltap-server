/**
 * Wardrobe item pictures (lib/wardrobe/item-images.ts): history, the
 * current-picture pointer, deletion with promotion, and the lifecycle hooks
 * the delete and transfer routes call.
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { FileEntry } from '@/lib/schemas/file.types'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(async () => 'general-mount'),
}))

jest.mock('@/lib/database/repositories/vault-overlay/wardrobe-writes', () => ({
  resolveWardrobeMount: jest.fn(),
  updateProjectWardrobeItem: jest.fn(),
}))

const mockWriteImage = jest.fn<(...args: any[]) => Promise<any>>()
const mockDeleteLink = jest.fn<(...args: any[]) => Promise<boolean>>()
jest.mock('@/lib/file-storage/wardrobe-image-bridge', () => ({
  writeWardrobeItemImage: (...args: unknown[]) => mockWriteImage(...args),
  deleteWardrobeItemImageLink: (...args: unknown[]) => mockDeleteLink(...args),
}))

const mockReadMountBlob = jest.fn<(...args: any[]) => Promise<Buffer | null>>()
jest.mock('@/lib/file-storage/project-store-bridge', () => ({
  buildMountBlobStorageKey: (mount: string, blob: string) => `mount-blob:${mount}:${blob}`,
  parseMountBlobStorageKey: (key: string) => {
    const m = /^mount-blob:([^:]+):(.+)$/.exec(key)
    return m ? { mountPointId: m[1], blobId: m[2] } : null
  },
  readMountBlob: (...args: unknown[]) => mockReadMountBlob(...args),
}))

jest.mock('@/lib/wardrobe/resolve-container', () => ({
  resolveWardrobeContainer: jest.fn(),
}))

const {
  addWardrobeItemImage,
  assertItemImageChoice,
  carryItemImages,
  cleanupItemImages,
  commitMovedImages,
  deleteWardrobeItemImage,
  dropSourceImageLinks,
  ForeignWardrobeImageError,
  listWardrobeItemImages,
  setCurrentWardrobeItemImage,
} = require('@/lib/wardrobe/item-images') as typeof import('@/lib/wardrobe/item-images')

const ITEM_ID = 'item-1'

function file(id: string, createdAt: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id,
    userId: 'user-1',
    sha256: `sha-${id}`,
    originalFilename: `${id}.webp`,
    mimeType: 'image/webp',
    size: 10,
    linkedTo: [ITEM_ID],
    source: 'GENERATED',
    category: 'IMAGE',
    generationPrompt: `prompt for ${id}`,
    description: 'Wardrobe image',
    tags: [ITEM_ID],
    storageKey: `mount-blob:vault-src:blob-${id}`,
    projectId: null,
    folderPath: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  } as FileEntry
}

const oldest = file('file-a', '2026-01-01T00:00:00.000Z')
const middle = file('file-b', '2026-02-01T00:00:00.000Z')
const newest = file('file-c', '2026-03-01T00:00:00.000Z')

let repos: any

function makeHome(imageFileId: string | null) {
  return {
    scope: 'character' as const,
    characterId: 'char-1',
    item: { id: ITEM_ID, title: 'Opera coat', imageFileId } as WardrobeItem,
    containerItems: [],
    resolveMount: jest.fn(async () => 'vault-src'),
    update: jest.fn(async (patch: Partial<WardrobeItem>) => ({ id: ITEM_ID, ...patch }) as WardrobeItem),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  let created = 0
  repos = {
    files: {
      // A non-image file linked to the item must never count as one of its pictures.
      findByLinkedTo: jest.fn(async () => [
        middle,
        oldest,
        file('file-doc', '2026-04-01T00:00:00.000Z', { category: 'DOCUMENT' } as Partial<FileEntry>),
        newest,
      ]),
      create: jest.fn(async (data: Record<string, unknown>, opts: { id: string }) => ({
        ...data,
        id: `copy-${++created}`,
        _requestedId: opts.id,
        createdAt: 'now',
        updatedAt: 'now',
      })),
      update: jest.fn(async () => null),
      delete: jest.fn(async () => true),
    },
  }
  mockDeleteLink.mockResolvedValue(true)
  mockReadMountBlob.mockImplementation(async (key: string) => Buffer.from(`bytes:${key}`))
  mockWriteImage.mockImplementation(async (input: any) => ({
    storageKey: `mount-blob:${input.mountPointId}:blob-dest-${input.leafName ?? 'new'}`,
    linkId: 'link-x',
    blobId: `blob-dest-${input.leafName ?? 'new'}`,
    relativePath: `Wardrobe/images/${input.itemId}/${input.leafName ?? 'new.webp'}`,
    leafName: input.leafName ?? '20261007-120000-generated.webp',
    storedMimeType: 'image/webp',
    sha256: 'sha-new',
    sizeBytes: 42,
  }))
})

describe('history', () => {
  it('lists IMAGE files only, newest first', async () => {
    const images = await listWardrobeItemImages(repos, ITEM_ID)
    expect(images.map((f) => f.id)).toEqual(['file-c', 'file-b', 'file-a'])
  })

  it('assertItemImageChoice accepts own pictures and null, refuses a foreign file', async () => {
    await expect(assertItemImageChoice(repos, ITEM_ID, 'file-b')).resolves.toBeUndefined()
    await expect(assertItemImageChoice(repos, ITEM_ID, null)).resolves.toBeUndefined()
    await expect(assertItemImageChoice(repos, ITEM_ID, undefined)).resolves.toBeUndefined()
    await expect(assertItemImageChoice(repos, ITEM_ID, 'file-elsewhere')).rejects.toBeInstanceOf(ForeignWardrobeImageError)
    // A non-image file linked to the item is not a picture either.
    await expect(assertItemImageChoice(repos, ITEM_ID, 'file-doc')).rejects.toBeInstanceOf(ForeignWardrobeImageError)
  })
})

describe('addWardrobeItemImage', () => {
  it('writes the bytes, creates a linked IMAGE row carrying the prompt, and makes it current', async () => {
    const home = makeHome(null)
    const { file: stored } = await addWardrobeItemImage(repos, home as any, {
      userId: 'user-1',
      kind: 'generated',
      content: Buffer.from('webp'),
      contentType: 'image/webp',
      generationPrompt: 'the prompt',
      generationModel: 'gpt-image-1',
    })

    expect(mockWriteImage).toHaveBeenCalledWith(expect.objectContaining({ mountPointId: 'vault-src', itemId: ITEM_ID, kind: 'generated' }))
    expect(repos.files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedTo: [ITEM_ID],
        category: 'IMAGE',
        source: 'GENERATED',
        generationPrompt: 'the prompt',
        generationModel: 'gpt-image-1',
        originalFilename: '20261007-120000-generated.webp',
        storageKey: 'mount-blob:vault-src:blob-dest-new',
      }),
      expect.objectContaining({ id: expect.any(String) }),
    )
    expect(home.update).toHaveBeenCalledWith({ imageFileId: stored.id })
  })
})

describe('setCurrentWardrobeItemImage', () => {
  it('refuses a foreign file without writing', async () => {
    const home = makeHome('file-a')
    await expect(setCurrentWardrobeItemImage(repos, home as any, 'file-foreign')).rejects.toBeInstanceOf(ForeignWardrobeImageError)
    expect(home.update).not.toHaveBeenCalled()
  })

  it('points the item at one of its own pictures', async () => {
    const home = makeHome('file-a')
    expect(await setCurrentWardrobeItemImage(repos, home as any, 'file-b')).toBe('file-b')
    expect(home.update).toHaveBeenCalledWith({ imageFileId: 'file-b' })
  })
})

describe('deleteWardrobeItemImage', () => {
  it('deleting the current picture promotes the next-newest', async () => {
    const home = makeHome('file-c')
    const current = await deleteWardrobeItemImage(repos, home as any, 'file-c')

    expect(current).toBe('file-b')
    expect(mockDeleteLink).toHaveBeenCalledWith('vault-src', ITEM_ID, 'file-c.webp')
    expect(repos.files.delete).toHaveBeenCalledWith('file-c')
    expect(home.update).toHaveBeenCalledWith({ imageFileId: 'file-b' })
  })

  it('deleting a non-current picture leaves the current one alone', async () => {
    const home = makeHome('file-c')
    const current = await deleteWardrobeItemImage(repos, home as any, 'file-a')
    expect(current).toBe('file-c')
    expect(home.update).not.toHaveBeenCalled()
  })

  it('deleting the last picture clears the pointer', async () => {
    repos.files.findByLinkedTo.mockResolvedValue([oldest])
    const home = makeHome('file-a')
    expect(await deleteWardrobeItemImage(repos, home as any, 'file-a')).toBeNull()
    expect(home.update).toHaveBeenCalledWith({ imageFileId: null })
  })

  it('refuses a foreign file without deleting anything', async () => {
    const home = makeHome('file-c')
    await expect(deleteWardrobeItemImage(repos, home as any, 'file-foreign')).rejects.toBeInstanceOf(ForeignWardrobeImageError)
    expect(repos.files.delete).not.toHaveBeenCalled()
    expect(mockDeleteLink).not.toHaveBeenCalled()
  })

  it('refuses a tombstone before touching anything', async () => {
    const home = makeHome('file-c')
    const archived = new Error('archived')
    home.resolveMount.mockRejectedValue(archived)
    await expect(deleteWardrobeItemImage(repos, home as any, 'file-c')).rejects.toBe(archived)
    expect(repos.files.delete).not.toHaveBeenCalled()
    expect(mockDeleteLink).not.toHaveBeenCalled()
  })
})

describe('cleanupItemImages', () => {
  it('drops each picture\'s link and files row', async () => {
    await cleanupItemImages(repos, ITEM_ID, '[Test]', {})

    expect(mockDeleteLink).toHaveBeenCalledTimes(3)
    for (const f of [oldest, middle, newest]) {
      expect(mockDeleteLink).toHaveBeenCalledWith('vault-src', ITEM_ID, f.originalFilename)
      expect(repos.files.delete).toHaveBeenCalledWith(f.id)
    }
    expect(repos.files.delete).not.toHaveBeenCalledWith('file-doc')
  })

  it('carries on past a picture that fails to go, and does not throw', async () => {
    mockDeleteLink.mockRejectedValueOnce(new Error('locked'))
    await expect(cleanupItemImages(repos, ITEM_ID, '[Test]', {})).resolves.toBeUndefined()
    expect(mockDeleteLink).toHaveBeenCalledTimes(3)
    // The first picture's row stays (its link could not go); the others are removed.
    expect(repos.files.delete).toHaveBeenCalledTimes(2)
  })

  it('logs rather than throws when the clean-up fails', async () => {
    repos.files.findByLinkedTo.mockRejectedValue(new Error('db gone'))
    await expect(cleanupItemImages(repos, ITEM_ID, '[Test]', {})).resolves.toBeUndefined()
  })
})

describe('carryItemImages', () => {
  it('move: re-links each picture in the destination and defers the row repoints and source drops', async () => {
    const { fileIdMap, pendingMove } = await carryItemImages(repos, {
      mode: 'move',
      sourceItemId: ITEM_ID,
      destinationItemId: ITEM_ID,
      destinationMountPointId: 'vault-dest',
      userId: 'user-1',
    })

    expect(mockWriteImage).toHaveBeenCalledTimes(3)
    expect(mockWriteImage).toHaveBeenCalledWith(expect.objectContaining({
      mountPointId: 'vault-dest',
      itemId: ITEM_ID,
      leafName: 'file-a.webp',
      content: Buffer.from('bytes:mount-blob:vault-src:blob-file-a'),
    }))
    // Nothing at the source changes yet: a transfer failing later leaves it whole.
    expect(repos.files.update).not.toHaveBeenCalled()
    expect(mockDeleteLink).not.toHaveBeenCalled()
    expect(repos.files.create).not.toHaveBeenCalled()
    expect([...fileIdMap.entries()]).toEqual(
      expect.arrayContaining([['file-a', 'file-a'], ['file-b', 'file-b'], ['file-c', 'file-c']]),
    )
    expect(pendingMove.repoints).toEqual(expect.arrayContaining([
      {
        fileId: 'file-a',
        storageKey: 'mount-blob:vault-dest:blob-dest-file-a.webp',
        sourceLink: { mountPointId: 'vault-src', leafName: 'file-a.webp' },
      },
    ]))
    expect(pendingMove.repoints).toHaveLength(3)
  })

  it('move within the same mount returns no source links to drop', async () => {
    const { pendingMove } = await carryItemImages(repos, {
      mode: 'move',
      sourceItemId: ITEM_ID,
      destinationItemId: ITEM_ID,
      destinationMountPointId: 'vault-src',
      userId: 'user-1',
    })
    expect(pendingMove.repoints.every((r) => r.sourceLink === null)).toBe(true)
  })

  it('copy: creates new rows linked to the new id and returns the id map', async () => {
    const { fileIdMap, pendingMove } = await carryItemImages(repos, {
      mode: 'copy',
      sourceItemId: ITEM_ID,
      destinationItemId: 'item-copy',
      destinationMountPointId: 'vault-dest',
      userId: 'user-1',
    })

    expect(repos.files.update).not.toHaveBeenCalled()
    expect(repos.files.create).toHaveBeenCalledTimes(3)
    expect(mockWriteImage).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'item-copy', mountPointId: 'vault-dest' }))
    for (const call of repos.files.create.mock.calls) {
      const [data] = call as [Record<string, unknown>]
      expect(data.linkedTo).toEqual(['item-copy'])
      expect(data.tags).toEqual(['item-copy'])
      expect(String(data.storageKey)).toMatch(/^mount-blob:vault-dest:/)
      expect(data.category).toBe('IMAGE')
      expect(data.id).toBeUndefined()
    }
    expect(fileIdMap.size).toBe(3)
    for (const [from, to] of fileIdMap) {
      expect(['file-a', 'file-b', 'file-c']).toContain(from)
      expect(to).toMatch(/^copy-\d$/)
    }
    expect(pendingMove.repoints).toEqual([])
  })

  it('skips a picture whose blob cannot be read', async () => {
    mockReadMountBlob.mockImplementation(async (key: string) => (key.endsWith('file-b') ? null : Buffer.from('x')))
    const { fileIdMap } = await carryItemImages(repos, {
      mode: 'copy',
      sourceItemId: ITEM_ID,
      destinationItemId: 'item-copy',
      destinationMountPointId: 'vault-dest',
      userId: 'user-1',
    })
    expect(fileIdMap.has('file-b')).toBe(false)
    expect(fileIdMap.size).toBe(2)
  })
})

describe('commitMovedImages', () => {
  it('repoints each row, then drops only the source links whose row moved', async () => {
    repos.files.update.mockImplementation(async (id: string) => {
      if (id === 'file-b') throw new Error('busy')
      return null
    })
    await commitMovedImages(repos, ITEM_ID, {
      repoints: [
        { fileId: 'file-a', storageKey: 'mount-blob:vault-dest:a', sourceLink: { mountPointId: 'vault-src', leafName: 'a.webp' } },
        { fileId: 'file-b', storageKey: 'mount-blob:vault-dest:b', sourceLink: { mountPointId: 'vault-src', leafName: 'b.webp' } },
        { fileId: 'file-c', storageKey: 'mount-blob:vault-src:c', sourceLink: null },
      ],
    })
    expect(repos.files.update).toHaveBeenCalledWith('file-a', { storageKey: 'mount-blob:vault-dest:a' })
    expect(mockDeleteLink).toHaveBeenCalledWith('vault-src', ITEM_ID, 'a.webp')
    // file-b failed to repoint, so its source link — still its only home — stays.
    expect(mockDeleteLink).not.toHaveBeenCalledWith('vault-src', ITEM_ID, 'b.webp')
    expect(mockDeleteLink).toHaveBeenCalledTimes(1)
  })
})

describe('dropSourceImageLinks', () => {
  it('drops each source link and swallows a failure', async () => {
    mockDeleteLink.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('boom'))
    await expect(
      dropSourceImageLinks(ITEM_ID, [
        { mountPointId: 'vault-src', leafName: 'a.webp' },
        { mountPointId: 'vault-src', leafName: 'b.webp' },
      ]),
    ).resolves.toBeUndefined()
    expect(mockDeleteLink).toHaveBeenCalledWith('vault-src', ITEM_ID, 'a.webp')
    expect(mockDeleteLink).toHaveBeenCalledWith('vault-src', ITEM_ID, 'b.webp')
  })
})

describe('resolveWardrobeItemHome', () => {
  const { resolveWardrobeItemHome } = require('@/lib/wardrobe/item-images') as typeof import('@/lib/wardrobe/item-images')
  const { resolveWardrobeContainer } = require('@/lib/wardrobe/resolve-container') as { resolveWardrobeContainer: jest.Mock<any> }

  it('finds an item the container holds', async () => {
    resolveWardrobeContainer.mockResolvedValue({
      characterId: 'char-1',
      mountPointId: null,
      readItems: async () => [{ id: 'own', characterId: 'char-1' }, { id: 'arche', characterId: null }],
    })
    const home = await resolveWardrobeItemHome(repos, 'user-1', 'character', 'char-1', 'own')
    expect(home?.item.id).toBe('own')
    expect(home?.characterId).toBe('char-1')
  })

  it('does not treat a merged-in General archetype as the character\'s own', async () => {
    resolveWardrobeContainer.mockResolvedValue({
      characterId: 'char-1',
      mountPointId: null,
      readItems: async () => [{ id: 'arche', characterId: null }],
    })
    expect(await resolveWardrobeItemHome(repos, 'user-1', 'character', 'char-1', 'arche')).toBeNull()
  })

  it('returns null when the container does not resolve', async () => {
    resolveWardrobeContainer.mockResolvedValue(null)
    expect(await resolveWardrobeItemHome(repos, 'user-1', 'project', 'proj-x', 'own')).toBeNull()
  })
})
