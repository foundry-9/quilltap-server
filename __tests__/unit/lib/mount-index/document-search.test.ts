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
}))

import { searchDocumentChunks } from '@/lib/mount-index/document-search'
import { getRepositories } from '@/lib/repositories/factory'

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
