import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockGenerateEmbeddingForUser = jest.fn()
const mockSearchDocumentChunks = jest.fn()
const mockFindMountPointById = jest.fn()
const mockFindFileByPath = jest.fn()
const mockFindDocumentByPath = jest.fn()
const mockGetRepositories = jest.fn()
const mockLogger = {
  warn: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
}

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: (...args: unknown[]) => mockGenerateEmbeddingForUser(...args),
}))

jest.mock('@/lib/mount-index/document-search', () => ({
  searchDocumentChunks: (...args: unknown[]) => mockSearchDocumentChunks(...args),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => mockGetRepositories(),
}))

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => mockLogger,
}))

const { retrieveKnowledgeForTurn } =
  require('@/lib/chat/context/knowledge-injector') as typeof import('@/lib/chat/context/knowledge-injector')

const baseParams = {
  characterId: 'character-1',
  userId: 'user-1',
  embeddingProfileId: 'embed-1',
  query: 'archives',
  vaultMountPointId: 'vault-mp-1',
  budgetTokens: 4000,
  provider: 'ANTHROPIC' as const,
}

function knowledgeHit(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: 'kc-1',
    mountPointId: 'vault-mp-1',
    mountPointName: 'Robin Character Vault',
    fileId: 'f-1',
    fileName: 'archives.md',
    relativePath: 'Knowledge/archives.md',
    chunkIndex: 0,
    headingContext: 'Sunlit Archives',
    content: 'The archives lie beneath the sunlit reading-room.',
    score: 0.71,
    ...overrides,
  }
}

