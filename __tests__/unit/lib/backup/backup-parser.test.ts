/**
 * @jest-environment node
 */

/**
 * Backup Parser Unit Tests
 *
 * Comprehensive tests for backup ZIP parsing and restoration utilities.
 * Tests cover ZIP file parsing, file extraction, preview generation,
 * manifest validation, and edge cases with malformed backups.
 *
 * Uses shell `zip` to create test archives (matching the production code).
 */

import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  parseBackupZip,
  getFileFromExtractedBackup,
  previewRestore,
} from '@/lib/backup/restore-service'
import type {
  BackupManifest,
  ChatWithMessages,
} from '@/lib/backup/types'
import {
  createMockCharacter,
  createMockChat,
  createMockTag,
  createMockMemory,
  createMockConnectionProfile,
  createMockImageProfile,
  createMockEmbeddingProfile,
} from '../fixtures/test-factories'

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

/**
 * Helper to create a mock backup ZIP file on disk using shell `zip`.
 * Returns the path to the zip file. Caller is responsible for cleanup.
 */
function createBackupZipFile(options: {
  manifest?: Partial<BackupManifest>
  characters?: any[]
  chats?: any[]
  tags?: any[]
  connectionProfiles?: any[]
  imageProfiles?: any[]
  embeddingProfiles?: any[]
  memories?: any[]
  files?: any[]
  promptTemplates?: any[]
  roleplayTemplates?: any[]
  providerModels?: any[]
  projects?: any[]
  rootFolder?: string
  includeFileData?: Array<{
    id: string
    category: string
    originalFilename: string
    content: Buffer | string
  }>
  /**
   * If true, skip creating the manifest.json file (for error testing)
   */
  skipManifest?: boolean
  /**
   * If provided, write this raw string as characters.json instead of the array
   */
  rawCharactersJson?: string
  /**
   * If true, skip creating data/characters.json (for error testing)
   */
  skipCharacters?: boolean
}): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quilltap-test-backup-'))
  const rootFolder = options.rootFolder || 'quilltap-backup-2024-01-01T00-00-00-000Z'
  const stagingDir = path.join(tempDir, rootFolder)

  const defaultManifest: BackupManifest = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    userId: 'user-123',
    appVersion: '2.0.0',
    counts: {
      characters: options.characters?.length || 0,
      chats: options.chats?.length || 0,
      messages: 0,
      tags: options.tags?.length || 0,
      connectionProfiles: options.connectionProfiles?.length || 0,
      imageProfiles: options.imageProfiles?.length || 0,
      embeddingProfiles: options.embeddingProfiles?.length || 0,
      memories: options.memories?.length || 0,
      files: options.files?.length || 0,
      promptTemplates: options.promptTemplates?.length || 0,
      roleplayTemplates: options.roleplayTemplates?.length || 0,
      providerModels: options.providerModels?.length || 0,
      projects: options.projects?.length || 0,
    },
    ...options.manifest,
  }

  // Create directory structure
  fs.mkdirSync(path.join(stagingDir, 'data'), { recursive: true })

  // Write manifest
  if (!options.skipManifest) {
    fs.writeFileSync(
      path.join(stagingDir, 'manifest.json'),
      JSON.stringify(defaultManifest, null, 2)
    )
  }

  // Write data files
  if (options.rawCharactersJson !== undefined) {
    fs.writeFileSync(path.join(stagingDir, 'data', 'characters.json'), options.rawCharactersJson)
  } else if (!options.skipCharacters) {
    fs.writeFileSync(
      path.join(stagingDir, 'data', 'characters.json'),
      JSON.stringify(options.characters || [], null, 2)
    )
  }

  fs.writeFileSync(
    path.join(stagingDir, 'data', 'chats.json'),
    JSON.stringify(options.chats || [], null, 2)
  )
  fs.writeFileSync(
    path.join(stagingDir, 'data', 'tags.json'),
    JSON.stringify(options.tags || [], null, 2)
  )
  fs.writeFileSync(
    path.join(stagingDir, 'data', 'connection-profiles.json'),
    JSON.stringify(options.connectionProfiles || [], null, 2)
  )
  fs.writeFileSync(
    path.join(stagingDir, 'data', 'image-profiles.json'),
    JSON.stringify(options.imageProfiles || [], null, 2)
  )
  fs.writeFileSync(
    path.join(stagingDir, 'data', 'embedding-profiles.json'),
    JSON.stringify(options.embeddingProfiles || [], null, 2)
  )
  fs.writeFileSync(
    path.join(stagingDir, 'data', 'memories.json'),
    JSON.stringify(options.memories || [], null, 2)
  )
  fs.writeFileSync(
    path.join(stagingDir, 'data', 'files.json'),
    JSON.stringify(options.files || [], null, 2)
  )

  // Optional files for backwards compatibility
  if (options.promptTemplates !== undefined) {
    fs.writeFileSync(
      path.join(stagingDir, 'data', 'prompt-templates.json'),
      JSON.stringify(options.promptTemplates, null, 2)
    )
  }
  if (options.roleplayTemplates !== undefined) {
    fs.writeFileSync(
      path.join(stagingDir, 'data', 'roleplay-templates.json'),
      JSON.stringify(options.roleplayTemplates, null, 2)
    )
  }
  if (options.providerModels !== undefined) {
    fs.writeFileSync(
      path.join(stagingDir, 'data', 'provider-models.json'),
      JSON.stringify(options.providerModels, null, 2)
    )
  }
  if (options.projects !== undefined) {
    fs.writeFileSync(
      path.join(stagingDir, 'data', 'projects.json'),
      JSON.stringify(options.projects, null, 2)
    )
  }

  // Add file data if provided
  if (options.includeFileData) {
    for (const file of options.includeFileData) {
      const fileDir = path.join(stagingDir, 'files', file.category)
      fs.mkdirSync(fileDir, { recursive: true })
      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content
      fs.writeFileSync(path.join(fileDir, `${file.id}_${file.originalFilename}`), content)
    }
  }

  // Create the zip
  const zipPath = path.join(tempDir, `${rootFolder}.zip`)
  execFileSync('zip', ['-r', zipPath, rootFolder], { cwd: tempDir })

  // Clean up the staging dir (keep only the zip)
  fs.rmSync(stagingDir, { recursive: true, force: true })

  return zipPath
}

