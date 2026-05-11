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
  characterMountPointId: 'vault-mp-1',
  projectMountPointIds: [] as string[],
  globalMountPointId: null,
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
    mockFindMountPointById.mockImplementation(async (id: string) => {
      const names: Record<string, string> = {
        'vault-mp-1': 'Robin Character Vault',
        'project-mp-1': 'Storyboard Mount',
        'global-mp-1': 'Quilltap General',
      }
      return { id, name: names[id] ?? 'Unknown Mount' }
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

  it('returns empty when no tier has a mount configured', async () => {
    const result = await retrieveKnowledgeForTurn({
      ...baseParams,
      characterMountPointId: null,
      projectMountPointIds: [],
      globalMountPointId: null,
    })

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

    expect(result.content).toContain('### Knowledge (character) — Robin Character Vault/Knowledge/archives.md')
    expect(result.content).toContain('Tags: archives, history · sunlit reading-room')
    expect(result.content).toContain('The archives lie beneath the sunlit reading-room.')
    expect(result.content).toContain(
      'doc_read_file(scope="document_store", mount_point="Robin Character Vault", path="Knowledge/archives.md")',
    )
    expect(result.debug).toHaveLength(1)
    expect(result.debug[0].inline).toBe(true)
    expect(result.debug[0].tier).toBe('character')
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
    const bigBody = 'A'.repeat(8000)
    mockFindDocumentByPath.mockResolvedValue({ content: bigBody })

    const result = await retrieveKnowledgeForTurn(baseParams)

    expect(result.content).toContain('### Knowledge (character) — Robin Character Vault/Knowledge/archives.md')
    expect(result.content).toContain('Why: Sunlit Archives')
    expect(result.content).toContain(
      'Read with: doc_read_file(scope="document_store", mount_point="Robin Character Vault", path="Knowledge/archives.md")',
    )
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

    expect(result.content).toContain('### Knowledge (character) — Robin Character Vault/Knowledge/legacy.pdf')
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
        return { content: 'B'.repeat(1000) }
      }
      return { content: 'A short, well-curated note.' }
    })

    const result = await retrieveKnowledgeForTurn({ ...baseParams, budgetTokens: 200 })

    expect(result.content).toContain('### Knowledge (character) — Robin Character Vault/Knowledge/big.md')
    expect(result.content).not.toContain('B'.repeat(50))
    expect(result.tokenCount).toBeLessThanOrEqual(200)
  })

  it('merges all three tiers with distinct tier headers and boost fractions', async () => {
    // One hit per tier, each from its own mount, each with a different
    // base cosine. The literal-boost fractions are wired by tier in the
    // call to searchDocumentChunks — we assert on the per-call options
    // rather than on the boosted score directly (the mock doesn't apply
    // the boost). The debug array carries the tier label, which is what
    // downstream consumers use.
    mockSearchDocumentChunks.mockImplementation(async (_emb, opts: Record<string, unknown>) => {
      const mountPointIds = opts.mountPointIds as string[]
      if (mountPointIds[0] === 'vault-mp-1') {
        return [knowledgeHit({ chunkId: 'kc-char', mountPointId: 'vault-mp-1', mountPointName: 'Robin Character Vault', relativePath: 'Knowledge/char.md', fileName: 'char.md', score: 0.6 })]
      }
      if (mountPointIds[0] === 'project-mp-1') {
        return [knowledgeHit({ chunkId: 'kc-proj', mountPointId: 'project-mp-1', mountPointName: 'Storyboard Mount', fileId: 'fp', relativePath: 'Knowledge/project.md', fileName: 'project.md', score: 0.55 })]
      }
      if (mountPointIds[0] === 'global-mp-1') {
        return [knowledgeHit({ chunkId: 'kc-gen', mountPointId: 'global-mp-1', mountPointName: 'Quilltap General', fileId: 'fg', relativePath: 'Knowledge/general.md', fileName: 'general.md', score: 0.5 })]
      }
      return []
    })
    mockFindFileByPath.mockImplementation(async (_mp: string, path: string) => ({
      id: `f-${path}`,
      fileType: 'markdown',
      relativePath: path,
      fileName: path.split('/').pop(),
    }))
    mockFindDocumentByPath.mockResolvedValue({ content: 'A small body.' })

    const result = await retrieveKnowledgeForTurn({
      ...baseParams,
      characterMountPointId: 'vault-mp-1',
      projectMountPointIds: ['project-mp-1'],
      globalMountPointId: 'global-mp-1',
    })

    expect(result.debug.map(d => d.tier).sort()).toEqual(['character', 'general'.replace('general', 'global'), 'project'].sort())
    expect(result.content).toContain('### Knowledge (character) — Robin Character Vault/Knowledge/char.md')
    expect(result.content).toContain('### Knowledge (project) — Storyboard Mount/Knowledge/project.md')
    expect(result.content).toContain('### Knowledge (general) — Quilltap General/Knowledge/general.md')

    // Confirm tier-specific boost fractions were passed through to the
    // search call for each mount.
    const callArgs = mockSearchDocumentChunks.mock.calls as Array<[Float32Array, Record<string, unknown>]>
    const byMount = new Map<string, Record<string, unknown>>()
    for (const [, opts] of callArgs) {
      const mountIds = opts.mountPointIds as string[]
      byMount.set(mountIds[0], opts)
    }
    expect(byMount.get('vault-mp-1')?.literalBoostFraction).toBe(0.5)
    expect(byMount.get('project-mp-1')?.literalBoostFraction).toBe(0.4)
    expect(byMount.get('global-mp-1')?.literalBoostFraction).toBe(0.25)
    // pathPrefix and literal-boost flag should be set the same way on every tier.
    for (const [, opts] of callArgs) {
      expect(opts.pathPrefix).toBe('Knowledge/')
      expect(opts.applyLiteralPhraseBoost).toBe(true)
    }
  })

  it('deduplicates the same chunk across tiers, keeping the highest-scoring entry', async () => {
    // Same chunkId surfaces in both character and project tiers
    // (defensively — shouldn't happen in practice since we filter
    // overlapping mount ids out, but a single chunk hash can't appear
    // twice in the output). Highest score wins.
    mockSearchDocumentChunks.mockImplementation(async (_emb, opts: Record<string, unknown>) => {
      const mountPointIds = opts.mountPointIds as string[]
      if (mountPointIds[0] === 'vault-mp-1') {
        return [knowledgeHit({ chunkId: 'dup', mountPointId: 'vault-mp-1', mountPointName: 'Robin Character Vault', score: 0.85 })]
      }
      if (mountPointIds[0] === 'project-mp-1') {
        return [knowledgeHit({ chunkId: 'dup', mountPointId: 'project-mp-1', mountPointName: 'Storyboard Mount', score: 0.5 })]
      }
      return []
    })
    mockFindFileByPath.mockResolvedValue({
      id: 'f1',
      fileType: 'markdown',
      relativePath: 'Knowledge/archives.md',
      fileName: 'archives.md',
    })
    mockFindDocumentByPath.mockResolvedValue({ content: 'Short body.' })

    const result = await retrieveKnowledgeForTurn({
      ...baseParams,
      characterMountPointId: 'vault-mp-1',
      projectMountPointIds: ['project-mp-1'],
    })

    expect(result.debug).toHaveLength(1)
    expect(result.debug[0].tier).toBe('character')
    expect(result.debug[0].score).toBe(0.85)
  })
})
