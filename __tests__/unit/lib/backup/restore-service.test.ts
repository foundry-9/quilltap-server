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
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')

    expect(summary.characters).toBe(2)
    expect(summary.chats).toBe(1)
    expect(summary.files).toBe(2)  // 1 regular file + 1 backup file
    expect(summary.memories).toBe(3) // 2 for char-1, 1 for char-2
    expect(summary.apiKeys).toBe(2)
    expect(summary.backups).toBe(1)
    expect(summary.profiles).toEqual({ connection: 1, image: 1, embedding: 1 })
    expect(summary.templates).toEqual({ prompt: 1, roleplay: 2 })
    // Backups are now counted from files in the files repository, not from storage
  })
})
