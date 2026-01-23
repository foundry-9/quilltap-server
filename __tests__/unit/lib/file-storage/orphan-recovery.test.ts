/**
 * Unit Tests for Orphan File Recovery Module
 * Tests lib/file-storage/orphan-recovery.ts
 * v2.7-dev: Orphan File Recovery Feature
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// Mock dependencies before importing
jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    getMountPoint: jest.fn(),
    getBackend: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

// Define result type inline
interface ParsedStorageKey {
  userId: string
  projectId: string | null
  folderPath: string
  fileId: string | null
  filename: string
}

// Import using require after mocks
const {
  parseStorageKey,
} = require('@/lib/file-storage/orphan-recovery') as {
  parseStorageKey: (key: string) => ParsedStorageKey | null
}

describe('Orphan File Recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('parseStorageKey', () => {
    it('parses standard storage key with project ID', () => {
      const key = 'users/user-123/project-456/documents/abc12345-1234-5678-9abc-def012345678_report.pdf'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.userId).toBe('user-123')
      expect(result?.projectId).toBe('project-456')
      expect(result?.folderPath).toBe('/documents/')
      expect(result?.fileId).toBe('abc12345-1234-5678-9abc-def012345678')
      expect(result?.filename).toBe('report.pdf')
    })

    it('parses storage key for general files (_general)', () => {
      const key = 'users/user-123/_general/images/abc12345-1234-5678-9abc-def012345678_photo.jpg'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.userId).toBe('user-123')
      expect(result?.projectId).toBeNull()
      expect(result?.folderPath).toBe('/images/')
      expect(result?.filename).toBe('photo.jpg')
    })

    it('parses storage key without folder path (root level)', () => {
      const key = 'users/user-123/project-456/abc12345-1234-5678-9abc-def012345678_file.txt'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.folderPath).toBe('/')
      expect(result?.filename).toBe('file.txt')
    })

    it('parses storage key with nested folder path', () => {
      const key = 'users/user-123/project-456/docs/reports/2024/abc12345-1234-5678-9abc-def012345678_annual.pdf'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.folderPath).toBe('/docs/reports/2024/')
      expect(result?.filename).toBe('annual.pdf')
    })

    it('parses storage key without UUID prefix', () => {
      const key = 'users/user-123/project-456/documents/regular_filename.txt'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.fileId).toBeNull()
      expect(result?.filename).toBe('regular_filename.txt')
    })

    it('handles filename with multiple underscores after UUID', () => {
      const key = 'users/user-123/project-456/abc12345-1234-5678-9abc-def012345678_my_document_v2.pdf'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.fileId).toBe('abc12345-1234-5678-9abc-def012345678')
      expect(result?.filename).toBe('my_document_v2.pdf')
    })

    it('handles filename without underscore when no UUID', () => {
      const key = 'users/user-123/_general/simple-file.txt'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.fileId).toBeNull()
      expect(result?.filename).toBe('simple-file.txt')
    })

    it('returns null for invalid storage key format', () => {
      expect(parseStorageKey('invalid/path')).toBeNull()
      expect(parseStorageKey('not-a-storage-key')).toBeNull()
      expect(parseStorageKey('users/incomplete')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseStorageKey('')).toBeNull()
    })

    it('handles uppercase UUID', () => {
      const key = 'users/user-123/project-456/ABC12345-1234-5678-9ABC-DEF012345678_file.txt'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.fileId).toBe('ABC12345-1234-5678-9ABC-DEF012345678')
    })

    it('does not treat non-UUID prefix as file ID', () => {
      // This has underscore but the prefix is not a valid UUID
      const key = 'users/user-123/project-456/not-a-uuid_filename.txt'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.fileId).toBeNull()
      expect(result?.filename).toBe('not-a-uuid_filename.txt')
    })

    it('handles special characters in project ID', () => {
      const key = 'users/user-123/project_with-special.chars/abc12345-1234-5678-9abc-def012345678_file.txt'

      const result = parseStorageKey(key)

      expect(result).not.toBeNull()
      expect(result?.projectId).toBe('project_with-special.chars')
    })
  })
})