describe('retrieveKnowledgeForTurn', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockGetRepositories.mockReturnValue({
      docMountPoints: { findById: mockFindMountPointById },
      docMountFiles: { findByMountPointAndPath: mockFindFileByPath },
      docMountDocuments: { findByMountPointAndPath: mockFindDocumentByPath },
    })

    mockGenerateEmbeddingForUser.mockResolvedValue({
      embedding: new Float32Array([0.1, 0.2, 0.3]),
    })
    mockFindMountPointById.mockResolvedValue({
      id: 'vault-mp-1',
      name: 'Robin Character Vault',
    })
  })

  it('returns empty when no knowledge hits are found', async () => {
    mockSearchDocumentChunks.mockResolvedValue([])

    const result = await retrieveKnowledgeForTurn(baseParams)

    expect(result).toEqual({ content: '', tokenCount: 0, debug: [] })
    expect(mockFindFileByPath).not.toHaveBeenCalled()
  })

  it('returns empty when query is blank', async () => {
    const result = await retrieveKnowledgeForTurn({ ...baseParams, query: '   ' })

    expect(result).toEqual({ content: '', tokenCount: 0, debug: [] })
    expect(mockSearchDocumentChunks).not.toHaveBeenCalled()
  })

  it('inlines a small markdown file with frontmatter tags and emits a re-read pointer', async () => {
    mockSearchDocumentChunks.mockResolvedValue([knowledgeHit()])
    mockFindFileByPath.mockResolvedValue({
      id: 'f-1',
      fileType: 'markdown',
      relativePath: 'Knowledge/archives.md',
      fileName: 'archives.md',
    })
    mockFindDocumentByPath.mockResolvedValue({
      content: '---\ntags: [archives, history]\ntopics:\n  - sunlit reading-room\n---\nThe archives lie beneath the sunlit reading-room. The keeper there knows everyone by name.',
    })

    const result = await retrieveKnowledgeForTurn(baseParams)

    expect(result.content).toContain('### Knowledge: Knowledge/archives.md')
    expect(result.content).toContain('Tags: archives, history · sunlit reading-room')
    expect(result.content).toContain('The archives lie beneath the sunlit reading-room.')
    expect(result.content).toContain(
      'doc_read_file(scope="document_store", mount_point="Robin Character Vault", path="Knowledge/archives.md")',
    )
    expect(result.debug).toHaveLength(1)
    expect(result.debug[0].inline).toBe(true)
    expect(result.tokenCount).toBeGreaterThan(0)
  })

  it('emits a pointer when the markdown body exceeds the inline threshold', async () => {
    mockSearchDocumentChunks.mockResolvedValue([knowledgeHit()])
    mockFindFileByPath.mockResolvedValue({
      id: 'f-1',
      fileType: 'markdown',
      relativePath: 'Knowledge/archives.md',
      fileName: 'archives.md',
    })
    // Generate a body that comfortably exceeds the 500-token threshold by character count.
    const bigBody = 'A'.repeat(8000)
    mockFindDocumentByPath.mockResolvedValue({ content: bigBody })

    const result = await retrieveKnowledgeForTurn(baseParams)

    expect(result.content).toContain('### Knowledge: Knowledge/archives.md')
    expect(result.content).toContain('Why: Sunlit Archives')
    expect(result.content).toContain(
      'Read with: doc_read_file(scope="document_store", mount_point="Robin Character Vault", path="Knowledge/archives.md")',
    )
    // Pointer-only — no full body in output.
    expect(result.content).not.toContain('AAAAAAAAAA')
    expect(result.debug[0].inline).toBe(false)
  })

  it('always emits pointer-only for derived blobs (pdf/docx)', async () => {
    mockSearchDocumentChunks.mockResolvedValue([
      knowledgeHit({ fileName: 'legacy.pdf', relativePath: 'Knowledge/legacy.pdf' }),
    ])
    mockFindFileByPath.mockResolvedValue({
      id: 'f-1',
      fileType: 'pdf',
      relativePath: 'Knowledge/legacy.pdf',
      fileName: 'legacy.pdf',
    })

    const result = await retrieveKnowledgeForTurn(baseParams)

    expect(result.content).toContain('### Knowledge: Knowledge/legacy.pdf')
    expect(result.content).toContain('Read with: doc_read_file')
    expect(mockFindDocumentByPath).not.toHaveBeenCalled()
    expect(result.debug[0].inline).toBe(false)
  })

  it('skips hits whose file row no longer exists', async () => {
    mockSearchDocumentChunks.mockResolvedValue([knowledgeHit()])
    mockFindFileByPath.mockResolvedValue(null)

    const result = await retrieveKnowledgeForTurn(baseParams)

    expect(result).toEqual({ content: '', tokenCount: 0, debug: [] })
  })

  it('demotes inline candidates to pointers when the budget would overflow', async () => {
    // Two candidates. First is a long markdown that — when inlined — eats most of the budget;
    // budget is just barely too tight so it must be demoted to a pointer.
    mockSearchDocumentChunks.mockResolvedValue([
      knowledgeHit({ chunkId: 'k1', fileId: 'f1', relativePath: 'Knowledge/big.md', fileName: 'big.md', score: 0.9 }),
      knowledgeHit({ chunkId: 'k2', fileId: 'f2', relativePath: 'Knowledge/small.md', fileName: 'small.md', score: 0.4 }),
    ])
    mockFindFileByPath.mockImplementation(async (_mp: string, path: string) => {
      if (path === 'Knowledge/big.md') {
        return { id: 'f1', fileType: 'markdown', relativePath: path, fileName: 'big.md' }
      }
      return { id: 'f2', fileType: 'markdown', relativePath: path, fileName: 'small.md' }
    })
    mockFindDocumentByPath.mockImplementation(async (_mp: string, path: string) => {
      if (path === 'Knowledge/big.md') {
        return { content: 'B'.repeat(1000) } // ~280 tokens at 3.5 chars/token
      }
      return { content: 'A short, well-curated note.' }
    })

    // Budget too small for the big inline (~340 tokens) but big enough for two pointers.
    const result = await retrieveKnowledgeForTurn({ ...baseParams, budgetTokens: 200 })

    // The big file should appear as a pointer (demoted), not inline.
    expect(result.content).toContain('### Knowledge: Knowledge/big.md')
    expect(result.content).not.toContain('B'.repeat(50))
    expect(result.tokenCount).toBeLessThanOrEqual(200)
  })
})
