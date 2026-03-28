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

  it('handles zero characters (no memories to count)', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)

    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-empty')
    expect(summary.characters).toBe(0)
    expect(summary.chats).toBe(0)
    expect(summary.memories).toBe(0)
    expect(summary.files).toBe(0)
    expect(summary.apiKeys).toBe(0)
    expect(summary.backups).toBe(0)
    // memories.findByCharacterId should NOT be called when there are no characters
    expect(userRepos.memories.findByCharacterId).not.toHaveBeenCalled()
  })

  it('counts memories across multiple characters correctly', async () => {
    const characters = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue(characters) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: { findAll: jest.fn().mockResolvedValue([]), getAllApiKeys: jest.fn().mockResolvedValue([]) },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: {
        findByCharacterId: jest.fn()
          .mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'm3' }, { id: 'm4' }, { id: 'm5' }]),
      },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.memories).toBe(5) // 2 + 0 + 3
  })

  it('distinguishes backup files from regular files', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([
        { id: 'f1', folderPath: '/documents' },
        { id: 'f2', folderPath: '/backups', originalFilename: 'b1.zip' },
        { id: 'f3', folderPath: '/backups', originalFilename: 'b2.zip' },
        { id: 'f4', folderPath: '/images' },
      ]) },
      connections: { findAll: jest.fn().mockResolvedValue([]), getAllApiKeys: jest.fn().mockResolvedValue([]) },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.files).toBe(4) // total files
    expect(summary.backups).toBe(2) // only backup files
  })

  it('counts all API keys from connections', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([{ id: 'conn-1' }, { id: 'conn-2' }]),
        getAllApiKeys: jest.fn().mockResolvedValue([
          { id: 'api-1' },
          { id: 'api-2' },
          { id: 'api-3' },
          { id: 'api-4' },
        ]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.apiKeys).toBe(4)
    expect(summary.profiles.connection).toBe(2)
  })

  it('includes all profile types in delete preview', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([
        { id: 'img-1' },
        { id: 'img-2' },
        { id: 'img-3' },
      ]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([
        { id: 'emb-1' },
        { id: 'emb-2' },
      ]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.profiles).toEqual({ connection: 0, image: 3, embedding: 2 })
  })

  it('counts tags correctly in delete preview', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([
        { id: 'tag-1' },
        { id: 'tag-2' },
        { id: 'tag-3' },
      ]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.tags).toBe(3)
  })

  it('counts prompt and roleplay templates from global repositories', async () => {
    const now = new Date().toISOString()
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: {
        findByUserId: jest.fn().mockResolvedValue([
          { id: 'pt-1', userId: 'user-1', createdAt: now, updatedAt: now },
          { id: 'pt-2', userId: 'user-1', createdAt: now, updatedAt: now },
          { id: 'pt-3', userId: 'user-1', createdAt: now, updatedAt: now },
        ]),
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
    expect(summary.templates).toEqual({ prompt: 3, roleplay: 2 })
  })

  it('counts projects in delete preview', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([
        { id: 'proj-1' },
        { id: 'proj-2' },
        { id: 'proj-3' },
      ]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.projects).toBe(3)
  })

  it('handles large counts across all entity types', async () => {
    const characters = Array.from({ length: 50 }, (_, i) => ({ id: `char-${i}` }))
    const chats = Array.from({ length: 200 }, (_, i) => ({ id: `chat-${i}` }))
    const files = Array.from({ length: 100 }, (_, i) => ({
      id: `file-${i}`,
      folderPath: i % 10 === 0 ? '/backups' : '/documents',
      originalFilename: i % 10 === 0 ? `backup-${i}.zip` : undefined,
    }))

    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue(characters) },
      chats: { findAll: jest.fn().mockResolvedValue(chats) },
      tags: { findAll: jest.fn().mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({ id: `tag-${i}` }))) },
      files: { findAll: jest.fn().mockResolvedValue(files) },
      connections: {
        findAll: jest.fn().mockResolvedValue(Array.from({ length: 15 }, (_, i) => ({ id: `conn-${i}` }))),
        getAllApiKeys: jest.fn().mockResolvedValue(Array.from({ length: 40 }, (_, i) => ({ id: `api-${i}` }))),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: `img-${i}` }))) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `emb-${i}` }))) },
      memories: {
        findByCharacterId: jest.fn().mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `mem-${i}` }))),
      },
      projects: { findAll: jest.fn().mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: `proj-${i}` }))) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue(Array.from({ length: 15 }, (_, i) => ({ id: `pt-${i}` }))) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: `rp-${i}` }))) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.characters).toBe(50)
    expect(summary.chats).toBe(200)
    expect(summary.files).toBe(100)
    expect(summary.memories).toBe(500) // 50 characters * 10 memories per character
    expect(summary.apiKeys).toBe(40)
    expect(summary.backups).toBe(10) // 100 files / 10 = 10
    expect(summary.projects).toBe(25)
  })

  it('handles mixed backup and non-backup files in various folders', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([
        { id: 'f1', folderPath: '/backups', originalFilename: 'backup1.zip' },
        { id: 'f2', folderPath: '/documents', originalFilename: 'doc.txt' },
        { id: 'f3', folderPath: '/backups', originalFilename: 'backup2.zip' },
        { id: 'f4', folderPath: '/images', originalFilename: 'image.png' },
        { id: 'f5', folderPath: '/backups', originalFilename: 'backup3.zip' },
        { id: 'f6', folderPath: '/documents', originalFilename: 'story.doc' },
      ]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.files).toBe(6)
    expect(summary.backups).toBe(3)
  })

  it('returns empty templates object when no templates exist', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.templates).toEqual({ prompt: 0, roleplay: 0 })
  })

  it('returns empty profiles object when no profiles exist', async () => {
    const userRepos = {
      characters: { findAll: jest.fn().mockResolvedValue([]) },
      chats: { findAll: jest.fn().mockResolvedValue([]) },
      tags: { findAll: jest.fn().mockResolvedValue([]) },
      files: { findAll: jest.fn().mockResolvedValue([]) },
      connections: {
        findAll: jest.fn().mockResolvedValue([]),
        getAllApiKeys: jest.fn().mockResolvedValue([]),
      },
      imageProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      embeddingProfiles: { findAll: jest.fn().mockResolvedValue([]) },
      memories: { findByCharacterId: jest.fn() },
      projects: { findAll: jest.fn().mockResolvedValue([]) },
    }
    mockedGetUserRepositories.mockReturnValue(userRepos as any)
    const globalRepos = {
      promptTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
      roleplayTemplates: { findByUserId: jest.fn().mockResolvedValue([]) },
    }
    mockedGetRepositories.mockReturnValue(globalRepos as any)

    const summary = await previewDeleteAllUserData('user-1')
    expect(summary.profiles).toEqual({ connection: 0, image: 0, embedding: 0 })
  })
})
