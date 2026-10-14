import {
  listAvatarRolls,
  saveAvatarRollToAlbum,
  setAvatarRollAsPortrait,
  deleteAvatarRoll,
} from '@/lib/photos/avatar-rolls-service'
import { getCharacterVaultStore } from '@/lib/file-storage/character-vault-bridge'
import { getPhotoLinkSummaryBySha256 } from '@/lib/photos/photo-link-summary'
import { saveFileToCharacterGallery } from '@/lib/photos/character-gallery-service'
import { invalidateMountPoint } from '@/lib/mount-index/mount-chunk-cache'

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/photos/photo-link-summary', () => ({
  getPhotoLinkSummaryBySha256: jest.fn(),
}))

jest.mock('@/lib/photos/character-gallery-service', () => ({
  saveFileToCharacterGallery: jest.fn(),
}))

jest.mock('@/lib/mount-index/mount-chunk-cache', () => ({
  invalidateMountPoint: jest.fn(),
}))

const VAULT_MOUNT = 'mp-vault-1'
const PROJECT_MOUNT = 'mp-project-1'
const CHARACTER_ID = 'char-1'

/** A keyed `files` row — i.e. an avatar roll. */
function makeRoll(overrides: Record<string, unknown> = {}) {
  return {
    id: 'roll-1',
    userId: 'user-1',
    sha256: 'sha-roll-1',
    originalFilename: 'avatar_Friday_1.webp',
    mimeType: 'image/webp',
    size: 1234,
    width: 512,
    height: 768,
    category: 'IMAGE',
    source: 'GENERATED',
    generationKey: 'key-abc',
    generationPrompt: 'a portrait',
    generationModel: 'some-model',
    tags: [CHARACTER_ID],
    storageKey: `mount-blob:${PROJECT_MOUNT}:blob-1`,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeLinker(overrides: Record<string, unknown> = {}) {
  return {
    linkId: 'link-roll-1',
    mountPointId: PROJECT_MOUNT,
    mountPointName: 'Project store',
    mountStoreType: 'documents',
    relativePath: 'character-avatars/avatar_Friday_1.webp',
    isPhotoAlbum: false,
    linkedAt: '2026-09-01T00:00:00.000Z',
    linkedBy: null,
    linkedById: null,
    caption: null,
    tags: [],
    ...overrides,
  }
}

function makeRepos(overrides: Record<string, any> = {}) {
  return {
    characters: {
      findById: jest.fn().mockResolvedValue({
        id: CHARACTER_ID,
        name: 'Friday',
        defaultImageId: null,
        avatarOverrides: [],
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    files: {
      findByTag: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue(true),
    },
    chats: {
      findByCharacterId: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    docMountFileLinks: {
      deleteWithGC: jest.fn().mockResolvedValue({ fileId: 'f-1', fileGC: true }),
    },
    docMountPoints: {
      refreshStats: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getCharacterVaultStore).mockResolvedValue({ mountPointId: VAULT_MOUNT } as any)
  jest.mocked(getPhotoLinkSummaryBySha256).mockResolvedValue({ count: 0, linkers: [] })
})

describe('listAvatarRolls', () => {
  it('keeps only keyed image rows and orders them newest first', async () => {
    const repos = makeRepos()
    repos.files.findByTag.mockResolvedValue([
      makeRoll({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeRoll({ id: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
      // A kept album photo: no generationKey, so not a roll.
      makeRoll({ id: 'album-photo', generationKey: null }),
      // A non-image attachment that happens to carry the tag.
      makeRoll({ id: 'not-an-image', category: 'DOCUMENT' }),
    ])

    const result = await listAvatarRolls({ characterId: CHARACTER_ID, repos: repos as any })

    expect(result.total).toBe(2)
    expect(result.entries.map(e => e.fileId)).toEqual(['new', 'old'])
  })

  it('reports the album link when the bytes are already kept, and the roll link otherwise', async () => {
    const repos = makeRepos()
    repos.files.findByTag.mockResolvedValue([makeRoll()])
    jest.mocked(getPhotoLinkSummaryBySha256).mockResolvedValue({
      count: 2,
      linkers: [
        makeLinker(),
        makeLinker({
          linkId: 'link-album-1',
          mountPointId: VAULT_MOUNT,
          relativePath: 'photos/kept.webp',
          isPhotoAlbum: true,
        }),
      ],
    } as any)

    const [entry] = (await listAvatarRolls({ characterId: CHARACTER_ID, repos: repos as any })).entries

    expect(entry.rollLinkId).toBe('link-roll-1')
    expect(entry.albumLinkId).toBe('link-album-1')
    // The roll's own link is what renders — the album copy is the same bytes.
    expect(entry.url).toBe(
      `/api/v1/mount-points/${PROJECT_MOUNT}/blobs/character-avatars/avatar_Friday_1.webp`
    )
  })

  it('falls back to the files URL when no mount link survives', async () => {
    const repos = makeRepos()
    repos.files.findByTag.mockResolvedValue([makeRoll()])

    const [entry] = (await listAvatarRolls({ characterId: CHARACTER_ID, repos: repos as any })).entries

    expect(entry.rollLinkId).toBeNull()
    expect(entry.url).toBe('/api/v1/files/roll-1')
  })

  it('flags the portrait through the album link, not just a legacy file pointer', async () => {
    const repos = makeRepos()
    repos.characters.findById.mockResolvedValue({
      id: CHARACTER_ID,
      name: 'Friday',
      defaultImageId: 'link-album-1',
      avatarOverrides: [],
    })
    repos.files.findByTag.mockResolvedValue([makeRoll()])
    jest.mocked(getPhotoLinkSummaryBySha256).mockResolvedValue({
      count: 1,
      linkers: [
        makeLinker({
          linkId: 'link-album-1',
          mountPointId: VAULT_MOUNT,
          relativePath: 'photos/kept.webp',
          isPhotoAlbum: true,
        }),
      ],
    } as any)

    const [entry] = (await listAvatarRolls({ characterId: CHARACTER_ID, repos: repos as any })).entries

    expect(entry.isPortrait).toBe(true)
  })

  it('counts the chats currently displaying each plate', async () => {
    const repos = makeRepos()
    repos.files.findByTag.mockResolvedValue([makeRoll()])
    repos.chats.findByCharacterId.mockResolvedValue([
      { id: 'chat-1', characterAvatars: { [CHARACTER_ID]: { imageId: 'roll-1' } } },
      { id: 'chat-2', characterAvatars: { [CHARACTER_ID]: { imageId: 'roll-1' } } },
      { id: 'chat-3', characterAvatars: { [CHARACTER_ID]: { imageId: 'other' } } },
      { id: 'chat-4', characterAvatars: null },
    ])

    const [entry] = (await listAvatarRolls({ characterId: CHARACTER_ID, repos: repos as any })).entries

    expect(entry.usedInChatCount).toBe(2)
  })
})

describe('saveAvatarRollToAlbum', () => {
  it('hard-links the roll into the album when it is not there yet', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll())
    jest.mocked(saveFileToCharacterGallery).mockResolvedValue({ linkId: 'link-new' } as any)

    const result = await saveAvatarRollToAlbum({
      characterId: CHARACTER_ID,
      fileId: 'roll-1',
      repos: repos as any,
    })

    expect(saveFileToCharacterGallery).toHaveBeenCalledWith(
      expect.objectContaining({ characterId: CHARACTER_ID, fileId: 'roll-1' })
    )
    expect(result).toEqual({ linkId: 'link-new', alreadyInAlbum: false })
  })

  it('is idempotent: a roll already in the album reports its existing link', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll())
    jest.mocked(getPhotoLinkSummaryBySha256).mockResolvedValue({
      count: 1,
      linkers: [
        makeLinker({
          linkId: 'link-album-1',
          mountPointId: VAULT_MOUNT,
          relativePath: 'photos/kept.webp',
          isPhotoAlbum: true,
        }),
      ],
    } as any)

    const result = await saveAvatarRollToAlbum({
      characterId: CHARACTER_ID,
      fileId: 'roll-1',
      repos: repos as any,
    })

    expect(saveFileToCharacterGallery).not.toHaveBeenCalled()
    expect(result).toEqual({ linkId: 'link-album-1', alreadyInAlbum: true })
  })

  it('refuses a files row that is not one of this character’s rolls', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll({ tags: ['someone-else'] }))

    await expect(
      saveAvatarRollToAlbum({ characterId: CHARACTER_ID, fileId: 'roll-1', repos: repos as any })
    ).rejects.toThrow('Avatar roll not found')
  })
})

describe('setAvatarRollAsPortrait', () => {
  it('points defaultImageId at the album link, never at the files row', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll())
    jest.mocked(saveFileToCharacterGallery).mockResolvedValue({ linkId: 'link-new' } as any)

    const result = await setAvatarRollAsPortrait({
      characterId: CHARACTER_ID,
      fileId: 'roll-1',
      repos: repos as any,
    })

    expect(repos.characters.update).toHaveBeenCalledWith(CHARACTER_ID, {
      defaultImageId: 'link-new',
    })
    expect(result).toEqual({ linkId: 'link-new', addedToAlbum: true })
  })
})

describe('deleteAvatarRoll', () => {
  it('scrubs every pointer, drops the roll link, and deletes the cache row', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll())
    repos.characters.findById.mockResolvedValue({
      id: CHARACTER_ID,
      name: 'Friday',
      defaultImageId: 'roll-1',
      avatarOverrides: [
        { chatId: 'chat-1', imageId: 'roll-1' },
        { chatId: 'chat-9', imageId: 'keeper' },
      ],
    })
    repos.chats.findByCharacterId.mockResolvedValue([
      {
        id: 'chat-1',
        characterAvatars: {
          [CHARACTER_ID]: { imageId: 'roll-1' },
          'other-char': { imageId: 'untouched' },
        },
      },
    ])
    jest.mocked(getPhotoLinkSummaryBySha256).mockResolvedValue({
      count: 1,
      linkers: [makeLinker()],
    } as any)

    const result = await deleteAvatarRoll({
      characterId: CHARACTER_ID,
      fileId: 'roll-1',
      repos: repos as any,
    })

    expect(repos.chats.update).toHaveBeenCalledWith('chat-1', {
      characterAvatars: { 'other-char': { imageId: 'untouched' } },
    })
    expect(repos.characters.update).toHaveBeenCalledWith(CHARACTER_ID, {
      defaultImageId: null,
      avatarOverrides: [{ chatId: 'chat-9', imageId: 'keeper' }],
    })
    expect(repos.docMountFileLinks.deleteWithGC).toHaveBeenCalledWith('link-roll-1')
    expect(invalidateMountPoint).toHaveBeenCalledWith(PROJECT_MOUNT)
    expect(repos.files.delete).toHaveBeenCalledWith('roll-1')
    expect(result).toEqual({
      deleted: true,
      blobRemoved: true,
      chatsScrubbed: 1,
      keptInAlbum: false,
    })
  })

  it('never takes the album copy with it', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll())
    jest.mocked(getPhotoLinkSummaryBySha256).mockResolvedValue({
      count: 2,
      linkers: [
        makeLinker(),
        makeLinker({
          linkId: 'link-album-1',
          mountPointId: VAULT_MOUNT,
          relativePath: 'photos/kept.webp',
          isPhotoAlbum: true,
        }),
      ],
    } as any)
    repos.docMountFileLinks.deleteWithGC.mockResolvedValue({ fileId: 'f-1', fileGC: false })

    const result = await deleteAvatarRoll({
      characterId: CHARACTER_ID,
      fileId: 'roll-1',
      repos: repos as any,
    })

    expect(repos.docMountFileLinks.deleteWithGC).toHaveBeenCalledTimes(1)
    expect(repos.docMountFileLinks.deleteWithGC).toHaveBeenCalledWith('link-roll-1')
    expect(result.keptInAlbum).toBe(true)
    expect(result.blobRemoved).toBe(false)
  })

  it('leaves the album link alone when it is the roll’s only remaining link', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll())
    jest.mocked(getPhotoLinkSummaryBySha256).mockResolvedValue({
      count: 1,
      linkers: [
        makeLinker({
          linkId: 'link-album-1',
          mountPointId: VAULT_MOUNT,
          relativePath: 'photos/kept.webp',
          isPhotoAlbum: true,
        }),
      ],
    } as any)

    const result = await deleteAvatarRoll({
      characterId: CHARACTER_ID,
      fileId: 'roll-1',
      repos: repos as any,
    })

    expect(repos.docMountFileLinks.deleteWithGC).not.toHaveBeenCalled()
    expect(repos.files.delete).toHaveBeenCalledWith('roll-1')
    expect(result).toEqual({
      deleted: true,
      blobRemoved: false,
      chatsScrubbed: 0,
      keptInAlbum: true,
    })
  })

  it('reports a miss rather than deleting a files row that is not a roll', async () => {
    const repos = makeRepos()
    repos.files.findById.mockResolvedValue(makeRoll({ generationKey: null }))

    const result = await deleteAvatarRoll({
      characterId: CHARACTER_ID,
      fileId: 'roll-1',
      repos: repos as any,
    })

    expect(result.deleted).toBe(false)
    expect(repos.files.delete).not.toHaveBeenCalled()
  })
})
