/**
 * Unit Tests for Folders Repository
 * Tests lib/mongodb/repositories/folders.repository.ts
 * v2.7-dev: First-Class Folder Entities
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import type { Collection, Db } from 'mongodb'
import type { Folder, FolderInput } from '@/lib/schemas/folder.types'

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Mock MongoDB - define these at module level
const mockCollection = {
  findOne: jest.fn(),
  find: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  deleteMany: jest.fn(),
  insertMany: jest.fn(),
}

const mockDb = {
  collection: jest.fn(() => mockCollection),
}

jest.mock('@/lib/mongodb/client', () => ({
  __esModule: true,
  getMongoDatabase: jest.fn(() => Promise.resolve(mockDb)),
}))

// Import after mocking using require to ensure mock is in place
const { FoldersRepository } = 
  require('@/lib/mongodb/repositories/folders.repository') as typeof import('@/lib/mongodb/repositories/folders.repository')

// Test fixtures
const now = new Date().toISOString()

// Use RFC 4122 compliant UUIDs for test fixtures (Zod v4 strictly validates UUIDs)
// Format: xxxxxxxx-xxxx-Vxxx-Nxxx-xxxxxxxxxxxx where V=version(1-8), N=variant(8,9,a,b)
const TEST_FOLDER_ID = '11111111-1111-4111-a111-111111111111'
const TEST_FOLDER_ID_2 = '11111111-1111-4111-a111-111111111112'
const TEST_USER_ID = '22222222-2222-4222-a222-222222222222'
const TEST_PROJECT_ID = '33333333-3333-4333-a333-333333333333'
const TEST_PARENT_FOLDER_ID = '44444444-4444-4444-a444-444444444444'
const TEST_CHILD_ID_1 = '55555555-5555-4555-a555-555555555551'
const TEST_CHILD_ID_2 = '55555555-5555-4555-a555-555555555552'

const makeFolder = (overrides: Partial<Folder> = {}): Folder => ({
  id: TEST_FOLDER_ID,
  userId: TEST_USER_ID,
  projectId: null,
  name: 'Documents',
  path: '/Documents/',
  parentFolderId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

describe('Folders Repository', () => {
  let repository: FoldersRepository

  beforeEach(() => {
    jest.clearAllMocks()
    repository = new FoldersRepository()

    // Setup default mock implementations
    mockCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
      toArray: jest.fn().mockResolvedValue([]),
    })
  })

  describe('findById', () => {
    it('returns folder when found', async () => {
      const folder = makeFolder()
      mockCollection.findOne.mockResolvedValue(folder)

      const result = await repository.findById(TEST_FOLDER_ID)

      expect(mockCollection.findOne).toHaveBeenCalledWith({ id: TEST_FOLDER_ID })
      expect(result).toEqual(folder)
    })

    it('returns null when not found', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await repository.findById('nonexistent')

      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      mockCollection.findOne.mockRejectedValue(new Error('Database error'))

      const result = await repository.findById(TEST_FOLDER_ID)

      expect(result).toBeNull()
    })
  })

  describe('findAll', () => {
    it('returns all folders', async () => {
      const folders = [
        makeFolder({ id: '11111111-1111-4111-a111-111111111101' }),
        makeFolder({ id: '11111111-1111-4111-a111-111111111102' })
      ]
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(folders),
      })

      const result = await repository.findAll()

      expect(result).toHaveLength(2)
    })

    it('filters out invalid documents', async () => {
      const folders = [makeFolder(), { invalid: 'document' }]
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(folders),
      })

      const result = await repository.findAll()

      expect(result).toHaveLength(1)
    })

    it('returns empty array on error', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockRejectedValue(new Error('Database error')),
      })

      const result = await repository.findAll()

      expect(result).toEqual([])
    })
  })

  describe('create', () => {
    it('creates folder with generated ID and timestamps', async () => {
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true })

      const data = {
        userId: TEST_USER_ID,
        projectId: null,
        name: 'New Folder',
        path: '/New Folder/',
        parentFolderId: null,
      }

      const result = await repository.create(data)

      expect(result.id).toBeDefined()
      expect(result.userId).toBe(TEST_USER_ID)
      expect(result.name).toBe('New Folder')
      expect(result.createdAt).toBeDefined()
      expect(result.updatedAt).toBeDefined()
      expect(mockCollection.insertOne).toHaveBeenCalled()
    })

    it('uses provided ID and createdAt from options', async () => {
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true })

      const customId = '55555555-5555-4555-a555-555555555555'
      const data = {
        userId: TEST_USER_ID,
        projectId: null,
        name: 'Synced Folder',
        path: '/Synced Folder/',
        parentFolderId: null,
      }

      const result = await repository.create(data, {
        id: customId,
        createdAt: '2024-01-01T00:00:00.000Z',
      })

      expect(result.id).toBe(customId)
      expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z')
    })

    it('throws on database error', async () => {
      mockCollection.insertOne.mockRejectedValue(new Error('Insert failed'))

      const data = {
        userId: TEST_USER_ID,
        projectId: null,
        name: 'Failed Folder',
        path: '/Failed Folder/',
        parentFolderId: null,
      }

      await expect(repository.create(data)).rejects.toThrow('Insert failed')
    })
  })

  describe('update', () => {
    it('updates folder and returns updated document', async () => {
      const existing = makeFolder()
      mockCollection.findOne.mockResolvedValue(existing)
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 })

      const result = await repository.update(TEST_FOLDER_ID, { name: 'Renamed' })

      expect(result).not.toBeNull()
      expect(result?.name).toBe('Renamed')
      expect(result?.updatedAt).not.toBe(existing.updatedAt)
    })

    it('returns null when folder not found', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await repository.update('nonexistent', { name: 'New Name' })

      expect(result).toBeNull()
      expect(mockCollection.updateOne).not.toHaveBeenCalled()
    })

    it('preserves ID and createdAt', async () => {
      const originalId = '66666666-6666-4666-a666-666666666666'
      const existing = makeFolder({
        id: originalId,
        createdAt: '2024-01-01T00:00:00.000Z',
      })
      mockCollection.findOne.mockResolvedValue(existing)
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 })

      const result = await repository.update(originalId, {
        id: 'attempted-override',
        createdAt: '2025-01-01T00:00:00.000Z',
      } as Partial<Folder>)

      expect(result?.id).toBe(originalId)
      expect(result?.createdAt).toBe('2024-01-01T00:00:00.000Z')
    })
  })

  describe('delete', () => {
    it('returns true when folder deleted', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 })

      const result = await repository.delete(TEST_FOLDER_ID)

      expect(result).toBe(true)
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({ id: TEST_FOLDER_ID })
    })

    it('returns false when folder not found', async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 })

      const result = await repository.delete('nonexistent')

      expect(result).toBe(false)
    })

    it('throws on database error', async () => {
      mockCollection.deleteOne.mockRejectedValue(new Error('Delete failed'))

      await expect(repository.delete(TEST_FOLDER_ID)).rejects.toThrow('Delete failed')
    })
  })

  describe('findByPath', () => {
    it('finds folder by exact path for project', async () => {
      const folder = makeFolder({
        path: '/Documents/',
        projectId: TEST_PROJECT_ID,
      })
      mockCollection.findOne.mockResolvedValue(folder)

      const result = await repository.findByPath(TEST_USER_ID, '/Documents/', TEST_PROJECT_ID)

      expect(mockCollection.findOne).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        path: '/Documents/',
        projectId: TEST_PROJECT_ID,
      })
      expect(result).toEqual(folder)
    })

    it('handles null projectId for general files', async () => {
      const folder = makeFolder({ projectId: null })
      mockCollection.findOne.mockResolvedValue(folder)

      await repository.findByPath(TEST_USER_ID, '/Documents/', null)

      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: [{ projectId: null }, { projectId: { $exists: false } }],
        })
      )
    })

    it('returns null when not found', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await repository.findByPath(TEST_USER_ID, '/Nonexistent/', null)

      expect(result).toBeNull()
    })
  })

  describe('findByParent', () => {
    it('finds direct children of parent folder', async () => {
      const children = [
        makeFolder({ id: TEST_CHILD_ID_1, parentFolderId: TEST_PARENT_FOLDER_ID }),
        makeFolder({ id: TEST_CHILD_ID_2, parentFolderId: TEST_PARENT_FOLDER_ID }),
      ]
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(children),
        }),
      })

      const result = await repository.findByParent(TEST_USER_ID, TEST_PARENT_FOLDER_ID, null)

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          parentFolderId: TEST_PARENT_FOLDER_ID,
        })
      )
      expect(result).toHaveLength(2)
    })

    it('finds root-level folders (null parent)', async () => {
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([makeFolder()]),
        }),
      })

      await repository.findByParent(TEST_USER_ID, null, TEST_PROJECT_ID)

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          parentFolderId: null,
          projectId: TEST_PROJECT_ID,
        })
      )
    })

    it('sorts results by name', async () => {
      const sortMock = jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      })
      mockCollection.find.mockReturnValue({ sort: sortMock })

      await repository.findByParent(TEST_USER_ID, null, null)

      expect(sortMock).toHaveBeenCalledWith({ name: 1 })
    })
  })

  describe('findAllInProject', () => {
    it('returns all folders for a project', async () => {
      const folders = [
        makeFolder({ projectId: TEST_PROJECT_ID }),
        makeFolder({ projectId: TEST_PROJECT_ID, path: '/Subfolder/' }),
      ]
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(folders),
        }),
      })

      const result = await repository.findAllInProject(TEST_USER_ID, TEST_PROJECT_ID)

      expect(mockCollection.find).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        projectId: TEST_PROJECT_ID,
      })
      expect(result).toHaveLength(2)
    })

    it('sorts results by path', async () => {
      const sortMock = jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      })
      mockCollection.find.mockReturnValue({ sort: sortMock })

      await repository.findAllInProject(TEST_USER_ID, null)

      expect(sortMock).toHaveBeenCalledWith({ path: 1 })
    })
  })

  describe('findDescendants', () => {
    it('finds all descendant folders under a path', async () => {
      const descendants = [
        makeFolder({ path: '/Documents/Reports/' }),
        makeFolder({ path: '/Documents/Reports/2024/' }),
        makeFolder({ path: '/Documents/Archive/' }),
      ]
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(descendants),
        }),
      })

      const result = await repository.findDescendants(TEST_USER_ID, '/Documents/', null)

      expect(result).toHaveLength(3)
    })

    it('uses regex pattern for path matching', async () => {
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      })

      await repository.findDescendants(TEST_USER_ID, '/Documents/', TEST_PROJECT_ID)

      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.objectContaining({
            $regex: expect.any(String),
            $ne: '/Documents/',
          }),
        })
      )
    })

    it('escapes special regex characters in path', async () => {
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      })

      // Path with special regex characters
      await repository.findDescendants(TEST_USER_ID, '/Path.With[Special]Chars/', null)

      // Should not throw and should escape the special chars
      expect(mockCollection.find).toHaveBeenCalled()
    })
  })

  describe('findByUserId', () => {
    it('returns all folders for a user', async () => {
      const folders = [makeFolder(), makeFolder({ id: TEST_FOLDER_ID_2 })]
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(folders),
        }),
      })

      const result = await repository.findByUserId(TEST_USER_ID)

      expect(mockCollection.find).toHaveBeenCalledWith({ userId: TEST_USER_ID })
      expect(result).toHaveLength(2)
    })

    it('returns empty array when user has no folders', async () => {
      mockCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      })

      const result = await repository.findByUserId('no-folders-user')

      expect(result).toEqual([])
    })
  })
})
