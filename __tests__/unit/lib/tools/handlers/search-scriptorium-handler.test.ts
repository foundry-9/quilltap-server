import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockSearchMemoriesSemantic = jest.fn()
const mockMarkMemoriesAccessed = jest.fn()
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

jest.mock('@/lib/memory/recall/search', () => ({
  searchMemories: (...args: unknown[]) => mockSearchMemoriesSemantic(...args),
}))
jest.mock('@/lib/memory/recall/deliver', () => ({
  stampAccessed: (...args: unknown[]) => mockMarkMemoriesAccessed(...args),
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
      projects: { canCharacterParticipate: jest.fn().mockResolvedValue(true) },
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

  it('marks only the memories it returns to the model as accessed', async () => {
    const mem = (id: string, score: number) => ({
      score,
      salience: 0.5,
      memory: {
        id,
        content: `content ${id}`,
        summary: `summary ${id}`,
        importance: 0.5,
        createdAt: '2026-04-01T00:00:00.000Z',
        source: 'AUTO',
      },
    })
    mockSearchMemoriesSemantic.mockResolvedValue([mem('kept-1', 0.9), mem('kept-2', 0.8), mem('cut-1', 0.1)])
    mockSearchConversationChunks.mockResolvedValue([])

    const result = await executeSearchScriptoriumTool(
      { query: 'blueprints', limit: 2, sources: ['memories'] },
      context
    )

    expect(result.success).toBe(true)
    expect(mockMarkMemoriesAccessed).toHaveBeenCalledTimes(1)
    expect(mockMarkMemoriesAccessed).toHaveBeenCalledWith('character-1', ['kept-1', 'kept-2'])
  })

  it('merges, sorts, and truncates results across memories and conversations', async () => {
    mockSearchMemoriesSemantic.mockResolvedValue([
      {
        score: 0.72,
        salience: 0.88,
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
        literalPhrase: true,
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
        // userId is now always passed; the conversation searcher prefers
        // characterId when present (operator-wide scope is character-less).
        userId: 'user-1',
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

  describe('scope parameter', () => {
    const vaultChunk = {
      chunkId: 'kc-vault',
      mountPointId: 'vault-mp-1',
      mountPointName: 'Friday Character Vault',
      fileId: 'fc',
      fileName: 'photos/triangle.webp',
      relativePath: 'photos/triangle.webp',
      chunkIndex: 0,
      headingContext: null,
      content: 'Triangular shadows on the bookshelves.',
      score: 0.81,
    }
    const projectChunk = {
      chunkId: 'kc-proj',
      mountPointId: 'proj-mp-1',
      mountPointName: 'Project Files: Plans',
      fileId: 'fp',
      fileName: 'plan.md',
      relativePath: 'plan.md',
      chunkIndex: 0,
      headingContext: null,
      content: 'The plan.',
      score: 0.7,
    }
    const generalChunk = {
      chunkId: 'kc-gen',
      mountPointId: 'global-mp-1',
      mountPointName: 'Quilltap General',
      fileId: 'fg',
      fileName: 'house-style.md',
      relativePath: 'house-style.md',
      chunkIndex: 0,
      headingContext: null,
      content: 'House style guidance.',
      score: 0.6,
    }

    beforeEach(() => {
      mockFindCharacterById.mockResolvedValue({
        id: 'character-1',
        userId: 'user-1',
        characterDocumentMountPointId: 'vault-mp-1',
      })
      mockFindProjectMountLinks.mockResolvedValue([{ mountPointId: 'proj-mp-1' }])
      mockGetGeneralMountPointId.mockResolvedValue('global-mp-1')

      mockSearchDocumentChunks.mockImplementation(async (_emb: unknown, opts: Record<string, unknown>) => {
        if (opts.pathPrefix) return []
        const ids = (opts.mountPointIds as string[]) ?? []
        const hits = []
        if (ids.includes('vault-mp-1')) hits.push(vaultChunk)
        if (ids.includes('proj-mp-1')) hits.push(projectChunk)
        if (ids.includes('global-mp-1')) hits.push(generalChunk)
        return hits
      })
    })

    it('defaults to scope="all": documents pool is the union of vault + project + general', async () => {
      const result = await executeSearchScriptoriumTool(
        { query: 'triangle', sources: ['documents'] },
        { ...context, projectId: 'project-1' },
      )

      expect(result.success).toBe(true)
      const paths = result.results?.map(r => r.metadata.filePath).sort()
      expect(paths).toEqual(['house-style.md', 'photos/triangle.webp', 'plan.md'])

      const docCall = (mockSearchDocumentChunks.mock.calls as Array<[unknown, Record<string, unknown>]>)
        .find(c => !c[1].pathPrefix)!
      expect((docCall[1].mountPointIds as string[]).sort()).toEqual(['global-mp-1', 'proj-mp-1', 'vault-mp-1'])
    })

    it('scope="project" excludes the vault and Quilltap General from the documents pool', async () => {
      const result = await executeSearchScriptoriumTool(
        { query: 'triangle', sources: ['documents'], scope: 'project' },
        { ...context, projectId: 'project-1' },
      )

      const paths = result.results?.map(r => r.metadata.filePath)
      expect(paths).toEqual(['plan.md'])

      const docCall = (mockSearchDocumentChunks.mock.calls as Array<[unknown, Record<string, unknown>]>)
        .find(c => !c[1].pathPrefix)!
      expect(docCall[1].mountPointIds).toEqual(['proj-mp-1'])
    })

    it('scope="character" restricts the documents pool to the character\'s own vault', async () => {
      const result = await executeSearchScriptoriumTool(
        { query: 'triangle', sources: ['documents'], scope: 'character' },
        { ...context, projectId: 'project-1' },
      )

      const paths = result.results?.map(r => r.metadata.filePath)
      expect(paths).toEqual(['photos/triangle.webp'])

      const docCall = (mockSearchDocumentChunks.mock.calls as Array<[unknown, Record<string, unknown>]>)
        .find(c => !c[1].pathPrefix)!
      expect(docCall[1].mountPointIds).toEqual(['vault-mp-1'])
    })

    it('scope="character" + sources=["knowledge"] runs only the character knowledge tier', async () => {
      mockSearchDocumentChunks.mockImplementation(async (_emb: unknown, opts: Record<string, unknown>) => {
        if (!opts.pathPrefix) return []
        const ids = (opts.mountPointIds as string[]) ?? []
        if (ids.includes('vault-mp-1')) {
          return [{ ...vaultChunk, relativePath: 'Knowledge/notes.md', chunkId: 'kn-vault' }]
        }
        return []
      })

      const result = await executeSearchScriptoriumTool(
        { query: 'notes', sources: ['knowledge'], scope: 'character' },
        { ...context, projectId: 'project-1' },
      )

      const tiers = result.results?.map(r => r.metadata.knowledgeTier)
      expect(tiers).toEqual(['character'])

      const knowledgeCalls = (mockSearchDocumentChunks.mock.calls as Array<[unknown, Record<string, unknown>]>)
        .filter(c => c[1].pathPrefix === 'Knowledge/')
      expect(knowledgeCalls).toHaveLength(1)
      expect(knowledgeCalls[0][1].mountPointIds).toEqual(['vault-mp-1'])
    })

    it('scope="project" with no project on the chat returns an empty documents pool', async () => {
      const result = await executeSearchScriptoriumTool(
        { query: 'triangle', sources: ['documents'], scope: 'project' },
        context,
      )

      expect(result.totalFound).toBe(0)
      const docCalls = (mockSearchDocumentChunks.mock.calls as Array<[unknown, Record<string, unknown>]>)
        .filter(c => !c[1].pathPrefix)
      expect(docCalls).toHaveLength(0)
    })

    it('rejects an invalid scope value', async () => {
      const result = await executeSearchScriptoriumTool(
        { query: 'triangle', scope: 'workspace' },
        context,
      )

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/Invalid input/)
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

/**
 * Window-first search and honest empty results
 * (docs/developer/features/complete/search-window-first-and-honest-empty.md).
 */
describe('search-scriptorium-handler — dated searches', () => {
  const context = { userId: 'user-1', characterId: 'character-1', embeddingProfileId: 'embed-1', chatId: 'current' }
  const mockFindIdsInEventWindow = jest.fn<(...args: unknown[]) => Promise<string[]>>()
  const mockFindChatsByCharacterId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>()
  const mockFindChatsByUserId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>()
  const mockFindChatById = jest.fn()

  const chat = (id: string, day: string) => ({
    id,
    title: `Chat ${id}`,
    createdAt: `${day}T22:40:00.000Z`,
    updatedAt: `${day}T23:20:00.000Z`,
    lastMessageAt: `${day}T23:20:00.000Z`,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue({
      characters: { findById: mockFindCharacterById },
      projects: { canCharacterParticipate: jest.fn<() => Promise<boolean>>().mockResolvedValue(true) },
      projectDocMountLinks: { findByProjectId: mockFindProjectMountLinks },
      chatSettings: { findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([{ timezone: 'UTC' }]) },
      memories: { findIdsInEventWindow: mockFindIdsInEventWindow },
      chats: { findByCharacterId: mockFindChatsByCharacterId, findByUserId: mockFindChatsByUserId, findById: mockFindChatById },
    })
    mockFindCharacterById.mockResolvedValue({ id: 'character-1', userId: 'user-1', characterDocumentMountPointId: 'vault-mp-1' })
    mockFindProjectMountLinks.mockResolvedValue([])
    mockGetGeneralMountPointId.mockResolvedValue(null)
    mockGenerateEmbeddingForUser.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
    mockSearchMemoriesSemantic.mockResolvedValue([])
    mockSearchConversationChunks.mockResolvedValue([])
    mockSearchDocumentChunks.mockResolvedValue([])
    mockFindIdsInEventWindow.mockResolvedValue([])
    mockFindChatsByCharacterId.mockResolvedValue([])
    mockFindChatsByUserId.mockResolvedValue([])
  })

  it('a dated search with no sources leaves documents out and searches the window\'s chats whole', async () => {
    mockFindChatsByCharacterId.mockResolvedValue([chat('pool', '2026-11-03'), chat('june', '2026-06-01')])

    const result = await executeSearchScriptoriumTool({ query: 'pool', since: '2026-11-03', until: '2026-11-03' }, context)

    expect(result.success).toBe(true)
    expect(mockSearchDocumentChunks).not.toHaveBeenCalled()
    expect(mockSearchMemoriesSemantic).toHaveBeenCalled()
    expect(mockSearchConversationChunks).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      expect.objectContaining({ chatIds: new Set(['pool']), minScore: 0 }),
    )
    // The old per-hit post-filter is gone.
    expect(mockFindChatById).not.toHaveBeenCalled()
  })

  it('an explicit documents source is honoured with a date range', async () => {
    await executeSearchScriptoriumTool({ query: 'pool', sources: ['documents'], since: '2026-11-03' }, context)
    expect(mockSearchDocumentChunks).toHaveBeenCalled()
  })

  it('keeps the 0.3 conversation floor for a wide window', async () => {
    mockFindChatsByCharacterId.mockResolvedValue([chat('pool', '2026-11-03')])
    await executeSearchScriptoriumTool({ query: 'pool', since: '2026-09-01', until: '2026-11-04' }, context)
    expect(mockSearchConversationChunks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ minScore: 0.3 }),
    )
  })

  it('skips the chunk search when no conversation falls in the window', async () => {
    await executeSearchScriptoriumTool({ query: 'pool', since: '2026-11-03', until: '2026-11-03' }, context)
    expect(mockSearchConversationChunks).not.toHaveBeenCalled()
  })

  it('an undated search is unchanged: every source, no chatIds, no census', async () => {
    const result = await executeSearchScriptoriumTool({ query: 'pool' }, context)
    expect(mockSearchDocumentChunks).toHaveBeenCalled()
    const opts = mockSearchConversationChunks.mock.calls[0][1] as Record<string, unknown>
    expect(opts.chatIds).toBeUndefined()
    expect(opts.minScore).toBe(0.3)
    expect(result.windowCensus).toBeUndefined()
    expect(mockFindIdsInEventWindow).not.toHaveBeenCalled()
  })

  it('builds a census: memory count, newest chats first, the current chat left out, capped at ten', async () => {
    const chats = [chat('current', '2026-11-03')]
    for (let i = 1; i <= 12; i++) chats.push(chat(`c${String(i).padStart(2, '0')}`, `2026-10-${String(i).padStart(2, '0')}`))
    mockFindChatsByCharacterId.mockResolvedValue(chats)
    mockFindIdsInEventWindow.mockResolvedValue(['m1', 'm2', 'm3'])

    const result = await executeSearchScriptoriumTool({ query: 'pool', since: '2026-10-01' }, context)

    expect(mockFindIdsInEventWindow).toHaveBeenCalledWith('character-1', expect.any(Object), { hotOnly: false })
    expect(result.windowCensus).toMatchObject({ since: '2026-10-01', until: null, memoryCount: 3, moreConversations: 2 })
    const ids = result.windowCensus!.conversations.map(c => c.id)
    expect(ids).toHaveLength(10)
    expect(ids).not.toContain('current')
    expect(ids[0]).toBe('c12')
    expect(result.windowCensus!.conversations[0]).toMatchObject({ title: 'Chat c12', date: '2026-10-12' })
  })

  it('the operator surface has no memory count and reads the user\'s chats', async () => {
    mockFindChatsByUserId.mockResolvedValue([chat('pool', '2026-11-03')])
    const result = await executeSearchScriptoriumTool(
      { query: 'pool', since: '2026-11-03' },
      { userId: 'user-1', operatorSurface: true },
    )
    expect(mockFindChatsByUserId).toHaveBeenCalledWith('user-1')
    expect(mockFindIdsInEventWindow).not.toHaveBeenCalled()
    expect(mockSearchDocumentChunks).not.toHaveBeenCalled()
    expect(result.windowCensus).toMatchObject({ memoryCount: null })
    expect(result.windowCensus!.conversations.map(c => c.id)).toEqual(['pool'])
  })
})

describe('formatSearchScriptoriumResults — what an empty search means', () => {
  const census = (over: Record<string, unknown> = {}) => ({
    since: '2026-11-02',
    until: null,
    memoryCount: 30,
    conversations: [{
      id: '057d2128-af40-4382-9e1e-873d5f1deba9',
      title: 'No Quarter at the East Pool',
      firstMessageAt: '2026-11-03T22:40:00.000Z',
      lastMessageAt: '2026-11-03T23:20:00.000Z',
      date: '2026-11-03',
    }],
    moreConversations: 0,
    ...over,
  })
  const memoryResult = {
    content: 'Lyle came through the French doors',
    sourceType: 'memory' as const,
    relevanceScore: 0.3,
    metadata: { summary: 'Lyle at the pool', importance: 0.7 },
  }

  it('A: results with a census gain a footer naming the period\'s conversations', () => {
    const text = formatSearchScriptoriumResults([memoryResult], { query: 'pool', windowCensus: census({ moreConversations: 3 }) })
    expect(text).toContain('Found 1 results:')
    expect(text).toContain('Conversations you took part in during this period:')
    expect(text).toContain('- No Quarter at the East Pool (2026-11-03) — `057d2128-af40-4382-9e1e-873d5f1deba9`')
    expect(text).toContain('- …and 3 more')
    expect(text).toContain('Read any of them with read_conversation.')
  })

  it('A: no footer when the census lists no conversations', () => {
    const text = formatSearchScriptoriumResults([memoryResult], { query: 'pool', windowCensus: census({ conversations: [] }) })
    expect(text).not.toContain('during this period')
  })

  it('B: no results but a populated window says so, and lists what to read', () => {
    const text = formatSearchScriptoriumResults([], { query: 'pool yesterday', windowCensus: census() })
    expect(text).toContain('Nothing matched "pool yesterday" — but that is not the same as having no record of the period.')
    expect(text).toContain('Between 2026-11-02 and today you hold 30 memories, and you took part in these conversations:')
    expect(text).toContain('No Quarter at the East Pool (2026-11-03)')
    expect(text).toContain('Read one with read_conversation')
  })

  it('C: no results and no window is not proof of nothing', () => {
    const text = formatSearchScriptoriumResults([], { query: 'pool' })
    expect(text).toBe('Nothing matched "pool". An empty search is not proof that nothing happened: try other words, or pass since/until if you are asking about a particular time.')
  })

  it('D: an empty window really is no record', () => {
    const text = formatSearchScriptoriumResults([], { query: 'pool', windowCensus: census({ memoryCount: 0, conversations: [] }) })
    expect(text).toBe('You hold no memories dated between 2026-11-02 and today, and took part in no conversations in that period.')
  })

  it('called without opts, results print exactly as before', () => {
    const text = formatSearchScriptoriumResults([memoryResult])
    expect(text.startsWith('Found 1 results:')).toBe(true)
    expect(text).not.toContain('during this period')
  })
})
