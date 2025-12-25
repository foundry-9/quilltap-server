import { previewDeleteAllUserData } from '@/lib/backup/restore-service'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { getRepositories } from '@/lib/repositories/factory'
import { s3FileService } from '@/lib/s3/file-service'

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/s3/file-service', () => ({
  s3FileService: {
    listUserFiles: jest.fn(),
  },
}))

const mockedGetUserRepositories = getUserRepositories as jest.MockedFunction<typeof getUserRepositories>
const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockedListUserFiles = s3FileService.listUserFiles as jest.MockedFunction<typeof s3FileService.listUserFiles>

describe('backup restore service - delete preview', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('includes template counts when previewing delete all data', async () => {
    const now = new Date().toISOString()
    const characters = [{ id: 'char-1' }, { id: 'char-2' }]
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue(characters) },
      personas: { findAll: jest.fn().mockResolvedValue([{ id: 'persona-1' }]) },
      chats: { findAll: jest.fn().mockResolvedValue([{ id: 'chat-1' }]) },
      tags: { findAll: jest.fn().mockResolvedValue([{ id: 'tag-1' }]) },
      files: { findAll: jest.fn().mockResolvedValue([{ id: 'file-1' }]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([{ id: 'conn-1' }]),
        getAllApiKeys: jest.fn().mockResolvedValue([{ id: 'api-1' }, { id: 'api-2' }]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([{ id: 'image-1' }]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([{ id: 'embed-1' }]) },
      memories: {
        findByCharacterId: jest.fn().mockImplementation((characterId: string) => {
          if (characterId === 'char-1') {
            return Promise.resolve([{ id: 'mem-1' }, { id: 'mem-2' }])
          }
          return Promise.resolve([{ id: 'mem-3' }])
        }),
      },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)

    const globalRepos = {
      promptTemplates: {
        findByUserId: jest.fn().mockResolvedValue([{ id: 'prompt-1', userId: 'user-1', createdAt: now, updatedAt: now }]),
      },
      roleplayTemplates: {
        findByUserId: jest.fn().mockResolvedValue([
          { id: 'rp-1', userId: 'user-1', createdAt: now, updatedAt: now },
          { id: 'rp-2', userId: 'user-1', createdAt: now, updatedAt: now },
        ]),
      },
      syncInstances: {
        findByUserId: jest.fn().mockResolvedValue([{ id: 'sync-instance-1', userId: 'user-1' }]),
      },
      syncOperations: {
        findByUserId: jest.fn().mockResolvedValue([
          { id: 'sync-op-1', userId: 'user-1' },
          { id: 'sync-op-2', userId: 'user-1' },
        ]),
      },
      userSyncApiKeys: {
        findByUserId: jest.fn().mockResolvedValue([{ id: 'sync-key-1', userId: 'user-1' }]),
      },
      syncMappings: {
        findAllForInstance: jest.fn().mockResolvedValue([
          { id: 'mapping-1', instanceId: 'sync-instance-1' },
          { id: 'mapping-2', instanceId: 'sync-instance-1' },
          { id: 'mapping-3', instanceId: 'sync-instance-1' },
        ]),
      },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    mockedListUserFiles.mockResolvedValue(['backups/user-1/backup.zip'])

    const summary = await previewDeleteAllUserData('user-1')

    expect(summary.characters).toBe(2)
    expect(summary.personas).toBe(1)
    expect(summary.chats).toBe(1)
    expect(summary.files).toBe(1)
    expect(summary.memories).toBe(3) // 2 for char-1, 1 for char-2
    expect(summary.apiKeys).toBe(2)
    expect(summary.backups).toBe(1)
    expect(summary.profiles).toEqual({ connection: 1, image: 1, embedding: 1 })
    expect(summary.templates).toEqual({ prompt: 1, roleplay: 2 })
    expect(summary.sync).toEqual({ instances: 1, mappings: 3, operations: 2, syncApiKeys: 1 })
    expect(s3FileService.listUserFiles).toHaveBeenCalledWith('user-1', 'backups')
  })
})
