import { previewDeleteAllUserData } from '@/lib/backup/restore-service'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { getRepositories } from '@/lib/repositories/factory'
import { fileStorageManager } from '@/lib/file-storage/manager'

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    listUserFiles: jest.fn(),
  },
}))

const mockedGetUserRepositories = getUserRepositories as jest.MockedFunction<typeof getUserRepositories>
const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockedListUserFiles = fileStorageManager.listUserFiles as jest.MockedFunction<typeof fileStorageManager.listUserFiles>

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
      files: { findAll: jest.fn().mockResolvedValue([
        { id: 'file-1', folderPath: '/documents' },  // Regular file
        { id: 'backup-1', folderPath: '/backups', originalFilename: 'backup-2024.zip' },  // Backup file
      ]) },
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
      projects: { findAll: jest.fn().mockResolvedValue([{ id: 'project-1' }]) },
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

    const summary = await previewDeleteAllUserData('user-1')

    expect(summary.characters).toBe(2)
    expect(summary.personas).toBe(1)
    expect(summary.chats).toBe(1)
    expect(summary.files).toBe(2)  // 1 regular file + 1 backup file
    expect(summary.memories).toBe(3) // 2 for char-1, 1 for char-2
    expect(summary.apiKeys).toBe(2)
    expect(summary.backups).toBe(1)
    expect(summary.profiles).toEqual({ connection: 1, image: 1, embedding: 1 })
    expect(summary.templates).toEqual({ prompt: 1, roleplay: 2 })
    // syncApiKeys is 0 because they are preserved (not deleted) during data deletion
    expect(summary.sync).toEqual({ instances: 1, mappings: 3, operations: 2, syncApiKeys: 0 })
    // Backups are now counted from files in the files repository, not from storage
  })
})
