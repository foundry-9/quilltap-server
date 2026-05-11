import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockSearchMemoriesSemantic = jest.fn()
const mockGenerateEmbeddingForUser = jest.fn()
const mockSearchConversationChunks = jest.fn()
const mockSearchDocumentChunks = jest.fn()
const mockFindCharacterById = jest.fn()
const mockFindProjectMountLinks = jest.fn()
const mockGetGeneralMountPointId = jest.fn()
const mockGetRepositories = jest.fn()
const mockLogger = {
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: (...args: unknown[]) => mockSearchMemoriesSemantic(...args),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: (...args: unknown[]) => mockGenerateEmbeddingForUser(...args),
}))

jest.mock('@/lib/scriptorium/conversation-search', () => ({
  searchConversationChunks: (...args: unknown[]) => mockSearchConversationChunks(...args),
}))

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: (...args: unknown[]) => mockSearchDocumentChunks(...args),
}))

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: (...args: unknown[]) => mockGetGeneralMountPointId(...args),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockGetRepositories(),
}))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => mockLogger,
}))

const {
  executeSearchScriptoriumTool,
  formatSearchScriptoriumResults,
} = require('@/lib/tools/handlers/search-scriptorium-handler') as typeof import('@/lib/tools/handlers/search-scriptorium-handler')

