/**
 * Wardrobe picture import (wardrobe-item-images.md §7): each exported picture
 * row is re-minted against the blob the imported vault carried, keeping the
 * exported file id when it is free, and the item is pointed at its own copy.
 */

jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  base.child = jest.fn(() => base)
  return { logger: base }
})

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto')
  return { ...actual, randomUUID: jest.fn(() => 'minted-file-id') }
})

import { importWardrobeItemImages } from '@/lib/import/quilltap-import/import-wardrobe-images'
import { getRepositories } from '@/lib/repositories/factory'
import type { ExportedCharacter } from '@/lib/export/types'
import type { IdMappingState } from '@/lib/import/quilltap-import/types'

const mockGetRepositories = getRepositories as jest.Mock

const SRC_CHAR = 'src-char'
const NEW_CHAR = 'new-char'
const SRC_VAULT = 'src-vault'
const NEW_VAULT = 'new-vault'
const ITEM_ID = 'item-1'
const LEAF = '20260101-120000-generated.webp'

function makeCharacter(imageFileId = 'file-1'): ExportedCharacter {
  return {
    id: SRC_CHAR,
    wardrobeItems: [
      {
        id: ITEM_ID,
        characterId: SRC_CHAR,
        title: 'Opera coat',
        types: ['top'],
        imageFileId,
        _imageFiles: [
          {
            id: 'file-1',
            originalFilename: LEAF,
            mimeType: 'image/webp',
            size: 1234,
            width: 768,
            height: 1024,
            source: 'GENERATED',
            generationPrompt: 'emerald velvet opera coat',
            generationModel: 'gpt-image-1',
            createdAt: '2026-01-01T12:00:00.000Z',
          },
        ],
      },
    ],
  } as unknown as ExportedCharacter
}

function makeIdMaps(): IdMappingState {
  return {
    characters: new Map([[SRC_CHAR, NEW_CHAR]]),
    characterVaultMounts: new Map([[NEW_CHAR, SRC_VAULT]]),
    mountPoints: new Map([[SRC_VAULT, NEW_VAULT]]),
  } as unknown as IdMappingState
}

let repos: any

beforeEach(() => {
  jest.clearAllMocks()
  repos = {
    docMountFileLinks: {
      findByMountPointAndPath: jest.fn(async () => ({ fileId: 'mount-file-1', sha256: 'sha-1', fileSizeBytes: 999 })),
    },
    docMountBlobs: {
      findByFileId: jest.fn(async () => ({ id: 'blob-1', storedMimeType: 'image/webp' })),
    },
    files: {
      findById: jest.fn(async () => null),
      create: jest.fn(async (data: Record<string, unknown>, opts: { id: string }) => ({ ...data, id: opts.id })),
    },
    wardrobe: { update: jest.fn(async () => null) },
  }
  mockGetRepositories.mockReturnValue(repos)
})

describe('importWardrobeItemImages', () => {
  it('re-mints the file row against the imported vault blob, preserving the free exported id', async () => {
    const warnings: string[] = []
    const created = await importWardrobeItemImages('user-1', [makeCharacter()], makeIdMaps(), warnings)

    expect(created).toBe(1)
    expect(warnings).toEqual([])
    expect(repos.docMountFileLinks.findByMountPointAndPath).toHaveBeenCalledWith(
      NEW_VAULT,
      `Wardrobe/images/${ITEM_ID}/${LEAF}`,
    )
    expect(repos.files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sha256: 'sha-1',
        size: 999,
        originalFilename: LEAF,
        mimeType: 'image/webp',
        linkedTo: [ITEM_ID],
        category: 'IMAGE',
        source: 'GENERATED',
        generationPrompt: 'emerald velvet opera coat',
        storageKey: `mount-blob:${NEW_VAULT}:blob-1`,
      }),
      { id: 'file-1', createdAt: '2026-01-01T12:00:00.000Z' },
    )
    // The id survived, so the vault frontmatter's imageFileId already names it.
    expect(repos.wardrobe.update).not.toHaveBeenCalled()
  })

  it('mints a fresh id when the exported one is taken, and repoints the item', async () => {
    repos.files.findById.mockResolvedValue({ id: 'file-1' })
    const created = await importWardrobeItemImages('user-1', [makeCharacter()], makeIdMaps(), [])

    expect(created).toBe(1)
    expect(repos.files.create.mock.calls[0][1]).toMatchObject({ id: 'minted-file-id' })
    expect(repos.wardrobe.update).toHaveBeenCalledWith(ITEM_ID, { imageFileId: 'minted-file-id' }, NEW_CHAR)
  })

  it('clears the pointer and warns when the bytes did not travel', async () => {
    repos.docMountFileLinks.findByMountPointAndPath.mockResolvedValue(null)
    const warnings: string[] = []
    const created = await importWardrobeItemImages('user-1', [makeCharacter()], makeIdMaps(), warnings)

    expect(created).toBe(0)
    expect(repos.files.create).not.toHaveBeenCalled()
    expect(warnings).toHaveLength(1)
    expect(repos.wardrobe.update).toHaveBeenCalledWith(ITEM_ID, { imageFileId: null }, NEW_CHAR)
  })

  it('does nothing for a character with no imported vault', async () => {
    const idMaps = makeIdMaps()
    idMaps.characterVaultMounts.clear()
    const created = await importWardrobeItemImages('user-1', [makeCharacter()], idMaps, [])
    expect(created).toBe(0)
    expect(repos.files.create).not.toHaveBeenCalled()
    expect(repos.wardrobe.update).not.toHaveBeenCalled()
  })

  it('skips characters the importer did not create', async () => {
    const idMaps = makeIdMaps()
    idMaps.characters.clear()
    expect(await importWardrobeItemImages('user-1', [makeCharacter()], idMaps, [])).toBe(0)
    expect(repos.docMountFileLinks.findByMountPointAndPath).not.toHaveBeenCalled()
  })

  it('turns a create failure into a warning, never a throw', async () => {
    repos.files.create.mockRejectedValue(new Error('constraint'))
    const warnings: string[] = []
    await expect(importWardrobeItemImages('user-1', [makeCharacter()], makeIdMaps(), warnings)).resolves.toBe(0)
    expect(warnings.some((w) => w.includes('constraint'))).toBe(true)
  })
})
