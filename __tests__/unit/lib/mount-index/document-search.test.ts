/**
 * Unit tests for lib/mount-index/document-search.ts
 *
 * Tests semantic search across document mount chunks using cosine similarity.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}))

// Use the global factory mock and configure it per test
// (getRepositories is already mocked in jest.setup.ts)

// cosineSimilarity is mocked globally via jest.setup.ts; override for specific
// test precision using jest.unmock / re-mock as needed. For document-search tests
// we can supply our own lightweight implementation.
jest.mock('@/lib/embedding/embedding-service', () => ({
  cosineSimilarity: jest.fn((a: number[], b: number[]) => {
    // Simple dot-product approximation used for test score control
    let sum = 0
    for (let i = 0; i < a.length && i < b.length; i++) sum += a[i] * b[i]
    return sum
  }),
  // Pre-flight guard added in the Matryoshka truncation work — mock as a no-op
  // for these tests; dimension mismatch isn't what they're exercising.
  assertEmbeddingDimensionsMatch: jest.fn(),
}))

import { searchDocumentChunks } from '@/lib/mount-index/document-search'
import { getRepositories } from '@/lib/repositories/factory'
import { invalidateAll as invalidateMountChunkCache } from '@/lib/mount-index/mount-chunk-cache'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chunk-1',
    mountPointId: 'mp-1',
    fileId: 'file-1',
    chunkIndex: 0,
    headingContext: null,
    content: 'Sample chunk content.',
    embedding: [1, 0, 0],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeRepos(overrides: Record<string, unknown> = {}) {
  return {
    projectDocMountLinks: {
      findByProjectId: jest.fn().mockResolvedValue([]),
    },
    docMountPoints: {
      findEnabled: jest.fn().mockResolvedValue([
        { id: 'mp-1', name: 'Archive', basePath: '/archive', enabled: true },
      ]),
      findAll: jest.fn().mockResolvedValue([
        { id: 'mp-1', name: 'Archive', basePath: '/archive', enabled: true },
      ]),
    },
    docMountChunks: {
      findAllWithEmbeddingsByMountPointIds: jest.fn().mockResolvedValue([]),
    },
    docMountFiles: {
      findById: jest.fn().mockResolvedValue({
        id: 'file-1',
        fileName: 'notes.md',
        relativePath: 'notes/notes.md',
      }),
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchDocumentChunks', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Cache persists across tests in the same process — reset so each test
    // starts with an empty mount-chunk map.
    invalidateMountChunkCache()
  })

  it('returns empty array when there are no enabled mount points', async () => {
    mockGetRepositories.mockReturnValue({
      ...makeRepos({
        docMountPoints: {
          findEnabled: jest.fn().mockResolvedValue([]),
          findAll: jest.fn().mockResolvedValue([]),
        },
      }),
    } as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0])
    expect(results).toEqual([])
  })

  it('returns empty array when no embedded chunks exist', async () => {
    mockGetRepositories.mockReturnValue({
      ...makeRepos(),
    } as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0])
    expect(results).toEqual([])
  })

  it('returns chunks above the minimum score threshold', async () => {
    const chunk = makeChunk({ embedding: [1, 0, 0] }) // dot product with [1,0,0] = 1.0
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([chunk])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { minScore: 0.3 })
    expect(results).toHaveLength(1)
    expect(results[0].chunkId).toBe('chunk-1')
    expect(results[0].score).toBeCloseTo(1.0)
  })

  it('excludes chunks below the minimum score threshold', async () => {
    // [1,0,0] · [0,1,0] = 0 → below any positive threshold
    const chunk = makeChunk({ embedding: [0, 1, 0] })
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([chunk])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { minScore: 0.3 })
    expect(results).toEqual([])
  })

  it('returns results sorted by descending score', async () => {
    const high = makeChunk({ id: 'high', embedding: [1, 0, 0] }) // score 1.0
    const mid = makeChunk({ id: 'mid', embedding: [0.5, 0.5, 0] }) // score 0.5
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([mid, high])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { minScore: 0.1 })
    expect(results).toHaveLength(2)
    expect(results[0].chunkId).toBe('high')
    expect(results[1].chunkId).toBe('mid')
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  it('limits results to the specified count', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk({ id: `chunk-${i}`, embedding: [1 - i * 0.1, 0, 0] })
    )
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue(chunks)

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { limit: 2, minScore: 0.1 })
    expect(results).toHaveLength(2)
  })

  it('includes file name and relative path in results', async () => {
    const chunk = makeChunk({ embedding: [1, 0, 0] })
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([chunk])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { minScore: 0.3 })
    expect(results[0].fileName).toBe('notes.md')
    expect(results[0].relativePath).toBe('notes/notes.md')
  })

  it('includes mount point name in results', async () => {
    const chunk = makeChunk({ embedding: [1, 0, 0] })
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([chunk])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { minScore: 0.3 })
    expect(results[0].mountPointName).toBe('Archive')
  })

  it('scopes search to project-linked mount points when projectId is given', async () => {
    const repos = makeRepos()
    repos.projectDocMountLinks.findByProjectId = jest
      .fn()
      .mockResolvedValue([{ mountPointId: 'mp-project' }])
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await searchDocumentChunks([1, 0, 0], { projectId: 'proj-1' })

    expect(repos.projectDocMountLinks.findByProjectId).toHaveBeenCalledWith('proj-1')
    expect(repos.docMountChunks.findAllWithEmbeddingsByMountPointIds).toHaveBeenCalledWith([
      'mp-project',
    ])
  })

  it('returns empty when project has no linked mount points', async () => {
    const repos = makeRepos()
    repos.projectDocMountLinks.findByProjectId = jest.fn().mockResolvedValue([])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { projectId: 'proj-empty' })
    expect(results).toEqual([])
    // Should not even attempt to load chunks
    expect(repos.docMountChunks.findAllWithEmbeddingsByMountPointIds).not.toHaveBeenCalled()
  })

  it('scopes search to explicit mount point IDs when provided', async () => {
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await searchDocumentChunks([1, 0, 0], { mountPointIds: ['mp-specific'] })

    expect(repos.docMountChunks.findAllWithEmbeddingsByMountPointIds).toHaveBeenCalledWith([
      'mp-specific',
    ])
  })

  describe('pathPrefix filter', () => {
    /**
     * Helper that wires both the file-by-id map (used to render results) and
     * the file-by-mountPoint listing (used by the new pre-scoring file-id
     * allowlist). Mirrors how the production search joins chunks to files.
     */
    function makeReposWithFileMap(
      fileMap: Record<string, { fileName: string; relativePath: string; mountPointId?: string }>,
      options: { mountPointId?: string } = {},
    ) {
      const defaultMp = options.mountPointId ?? 'mp-1'
      const repos = makeRepos()
      repos.docMountFiles.findById = jest.fn(async (id: string) => {
        const f = fileMap[id]
        return f ? { id, ...f } : null
      })
      // New: file listing by mountPointId, used to build the pre-scoring allowlist.
      ;(repos.docMountFiles as Record<string, unknown>).findByMountPointId = jest.fn(async (mpId: string) => {
        return Object.entries(fileMap)
          .filter(([, f]) => (f.mountPointId ?? defaultMp) === mpId)
          .map(([id, f]) => ({ id, ...f, mountPointId: f.mountPointId ?? defaultMp }))
      })
      return repos
    }

    it('filters out chunks whose file is outside the prefix (pre-scoring allowlist)', async () => {
      const knowledgeChunk = makeChunk({
        id: 'k-1',
        fileId: 'file-knowledge',
        embedding: [0.6, 0, 0], // lower score, but inside prefix
      })
      const wardrobeChunk = makeChunk({
        id: 'w-1',
        fileId: 'file-wardrobe',
        embedding: [1, 0, 0], // top score, but outside prefix
      })

      const repos = makeReposWithFileMap({
        'file-knowledge': { fileName: 'archive.md', relativePath: 'Knowledge/archive.md' },
        'file-wardrobe': { fileName: 'coat.md', relativePath: 'Wardrobe/coat.md' },
      })
      repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
        .fn()
        .mockResolvedValue([wardrobeChunk, knowledgeChunk])

      mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

      const results = await searchDocumentChunks([1, 0, 0], {
        pathPrefix: 'Knowledge/',
        minScore: 0.1,
      })

      expect(results).toHaveLength(1)
      expect(results[0].chunkId).toBe('k-1')
      expect(results[0].relativePath).toBe('Knowledge/archive.md')
    })

    it('matches the prefix case-insensitively (lowercase, mixed-case, uppercase)', async () => {
      const lower = makeChunk({ id: 'lc', fileId: 'f-lc', embedding: [1, 0, 0] })
      const mixed = makeChunk({ id: 'mc', fileId: 'f-mc', embedding: [0.9, 0, 0] })
      const upper = makeChunk({ id: 'uc', fileId: 'f-uc', embedding: [0.8, 0, 0] })
      const other = makeChunk({ id: 'ot', fileId: 'f-ot', embedding: [0.7, 0, 0] })

      const repos = makeReposWithFileMap({
        'f-lc': { fileName: 'a.md', relativePath: 'knowledge/a.md' },
        'f-mc': { fileName: 'b.md', relativePath: 'Knowledge/b.md' },
        'f-uc': { fileName: 'c.md', relativePath: 'KNOWLEDGE/c.md' },
        'f-ot': { fileName: 'd.md', relativePath: 'Other/d.md' },
      })
      repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
        .fn()
        .mockResolvedValue([lower, mixed, upper, other])

      mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

      const results = await searchDocumentChunks([1, 0, 0], {
        pathPrefix: 'Knowledge/',
        minScore: 0.1,
      })

      expect(results.map(r => r.chunkId).sort()).toEqual(['lc', 'mc', 'uc'])
    })

    it('returns empty when no files match the prefix', async () => {
      const wardrobeChunk = makeChunk({
        id: 'w-1',
        fileId: 'file-wardrobe',
        embedding: [1, 0, 0],
      })
      const repos = makeReposWithFileMap({
        'file-wardrobe': { fileName: 'coat.md', relativePath: 'Wardrobe/coat.md' },
      })
      repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
        .fn()
        .mockResolvedValue([wardrobeChunk])

      mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

      const results = await searchDocumentChunks([1, 0, 0], {
        pathPrefix: 'Knowledge/',
        minScore: 0.1,
      })

      expect(results).toEqual([])
    })

    it('regression: 100 non-Knowledge vault chunks must not starve a single Knowledge/ chunk', async () => {
      // Covenant wall against the original ordering bug.
      //
      // Production geometry that surfaced this bug: Friday's vault held ~100
      // chunks of character canon (wardrobe, scenarios, prompts, identity,
      // description, etc.) plus exactly 1 chunk under Knowledge/. Even an
      // explicit search for the Knowledge file's own contents returned
      // knowledgeSources: 0 because the prior pool-multiplier filter ran
      // *after* scoring: 100 semantically-similar character chunks
      // out-scored the lone Knowledge/ chunk and crowded it out of the
      // top-K pool, so the post-filter dropped what was left.
      //
      // pathPrefix is jurisdiction, not a relevance preference. The
      // allowlist is computed before scoring, the Knowledge chunk competes
      // only with itself, and the result must be the Knowledge chunk.
      // If a future refactor pushes the prefix back into a post-filter
      // shape, this test fails immediately.
      const noiseChunks = Array.from({ length: 100 }, (_, i) =>
        makeChunk({
          id: `n-${i}`,
          fileId: `f-n-${i}`,
          embedding: [1 - i * 0.001, 0, 0], // 100 chunks scored from 1.000 down to 0.901
        }),
      )
      const knowledgeChunk = makeChunk({
        id: 'k-deep',
        fileId: 'f-k-deep',
        embedding: [0.4, 0, 0], // far below every noise chunk
      })

      const fileMap: Record<string, { fileName: string; relativePath: string }> = {
        'f-k-deep': { fileName: 'deep.md', relativePath: 'Knowledge/deep.md' },
      }
      for (let i = 0; i < 100; i++) {
        const folder = i < 50 ? 'Wardrobe' : i < 80 ? 'Scenarios' : 'Prompts'
        fileMap[`f-n-${i}`] = {
          fileName: `n${i}.md`,
          relativePath: `${folder}/n${i}.md`,
        }
      }

      const repos = makeReposWithFileMap(fileMap)
      repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
        .fn()
        .mockResolvedValue([...noiseChunks, knowledgeChunk])

      mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

      const results = await searchDocumentChunks([1, 0, 0], {
        pathPrefix: 'Knowledge/',
        limit: 1,
        minScore: 0.1,
      })

      expect(results).toHaveLength(1)
      expect(results[0].chunkId).toBe('k-deep')
      expect(results[0].relativePath).toBe('Knowledge/deep.md')
    })
  })

  it('includes headingContext (may be null) in each result', async () => {
    const chunkWithHeading = makeChunk({
      id: 'c-h',
      embedding: [1, 0, 0],
      headingContext: 'Introduction',
    })
    const chunkNoHeading = makeChunk({
      id: 'c-n',
      embedding: [0.9, 0, 0],
      headingContext: null,
    })
    const repos = makeRepos()
    repos.docMountChunks.findAllWithEmbeddingsByMountPointIds = jest
      .fn()
      .mockResolvedValue([chunkWithHeading, chunkNoHeading])

    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const results = await searchDocumentChunks([1, 0, 0], { minScore: 0.3 })
    const withHeading = results.find(r => r.chunkId === 'c-h')
    const withoutHeading = results.find(r => r.chunkId === 'c-n')
    expect(withHeading?.headingContext).toBe('Introduction')
    expect(withoutHeading?.headingContext).toBeNull()
  })
})