describe('search-scriptorium-handler', () => {
  const context = {
    userId: 'user-1',
    characterId: 'character-1',
    embeddingProfileId: 'embed-1',
  }

  beforeEach(() => {
    jest.clearAllMocks()

    mockGetRepositories.mockReturnValue({
      characters: {
        findById: mockFindCharacterById,
      },
      projectDocMountLinks: {
        findByProjectId: mockFindProjectMountLinks,
      },
    })

    mockFindCharacterById.mockResolvedValue({
      id: 'character-1',
      userId: 'user-1',
    })
    mockFindProjectMountLinks.mockResolvedValue([])
    mockGetGeneralMountPointId.mockResolvedValue(null)
    mockGenerateEmbeddingForUser.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
    })
    mockSearchMemoriesSemantic.mockResolvedValue([])
    mockSearchConversationChunks.mockResolvedValue([])
    mockSearchDocumentChunks.mockResolvedValue([])
  })

  it('merges, sorts, and truncates results across memories and conversations', async () => {
    mockSearchMemoriesSemantic.mockResolvedValue([
      {
        score: 0.72,
        effectiveWeight: 0.88,
        memory: {
          id: 'memory-1',
          content: 'Remember the blueprints in the west archive.',
          summary: 'Blueprint archive',
          importance: 0.8,
          createdAt: '2026-04-01T00:00:00.000Z',
          source: 'MANUAL',
        },
      },
    ])
    mockSearchConversationChunks.mockResolvedValue([
      {
        chatId: 'chat-2',
        score: 0.95,
        interchangeIndex: 3,
        conversationTitle: 'Archive Heist',
        participantNames: ['Ada', 'User'],
        content: 'x'.repeat(520),
      },
    ])

    const result = await executeSearchScriptoriumTool(
      { query: 'blueprints', limit: 5, minImportance: 0.4 },
      context
    )

    expect(result.success).toBe(true)
    expect(result.query).toBe('blueprints')
    expect(result.totalFound).toBe(2)
    expect(result.results?.[0]).toMatchObject({
      sourceType: 'conversation',
      relevanceScore: 0.95,
      metadata: expect.objectContaining({
        conversationId: 'chat-2',
        conversationTitle: 'Archive Heist',
      }),
    })
    expect(result.results?.[0].content).toHaveLength(503)
    expect(result.results?.[0].content.endsWith('...')).toBe(true)
    expect(result.results?.[1]).toMatchObject({
      sourceType: 'memory',
      metadata: expect.objectContaining({
        memoryId: 'memory-1',
        summary: 'Blueprint archive',
      }),
    })

    expect(mockSearchMemoriesSemantic).toHaveBeenCalledWith(
      'character-1',
      'blueprints',
      expect.objectContaining({
        userId: 'user-1',
        embeddingProfileId: 'embed-1',
        limit: 5,
        minImportance: 0.4,
        applyLiteralPhraseBoost: true,
      })
    )
    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledWith(
      'blueprints',
      'user-1',
      'embed-1'
    )
    expect(mockSearchConversationChunks).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      {
        characterId: 'character-1',
        limit: 5,
        minScore: 0.3,
        query: 'blueprints',
        applyLiteralPhraseBoost: true,
      }
    )
  })

  it('skips memory search when the character does not belong to the user', async () => {
    mockFindCharacterById.mockResolvedValue({
      id: 'character-1',
      userId: 'other-user',
    })

    const result = await executeSearchScriptoriumTool(
      { query: 'blueprints', sources: ['memories'] },
      context
    )

    expect(result).toEqual({
      success: true,
      results: [],
      totalFound: 0,
      query: 'blueprints',
    })
    expect(mockSearchMemoriesSemantic).not.toHaveBeenCalled()
    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
  })

  it('continues with conversation results when memory search fails', async () => {
    mockSearchMemoriesSemantic.mockRejectedValue(new Error('memory service unavailable'))
    mockSearchConversationChunks.mockResolvedValue([
      {
        chatId: 'chat-2',
        score: 0.61,
        interchangeIndex: 1,
        conversationTitle: 'Fallback conversation',
        participantNames: ['User'],
        content: 'Recovered from conversation search.',
      },
    ])

    const result = await executeSearchScriptoriumTool(
      { query: 'fallback' },
      context
    )

    expect(result.success).toBe(true)
    expect(result.totalFound).toBe(1)
    expect(result.results?.[0].sourceType).toBe('conversation')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Memory search failed, continuing with other sources',
      expect.objectContaining({
        context: 'search-scriptorium-handler',
        error: 'memory service unavailable',
      })
    )
  })

  it('rejects invalid input', async () => {
    const result = await executeSearchScriptoriumTool(
      { query: '' },
      context
    )

    expect(result).toEqual({
      success: false,
      error: 'Invalid input: query is required and must be a non-empty string',
      totalFound: 0,
      query: '',
    })
  })

  describe('knowledge source', () => {
    it('returns empty silently when no knowledge tier is available', async () => {
      // Character has no vault, no project, no Quilltap General.
      mockFindCharacterById.mockResolvedValue({
        id: 'character-1',
        userId: 'user-1',
      })

      const result = await executeSearchScriptoriumTool(
        { query: 'archives', sources: ['knowledge'] },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.totalFound).toBe(0)
      expect(mockSearchDocumentChunks).not.toHaveBeenCalled()
    })

    it('searches the character vault with pathPrefix "Knowledge/" and character-tier boost', async () => {
      mockFindCharacterById.mockResolvedValue({
        id: 'character-1',
        userId: 'user-1',
        characterDocumentMountPointId: 'vault-mp-1',
      })
      mockSearchDocumentChunks.mockResolvedValue([
        {
          chunkId: 'kc-1',
          mountPointId: 'vault-mp-1',
          mountPointName: 'Robin Character Vault',
          fileId: 'file-knowledge-1',
          fileName: 'archives.md',
          relativePath: 'Knowledge/archives.md',
          chunkIndex: 0,
          headingContext: 'Sunlit Archives',
          content: 'The archives lie beneath the sunlit reading-room.',
          score: 0.71,
        },
      ])

      const result = await executeSearchScriptoriumTool(
        { query: 'archives', sources: ['knowledge'] },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.totalFound).toBe(1)
      expect(result.results?.[0]).toMatchObject({
        sourceType: 'knowledge',
        relevanceScore: 0.71,
        metadata: expect.objectContaining({
          mountPointName: 'Robin Character Vault',
          filePath: 'Knowledge/archives.md',
          headingContext: 'Sunlit Archives',
          knowledgeTier: 'character',
        }),
      })

      expect(mockSearchDocumentChunks).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        expect.objectContaining({
          mountPointIds: ['vault-mp-1'],
          pathPrefix: 'Knowledge/',
          literalBoostFraction: 0.5,
        }),
      )
    })

    it('surfaces project and global tiers with the right boost fractions and tier labels', async () => {
      mockFindCharacterById.mockResolvedValue({
        id: 'character-1',
        userId: 'user-1',
        characterDocumentMountPointId: 'vault-mp-1',
      })
      mockFindProjectMountLinks.mockResolvedValue([
        { mountPointId: 'proj-mp-1' },
        { mountPointId: 'proj-mp-2' },
      ])
      mockGetGeneralMountPointId.mockResolvedValue('global-mp-1')

      mockSearchDocumentChunks.mockImplementation(async (_emb: unknown, opts: Record<string, unknown>) => {
        const mountIds = opts.mountPointIds as string[]
        if (mountIds.includes('vault-mp-1')) {
          return [
            {
              chunkId: 'kc-char',
              mountPointId: 'vault-mp-1',
              mountPointName: 'Robin Character Vault',
              fileId: 'fc',
              fileName: 'char.md',
              relativePath: 'Knowledge/char.md',
              chunkIndex: 0,
              headingContext: null,
              content: 'Character knowledge content.',
              score: 0.6,
            },
          ]
        }
        if (mountIds.includes('proj-mp-1')) {
          return [
            {
              chunkId: 'kc-proj',
              mountPointId: 'proj-mp-1',
              mountPointName: 'Storyboard Mount',
              fileId: 'fp',
              fileName: 'project.md',
              relativePath: 'Knowledge/project.md',
              chunkIndex: 0,
              headingContext: null,
              content: 'Project knowledge content.',
              score: 0.55,
            },
          ]
        }
        if (mountIds.includes('global-mp-1')) {
          return [
            {
              chunkId: 'kc-gen',
              mountPointId: 'global-mp-1',
              mountPointName: 'Quilltap General',
              fileId: 'fg',
              fileName: 'general.md',
              relativePath: 'Knowledge/general.md',
              chunkIndex: 0,
              headingContext: null,
              content: 'Global knowledge content.',
              score: 0.5,
            },
          ]
        }
        return []
      })

      const result = await executeSearchScriptoriumTool(
        { query: 'archives', sources: ['knowledge'], limit: 10 },
        { ...context, projectId: 'project-1' },
      )

      expect(result.success).toBe(true)
      expect(result.totalFound).toBe(3)

      const tiers = result.results?.map(r => r.metadata.knowledgeTier).sort()
      expect(tiers).toEqual(['character', 'global', 'project'])

      // Inspect the three calls to confirm tier-specific boost fractions.
      const callsByMount = new Map<string, Record<string, unknown>>()
      for (const call of mockSearchDocumentChunks.mock.calls as Array<[unknown, Record<string, unknown>]>) {
        const opts = call[1]
        const mountIds = opts.mountPointIds as string[]
        callsByMount.set(mountIds.sort().join(','), opts)
      }
      expect(callsByMount.get('vault-mp-1')?.literalBoostFraction).toBe(0.5)
      expect(callsByMount.get('proj-mp-1,proj-mp-2')?.literalBoostFraction).toBe(0.4)
      expect(callsByMount.get('global-mp-1')?.literalBoostFraction).toBe(0.25)
      for (const opts of callsByMount.values()) {
        expect(opts.pathPrefix).toBe('Knowledge/')
        expect(opts.applyLiteralPhraseBoost).toBe(true)
      }
    })

    it('drops a document-source result when the same chunk is also returned as knowledge', async () => {
      mockFindCharacterById.mockResolvedValue({
        id: 'character-1',
        userId: 'user-1',
        characterDocumentMountPointId: 'vault-mp-1',
      })

      const sharedChunk = {
        chunkId: 'kc-1',
        mountPointId: 'vault-mp-1',
        mountPointName: 'Friday Character Vault',
        fileId: 'file-knowledge-1',
        fileName: 'archives.md',
        relativePath: 'Knowledge/archives.md',
        chunkIndex: 0,
        headingContext: 'Sunlit Archives',
        content: 'The archives lie beneath the sunlit reading-room.',
        score: 0.79,
      }
      const distinctDocumentChunk = {
        ...sharedChunk,
        chunkId: 'doc-only-1',
        fileId: 'file-doc-1',
        fileName: 'wardrobe.md',
        relativePath: 'Wardrobe/wardrobe.md',
        headingContext: null,
        content: 'Wardrobe notes only.',
        score: 0.55,
      }

      mockSearchDocumentChunks.mockImplementation(async (_emb: unknown, opts: Record<string, unknown>) => {
        // The documents branch is called WITHOUT pathPrefix. Knowledge
        // branches always pass pathPrefix.
        if (!opts.pathPrefix) {
          return [distinctDocumentChunk, sharedChunk]
        }
        return [sharedChunk]
      })

      const result = await executeSearchScriptoriumTool(
        { query: 'sunlit archives', sources: ['documents', 'knowledge'] },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)

      const archiveRow = result.results?.find(
        r => r.metadata.filePath === 'Knowledge/archives.md',
      )
      expect(archiveRow).toBeDefined()
      expect(archiveRow?.sourceType).toBe('knowledge')

      const wardrobeRow = result.results?.find(
        r => r.metadata.filePath === 'Wardrobe/wardrobe.md',
      )
      expect(wardrobeRow).toBeDefined()
      expect(wardrobeRow?.sourceType).toBe('document')

      const archiveAsDocument = result.results?.find(
        r => r.metadata.filePath === 'Knowledge/archives.md' && r.sourceType === 'document',
      )
      expect(archiveAsDocument).toBeUndefined()
    })

    it('skips the global tier silently when Quilltap General is not provisioned', async () => {
      mockFindCharacterById.mockResolvedValue({
        id: 'character-1',
        userId: 'user-1',
        characterDocumentMountPointId: 'vault-mp-1',
      })
      mockGetGeneralMountPointId.mockResolvedValue(null)
      mockSearchDocumentChunks.mockResolvedValue([])

      await executeSearchScriptoriumTool(
        { query: 'archives', sources: ['knowledge'] },
        context,
      )

      // Only the character-tier call should fire; no call should target
      // a global mount.
      const calls = mockSearchDocumentChunks.mock.calls as Array<[unknown, Record<string, unknown>]>
      const characterCalls = calls.filter(c => (c[1].mountPointIds as string[]).includes('vault-mp-1'))
      expect(characterCalls.length).toBe(1)
      const globalCalls = calls.filter(c => (c[1].mountPointIds as string[]).some(id => id.startsWith('global')))
      expect(globalCalls.length).toBe(0)
    })

    it('formats knowledge results with a tier-tagged label and doc_read_file pointer', () => {
      const formatted = formatSearchScriptoriumResults([
        {
          content: 'The archives lie beneath the sunlit reading-room.',
          sourceType: 'knowledge',
          relevanceScore: 0.71,
          metadata: {
            mountPointName: 'Robin Character Vault',
            fileName: 'archives.md',
            filePath: 'Knowledge/archives.md',
            chunkIndex: 0,
            headingContext: 'Sunlit Archives',
            knowledgeTier: 'character',
          },
        },
      ])

      expect(formatted).toContain('[Result 1 - Character Knowledge]')
      expect(formatted).toContain('Source: Robin Character Vault')
      expect(formatted).toContain('Section: Sunlit Archives')
      expect(formatted).toContain(
        'Re-read with: doc_read_file(scope=document_store, mount_point="Robin Character Vault", path="Knowledge/archives.md")',
      )
    })
  })

  it('formats memory and conversation results for display', () => {
    const formatted = formatSearchScriptoriumResults([
      {
        content: 'Archive details',
        sourceType: 'memory',
        relevanceScore: 0.83,
        metadata: {
          summary: 'Archive note',
          importance: 0.8,
        },
      },
      {
        content: 'Conversation excerpt',
        sourceType: 'conversation',
        relevanceScore: 0.67,
        metadata: {
          conversationId: 'chat-9',
          conversationTitle: 'A Night at the Archive',
          interchangeIndex: 4,
          participantNames: ['Ada', 'User'],
        },
      },
    ])

    expect(formatted).toContain('Found 2 results:')
    expect(formatted).toContain('[Result 1 - Memory]')
    expect(formatted).toContain('Importance: High')
    expect(formatted).toContain('Conversation ID: chat-9')
    expect(formatted).toContain('Participants: Ada, User')
  })
})