/**
 * Helper to clean up test zip files
 */
function cleanupZip(zipPath: string): void {
  try {
    fs.unlinkSync(zipPath)
    const dir = path.dirname(zipPath)
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors in tests
  }
}

describe('Backup Parser', () => {
  describe('parseBackupZip()', () => {
    it('parses a valid backup ZIP with all data', async () => {
      const characters = [createMockCharacter({ id: 'char-1' })]
      const chats: ChatWithMessages[] = [
        {
          ...createMockChat({ id: 'chat-1' }),
          messages: [],
        },
      ]
      const tags = [createMockTag({ id: 'tag-1' })]

      const zipPath = createBackupZipFile({
        characters,
        chats,
        tags,
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.manifest.version).toBe('1.0')
        expect(result.characters).toHaveLength(1)
        expect(result.characters[0].id).toBe('char-1')
        expect(result.chats).toHaveLength(1)
        expect(result.chats[0].id).toBe('chat-1')
        expect(result.tags).toHaveLength(1)

        // Clean up extraction dir
        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    }, 15000)

    it('parses backup with multiple entities of each type', async () => {
      const characters = [
        createMockCharacter({ id: 'char-1', name: 'Character 1' }),
        createMockCharacter({ id: 'char-2', name: 'Character 2' }),
        createMockCharacter({ id: 'char-3', name: 'Character 3' }),
      ]
      const tags = [
        createMockTag({ id: 'tag-1', name: 'Tag 1' }),
        createMockTag({ id: 'tag-2', name: 'Tag 2' }),
      ]
      const memories = [
        createMockMemory({ id: 'mem-1', characterId: 'char-1' }),
        createMockMemory({ id: 'mem-2', characterId: 'char-2' }),
      ]

      const zipPath = createBackupZipFile({
        characters,
        tags,
        memories,
        chats: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        files: [],
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.characters).toHaveLength(3)
        expect(result.tags).toHaveLength(2)
        expect(result.memories).toHaveLength(2)
        expect(result.characters.map((c) => c.name)).toEqual(['Character 1', 'Character 2', 'Character 3'])

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('parses backup with profiles', async () => {
      const connectionProfiles = [
        createMockConnectionProfile({ id: 'conn-1', provider: 'openai' }),
        createMockConnectionProfile({ id: 'conn-2', provider: 'anthropic' }),
      ]
      const imageProfiles = [
        createMockImageProfile({ id: 'img-1', provider: 'openai' }),
      ]
      const embeddingProfiles = [
        createMockEmbeddingProfile({ id: 'emb-1', provider: 'openai' }),
      ]

      const zipPath = createBackupZipFile({
        connectionProfiles,
        imageProfiles,
        embeddingProfiles,
        characters: [],
        chats: [],
        tags: [],
        memories: [],
        files: [],
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.connectionProfiles).toHaveLength(2)
        expect(result.imageProfiles).toHaveLength(1)
        expect(result.embeddingProfiles).toHaveLength(1)
        expect(result.connectionProfiles[0].provider).toBe('openai')

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles optional files for backwards compatibility - missing templates', async () => {
      const characters = [createMockCharacter({ id: 'char-1' })]

      const zipPath = createBackupZipFile({
        characters,
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        // Don't include optional files
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.characters).toHaveLength(1)
        expect(result.promptTemplates).toEqual([])
        expect(result.roleplayTemplates).toEqual([])
        expect(result.providerModels).toEqual([])
        expect(result.projects).toEqual([])

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles optional files when present', async () => {
      const promptTemplates = [
        { id: 'pt-1', userId: 'user-1', name: 'Template 1', content: 'test' },
      ]
      const roleplayTemplates = [
        { id: 'rt-1', userId: 'user-1', name: 'Roleplay 1', template: 'test' },
      ]
      const providerModels = [{ id: 'pm-1', provider: 'openai', modelId: 'gpt-4' }]
      const projects = [{ id: 'proj-1', userId: 'user-1', name: 'Project 1' }]

      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        promptTemplates,
        roleplayTemplates,
        providerModels,
        projects,
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.promptTemplates).toHaveLength(1)
        expect(result.roleplayTemplates).toHaveLength(1)
        expect(result.providerModels).toHaveLength(1)
        expect(result.projects).toHaveLength(1)

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles empty backup with no entities', async () => {
      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.manifest.version).toBe('1.0')
        expect(result.characters).toEqual([])
        expect(result.chats).toEqual([])
        expect(result.tags).toEqual([])
        expect(result.memories).toEqual([])

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('parses manifest metadata correctly', async () => {
      const manifest = {
        version: '1.0' as const,
        createdAt: '2024-01-15T10:30:00.000Z',
        userId: 'user-abc-123',
        appVersion: '2.1.0',
      }

      const zipPath = createBackupZipFile({
        manifest,
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.manifest.version).toBe('1.0')
        expect(result.manifest.createdAt).toBe('2024-01-15T10:30:00.000Z')
        expect(result.manifest.userId).toBe('user-abc-123')
        expect(result.manifest.appVersion).toBe('2.1.0')

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('preserves all entity properties during parsing', async () => {
      const character = createMockCharacter({
        id: 'char-1',
        name: 'Test Character',
        description: 'A detailed description',
        personality: 'Friendly and outgoing',
        tags: ['tag-1', 'tag-2'],
        isFavorite: true,
      })

      const zipPath = createBackupZipFile({
        characters: [character],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.characters[0]).toEqual(character)
        expect(result.characters[0].name).toBe('Test Character')
        expect(result.characters[0].tags).toEqual(['tag-1', 'tag-2'])
        expect(result.characters[0].isFavorite).toBe(true)

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles nested object structures in entities', async () => {
      const connectionProfile = createMockConnectionProfile({
        id: 'conn-1',
        parameters: {
          temperature: 0.7,
          maxTokens: 2000,
          topP: 0.9,
        },
      })

      const zipPath = createBackupZipFile({
        connectionProfiles: [connectionProfile],
        characters: [],
        chats: [],
        tags: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const { data: result, extractDir } = await parseBackupZip(zipPath)

        expect(result.connectionProfiles[0].parameters).toEqual({
          temperature: 0.7,
          maxTokens: 2000,
          topP: 0.9,
        })

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('throws error when manifest.json is missing', async () => {
      const zipPath = createBackupZipFile({
        skipManifest: true,
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        // Use a non-quilltap-backup- prefix so root folder detection falls through
        rootFolder: 'some-folder',
      })

      try {
        await expect(parseBackupZip(zipPath)).rejects.toThrow(/Invalid backup/)
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('throws error when required data file is missing', async () => {
      const zipPath = createBackupZipFile({
        skipCharacters: true,
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        await expect(parseBackupZip(zipPath)).rejects.toThrow()
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('throws error on malformed JSON in data files', async () => {
      const zipPath = createBackupZipFile({
        rawCharactersJson: '{ invalid json }',
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        await expect(parseBackupZip(zipPath)).rejects.toThrow()
      } finally {
        cleanupZip(zipPath)
      }
    })
  })

  describe('getFileFromExtractedBackup()', () => {
    it('extracts a file from the backup ZIP', async () => {
      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        includeFileData: [
          {
            id: 'file-1',
            category: 'documents',
            originalFilename: 'test.txt',
            content: 'Hello, World!',
          },
        ],
      })

      try {
        const { extractDir, rootFolder } = await parseBackupZip(zipPath)
        const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir

        const fileEntry = {
          id: 'file-1',
          category: 'documents',
          originalFilename: 'test.txt',
        } as any

        const result = await getFileFromExtractedBackup(rootPath, fileEntry)

        expect(result).not.toBeNull()
        expect(result!.toString('utf8')).toBe('Hello, World!')

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('extracts binary file content correctly', async () => {
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        includeFileData: [
          {
            id: 'img-1',
            category: 'images',
            originalFilename: 'test.png',
            content: binaryContent,
          },
        ],
      })

      try {
        const { extractDir, rootFolder } = await parseBackupZip(zipPath)
        const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir

        const fileEntry = {
          id: 'img-1',
          category: 'images',
          originalFilename: 'test.png',
        } as any

        const result = await getFileFromExtractedBackup(rootPath, fileEntry)

        expect(result).not.toBeNull()
        expect(Buffer.compare(result!, binaryContent)).toBe(0)

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('returns null when file is not found in ZIP', async () => {
      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        includeFileData: [
          {
            id: 'file-1',
            category: 'documents',
            originalFilename: 'exists.txt',
            content: 'Content',
          },
        ],
      })

      try {
        const { extractDir, rootFolder } = await parseBackupZip(zipPath)
        const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir

        const fileEntry = {
          id: 'file-999',
          category: 'documents',
          originalFilename: 'missing.txt',
        } as any

        const result = await getFileFromExtractedBackup(rootPath, fileEntry)

        expect(result).toBeNull()

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles files in different categories', async () => {
      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        includeFileData: [
          {
            id: 'doc-1',
            category: 'documents',
            originalFilename: 'doc.pdf',
            content: 'PDF content',
          },
          {
            id: 'img-1',
            category: 'images',
            originalFilename: 'photo.jpg',
            content: 'JPG content',
          },
          {
            id: 'audio-1',
            category: 'audio',
            originalFilename: 'sound.mp3',
            content: 'MP3 content',
          },
        ],
      })

      try {
        const { extractDir, rootFolder } = await parseBackupZip(zipPath)
        const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir

        const docEntry = { id: 'doc-1', category: 'documents', originalFilename: 'doc.pdf' } as any
        const imgEntry = { id: 'img-1', category: 'images', originalFilename: 'photo.jpg' } as any
        const audioEntry = { id: 'audio-1', category: 'audio', originalFilename: 'sound.mp3' } as any

        const docResult = await getFileFromExtractedBackup(rootPath, docEntry)
        const imgResult = await getFileFromExtractedBackup(rootPath, imgEntry)
        const audioResult = await getFileFromExtractedBackup(rootPath, audioEntry)

        expect(docResult!.toString('utf8')).toBe('PDF content')
        expect(imgResult!.toString('utf8')).toBe('JPG content')
        expect(audioResult!.toString('utf8')).toBe('MP3 content')

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles filenames with special characters', async () => {
      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        includeFileData: [
          {
            id: 'file-1',
            category: 'documents',
            originalFilename: 'file with spaces & special!.txt',
            content: 'Special filename content',
          },
        ],
      })

      try {
        const { extractDir, rootFolder } = await parseBackupZip(zipPath)
        const rootPath = rootFolder ? path.join(extractDir, rootFolder) : extractDir

        const fileEntry = {
          id: 'file-1',
          category: 'documents',
          originalFilename: 'file with spaces & special!.txt',
        } as any

        const result = await getFileFromExtractedBackup(rootPath, fileEntry)

        expect(result).not.toBeNull()
        expect(result!.toString('utf8')).toBe('Special filename content')

        fs.rmSync(extractDir, { recursive: true, force: true })
      } finally {
        cleanupZip(zipPath)
      }
    })
  })

  describe('previewRestore()', () => {
    it('generates preview summary with correct counts', async () => {
      const characters = Array(5).fill(null).map((_, i) => createMockCharacter({ id: `char-${i}` }))
      const chats: ChatWithMessages[] = Array(3).fill(null).map((_, i) => ({
        ...createMockChat({ id: `chat-${i}` }),
        messages: Array(10).fill(null).map((_, j) => ({
          id: `msg-${i}-${j}`,
          type: 'message' as const,
          role: 'user' as const,
          content: 'Test message',
          timestamp: new Date().toISOString(),
        })),
      }))

      const zipPath = createBackupZipFile({
        characters,
        chats,
        tags: Array(7).fill(null).map((_, i) => createMockTag({ id: `tag-${i}` })),
        memories: Array(15).fill(null).map((_, i) => createMockMemory({ id: `mem-${i}` })),
        files: Array(4).fill(null).map((_, i) => ({
          id: `file-${i}`,
          userId: 'user-123',
          originalFilename: `file-${i}.txt`,
          category: 'documents',
        })),
        connectionProfiles: Array(2).fill(null).map((_, i) => createMockConnectionProfile({ id: `conn-${i}` })),
        imageProfiles: [createMockImageProfile({ id: 'img-1' })],
        embeddingProfiles: [createMockEmbeddingProfile({ id: 'emb-1' })],
      })

      try {
        const summary = await previewRestore(zipPath)

        expect(summary.characters).toBe(5)
        expect(summary.chats).toBe(3)
        expect(summary.messages).toBe(30) // 3 chats * 10 messages
        expect(summary.tags).toBe(7)
        expect(summary.memories).toBe(15)
        expect(summary.files).toBe(4)
        expect(summary.profiles.connection).toBe(2)
        expect(summary.profiles.image).toBe(1)
        expect(summary.profiles.embedding).toBe(1)
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('includes template counts in preview', async () => {
      const zipPath = createBackupZipFile({
        characters: [createMockCharacter({ id: 'char-1' })],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
        promptTemplates: Array(3).fill(null).map((_, i) => ({ id: `pt-${i}`, name: `Template ${i}` })),
        roleplayTemplates: Array(2).fill(null).map((_, i) => ({ id: `rt-${i}`, name: `Roleplay ${i}` })),
      })

      try {
        const summary = await previewRestore(zipPath)

        expect(summary.templates.prompt).toBe(3)
        expect(summary.templates.roleplay).toBe(2)
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles empty backup with zero counts', async () => {
      const zipPath = createBackupZipFile({
        characters: [],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const summary = await previewRestore(zipPath)

        expect(summary.characters).toBe(0)
        expect(summary.chats).toBe(0)
        expect(summary.messages).toBe(0)
        expect(summary.tags).toBe(0)
        expect(summary.memories).toBe(0)
        expect(summary.files).toBe(0)
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('includes warnings array in summary', async () => {
      const zipPath = createBackupZipFile({
        characters: [createMockCharacter({ id: 'char-1' })],
        chats: [],
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const summary = await previewRestore(zipPath)

        expect(summary.warnings).toBeDefined()
        expect(Array.isArray(summary.warnings)).toBe(true)
      } finally {
        cleanupZip(zipPath)
      }
    })

    it('handles chats with no messages', async () => {
      const chats: ChatWithMessages[] = Array(5).fill(null).map((_, i) => ({
        ...createMockChat({ id: `chat-${i}` }),
        messages: [],
      }))

      const zipPath = createBackupZipFile({
        characters: [],
        chats,
        tags: [],
        connectionProfiles: [],
        imageProfiles: [],
        embeddingProfiles: [],
        memories: [],
        files: [],
      })

      try {
        const summary = await previewRestore(zipPath)

        expect(summary.chats).toBe(5)
        expect(summary.messages).toBe(0)
      } finally {
        cleanupZip(zipPath)
      }
    })
  })
})
