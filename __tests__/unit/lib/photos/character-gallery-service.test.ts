import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/file-storage/character-vault-bridge', () => ({
  getCharacterVaultStore: jest.fn(),
}))

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn(),
}))

jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
}))

jest.mock('@/lib/mount-index/mount-chunk-cache', () => ({
  invalidateMountPoint: jest.fn(),
}))

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/file-storage/bridge-path-helpers', () => ({
  resolveUniqueRelativePath: jest.fn(),
}))

jest.mock('@/lib/photos/chunk-extracted-text', () => ({
  chunkAndInsertExtractedText: jest.fn().mockResolvedValue({ chunksCreated: 1, plainTextLength: 10 }),
}))

jest.mock('@/lib/photos/photo-link-summary', () => ({
  getPhotoLinkSummaryBySha256: jest.fn().mockResolvedValue({ sha256: 'x', linkers: [] }),
}))

import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge'
import { ensureFolderPath } from '@/lib/mount-index/folder-paths'
import { resolveUniqueRelativePath } from '@/lib/file-storage/bridge-path-helpers'
import { saveLinkToCharacterGallery } from '@/lib/photos/character-gallery-service'

const mockGetCharacterVaultStore = getCharacterVaultStore as jest.Mock
const mockEnsureFolderPath = ensureFolderPath as jest.Mock
const mockResolveUniqueRelativePath = resolveUniqueRelativePath as jest.Mock

function makeRepos() {
  return {
    characters: {
      findById: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Friday' }),
    },
    docMountFileLinks: {
      findByIdWithContent: jest.fn(),
      linkBlobContent: jest.fn(),
    },
    docMountBlobs: {
      readDataByFileId: jest.fn(),
    },
    docMountPoints: {
      refreshStats: jest.fn().mockResolvedValue(undefined),
    },
  }
}

describe('saveLinkToCharacterGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCharacterVaultStore.mockResolvedValue({ mountPointId: 'mp-char-1' })
    mockEnsureFolderPath.mockResolvedValue('folder-photos')
    mockResolveUniqueRelativePath.mockImplementation(async (_mountPointId: string, rel: string) => rel)
  })

  it('copies bytes from source link and writes a new photos/ link in target character vault', async () => {
    const repos = makeRepos()
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: 'source-link-1',
      fileId: 'file-1',
      fileName: 'old.webp',
      originalFileName: 'source.webp',
      originalMimeType: 'image/webp',
    })
    repos.docMountBlobs.readDataByFileId.mockResolvedValue(Buffer.from('image-bytes'))
    repos.docMountFileLinks.linkBlobContent.mockResolvedValue({
      link: {
        id: 'new-link-1',
      },
    })

    const out = await saveLinkToCharacterGallery({
      characterId: 'char-1',
      sourceLinkId: 'source-link-1',
      caption: 'kept from vault',
      tags: ['memory'],
      repos: repos as any,
    })

    expect(repos.docMountFileLinks.findByIdWithContent).toHaveBeenCalledWith('source-link-1')
    expect(repos.docMountBlobs.readDataByFileId).toHaveBeenCalledWith('file-1')
    expect(repos.docMountFileLinks.linkBlobContent).toHaveBeenCalledWith(
      expect.objectContaining({
        mountPointId: 'mp-char-1',
        originalFileName: 'source.webp',
        originalMimeType: 'image/webp',
      }),
    )

    const linkBlobArg = repos.docMountFileLinks.linkBlobContent.mock.calls[0][0]
    expect(linkBlobArg.relativePath).toMatch(/^photos\//)
    expect(out.linkId).toBe('new-link-1')
    expect(out.mountPointId).toBe('mp-char-1')
    expect(out.relativePath).toMatch(/^photos\//)
  })

  it('rejects missing source link', async () => {
    const repos = makeRepos()
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null)

    await expect(
      saveLinkToCharacterGallery({
        characterId: 'char-1',
        sourceLinkId: 'missing-link',
        repos: repos as any,
      }),
    ).rejects.toThrow('Image link not found: missing-link')
  })
})
