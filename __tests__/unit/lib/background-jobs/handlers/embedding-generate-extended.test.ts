/**
 * Unit tests for the HELP_DOC and MOUNT_CHUNK entity type branches
 * of lib/background-jobs/handlers/embedding-generate.ts
 *
 * Covers:
 *  - HELP_DOC: document vector averaged from section vectors (never the
 *    whole text, which can exceed a provider's input ceiling — bug 168)
 *  - Not-found handling for HELP_DOC
 *  - Error propagation for HELP_DOC
 *  - Successful embedding generation and storage for MOUNT_CHUNK
 *  - Not-found handling for MOUNT_CHUNK
 *  - Error propagation for MOUNT_CHUNK
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  // The real averaging, so the stored document vector is checked for what it is
  averageEmbeddings: jest.requireActual('@/lib/embedding/embedding-service').averageEmbeddings,
  EMBEDDING_MAX_CHARS: 128 * 1024,
}))

jest.mock('@/lib/embedding/vector-store', () => ({
  getVectorStoreManager: jest.fn().mockReturnValue({
    unloadStore: jest.fn(),
  }),
}))

jest.mock('@/lib/database/repositories/vector-indices.repository', () => ({
  getVectorIndicesRepository: jest.fn().mockReturnValue({
    entryExists: jest.fn().mockResolvedValue(false),
    addEntry: jest.fn().mockResolvedValue(undefined),
    updateEntryEmbedding: jest.fn().mockResolvedValue(true),
    saveMeta: jest.fn().mockResolvedValue(undefined),
  }),
}))

import { handleEmbeddingGenerate } from '@/lib/background-jobs/handlers/embedding-generate'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import type { BackgroundJob } from '@/lib/schemas/types'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockGenerateEmbeddingForUser = generateEmbeddingForUser as jest.MockedFunction<typeof generateEmbeddingForUser>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJob(entityType: string, entityId: string = 'entity-1'): BackgroundJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    type: 'EMBEDDING_GENERATE',
    status: 'pending',
    payload: {
      entityType,
      entityId,
      profileId: 'profile-1',
    },
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as BackgroundJob
}

const fakeEmbedding = [0.1, 0.2, 0.3]
const embeddingResult = {
  embedding: fakeEmbedding,
  model: 'test-model',
  dimensions: 3,
  provider: 'TEST',
}

function makeRepos(helpDocs = {}, docMountChunks = {}, embeddingStatus = {}, helpDocChunks = {}) {
  return {
    helpDocs: {
      findById: jest.fn(),
      updateEmbedding: jest.fn().mockResolvedValue(undefined),
      ...helpDocs,
    },
    helpDocChunks: {
      findByDocId: jest.fn().mockResolvedValue([]),
      updateEmbedding: jest.fn().mockResolvedValue(undefined),
      ...helpDocChunks,
    },
    docMountChunks: {
      findById: jest.fn(),
      updateEmbedding: jest.fn().mockResolvedValue(undefined),
      ...docMountChunks,
    },
    embeddingStatus: {
      markAsEmbedded: jest.fn().mockResolvedValue(undefined),
      markAsFailed: jest.fn().mockResolvedValue(undefined),
      ...embeddingStatus,
    },
    // Other repos that MEMORY/CONVERSATION_CHUNK branches need:
    memories: { findById: jest.fn(), updateForCharacter: jest.fn() },
    conversationChunks: { findById: jest.fn(), updateEmbedding: jest.fn() },
  }
}

// ---------------------------------------------------------------------------
// HELP_DOC tests
// ---------------------------------------------------------------------------

describe('handleEmbeddingGenerate — HELP_DOC entity type', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGenerateEmbeddingForUser.mockResolvedValue(embeddingResult)
  })

  function chunkRow(id: string, chunkIndex: number, embedding: Float32Array | null = null) {
    return { id, docId: 'doc-1', chunkIndex, heading: `Section ${chunkIndex}`, content: `Body ${chunkIndex}.`, embedding }
  }

  it('stores the normalised mean of the section vectors as the document vector', async () => {
    const doc = { id: 'doc-1', title: 'Welcome', content: 'Hello world.' }
    const repos = makeRepos(
      { findById: jest.fn().mockResolvedValue(doc) },
      {},
      {},
      { findByDocId: jest.fn().mockResolvedValue([chunkRow('c0', 0), chunkRow('c1', 1)]) }
    )
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)
    mockGenerateEmbeddingForUser
      .mockResolvedValueOnce({ ...embeddingResult, embedding: new Float32Array([1, 0]) })
      .mockResolvedValueOnce({ ...embeddingResult, embedding: new Float32Array([0, 1]) })

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))

    // Each section is embedded under its title path; the whole text never is.
    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledTimes(2)
    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledWith(
      'Welcome › Section 0\n\nBody 0.',
      'user-1',
      'profile-1',
      { priority: 'background' }
    )
    expect(repos.helpDocChunks.updateEmbedding).toHaveBeenCalledWith('c0', new Float32Array([1, 0]))
    expect(repos.helpDocChunks.updateEmbedding).toHaveBeenCalledWith('c1', new Float32Array([0, 1]))

    const [docId, vector] = (repos.helpDocs.updateEmbedding as jest.Mock).mock.calls[0]
    expect(docId).toBe('doc-1')
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2)
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2)
    expect(repos.embeddingStatus.markAsEmbedded).toHaveBeenCalledWith(
      'HELP_DOC',
      'doc-1',
      'profile-1',
      'user-1'
    )
  })

  it('embeds a document far larger than any provider input ceiling (bug 168)', async () => {
    const huge = Array.from({ length: 80 }, (_, i) =>
      `## Section ${i}\n\n${'Words about this setting and what it does. '.repeat(40)}`
    ).join('\n\n')
    const doc = { id: 'doc-1', title: 'Chat Settings', content: huge }
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(doc) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)
    mockGenerateEmbeddingForUser.mockResolvedValue({ ...embeddingResult, embedding: new Float32Array([0.6, 0.8]) })

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))

    // No stored rows yet, so the doc is sliced in memory — and no single call
    // carries more than a section's worth of text.
    const longest = Math.max(...mockGenerateEmbeddingForUser.mock.calls.map(([text]) => (text as string).length))
    expect(longest).toBeLessThan(huge.length / 10)
    expect(repos.helpDocChunks.updateEmbedding).not.toHaveBeenCalled()
    expect(repos.helpDocs.updateEmbedding).toHaveBeenCalledWith('doc-1', expect.any(Float32Array))
    expect(repos.embeddingStatus.markAsEmbedded).toHaveBeenCalled()
  })

  it('reuses stored section vectors and re-embeds those of another width', async () => {
    const doc = { id: 'doc-1', title: 'Welcome', content: 'Hello.' }
    const repos = makeRepos(
      { findById: jest.fn().mockResolvedValue(doc) },
      {},
      {},
      {
        findByDocId: jest.fn().mockResolvedValue([
          chunkRow('c0', 0, new Float32Array([1, 0])),        // current width, reused
          chunkRow('c1', 1),                                   // missing, embedded
          chunkRow('c2', 2, new Float32Array([1, 0, 0])),     // stale profile, re-embedded
        ]),
      }
    )
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)
    mockGenerateEmbeddingForUser.mockResolvedValue({ ...embeddingResult, embedding: new Float32Array([0, 1]) })

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))

    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledTimes(2)
    expect(repos.helpDocChunks.updateEmbedding).not.toHaveBeenCalledWith('c0', expect.anything())
    expect(repos.helpDocChunks.updateEmbedding).toHaveBeenCalledWith('c2', new Float32Array([0, 1]))
    const [, vector] = (repos.helpDocs.updateEmbedding as jest.Mock).mock.calls[0]
    expect(vector).toHaveLength(2)
  })

  it('still embeds the document when one section fails', async () => {
    const doc = { id: 'doc-1', title: 'Welcome', content: 'Hello.' }
    const repos = makeRepos(
      { findById: jest.fn().mockResolvedValue(doc) },
      {},
      {},
      { findByDocId: jest.fn().mockResolvedValue([chunkRow('c0', 0), chunkRow('c1', 1)]) }
    )
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)
    mockGenerateEmbeddingForUser
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ ...embeddingResult, embedding: new Float32Array([0, 1]) })

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))

    expect(repos.helpDocs.updateEmbedding).toHaveBeenCalledWith('doc-1', new Float32Array([0, 1]))
    expect(repos.embeddingStatus.markAsEmbedded).toHaveBeenCalled()
  })

  it('marks status as failed and returns when HELP_DOC is not found', async () => {
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(null) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'missing-doc'))

    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'HELP_DOC',
      'missing-doc',
      'profile-1',
      expect.stringContaining('not found'),
      'user-1'
    )
  })

  it('marks status as failed and rethrows when embedding generation fails for HELP_DOC', async () => {
    const doc = { id: 'doc-1', title: 'Welcome', content: 'Hello.' }
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(doc) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const embeddingError = new Error('Embedding API unavailable')
    mockGenerateEmbeddingForUser.mockRejectedValue(embeddingError)

    await expect(handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))).rejects.toThrow(
      'Embedding API unavailable'
    )
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'HELP_DOC',
      'doc-1',
      'profile-1',
      'Embedding API unavailable',
      'user-1'
    )
    expect(repos.helpDocs.updateEmbedding).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// MOUNT_CHUNK tests
// ---------------------------------------------------------------------------

describe('handleEmbeddingGenerate — MOUNT_CHUNK entity type', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGenerateEmbeddingForUser.mockResolvedValue(embeddingResult)
  })

  it('generates and stores embedding for a found MOUNT_CHUNK', async () => {
    const chunk = {
      id: 'chunk-1',
      mountPointId: 'mp-1',
      content: 'Chapter content here.',
    }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))

    expect(mockGenerateEmbeddingForUser).toHaveBeenCalledWith(
      chunk.content,
      'user-1',
      'profile-1',
      { priority: 'background' }
    )
    expect(repos.docMountChunks.updateEmbedding).toHaveBeenCalledWith('chunk-1', fakeEmbedding)
    expect(repos.embeddingStatus.markAsEmbedded).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-1',
      'profile-1',
      'user-1'
    )
  })

  it('marks status as failed and returns when MOUNT_CHUNK is not found', async () => {
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(null) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'missing-chunk'))

    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'missing-chunk',
      'profile-1',
      expect.stringContaining('not found'),
      'user-1'
    )
  })

  it('skips an empty/whitespace MOUNT_CHUNK without calling the provider or retrying', async () => {
    const chunk = { id: 'chunk-empty', mountPointId: 'mp-1', content: '   \n  \t ' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    // Empty input is deterministically unembeddable (and triggers NaN on some
    // models) — it must be marked failed and skipped, never sent to the
    // provider and never rethrown (which would retry to DEAD).
    await expect(
      handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-empty'))
    ).resolves.toBeUndefined()

    expect(mockGenerateEmbeddingForUser).not.toHaveBeenCalled()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-empty',
      'profile-1',
      expect.stringContaining('Empty input'),
      'user-1'
    )
    expect(repos.docMountChunks.updateEmbedding).not.toHaveBeenCalled()
  })

  it('marks failed but does NOT rethrow on a deterministic (NaN) error for MOUNT_CHUNK', async () => {
    const chunk = { id: 'chunk-1', mountPointId: 'mp-1', content: 'Some content.' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    // A NaN/over-context error will recur on every retry, so it must be marked
    // failed and dropped — not rethrown (which would retry it to DEAD).
    mockGenerateEmbeddingForUser.mockRejectedValue(
      new Error('Ollama embedding failed: failed to encode response: json: unsupported value: NaN')
    )

    await expect(
      handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))
    ).resolves.toBeUndefined()
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-1',
      'profile-1',
      expect.stringContaining('NaN'),
      'user-1'
    )
    expect(repos.docMountChunks.updateEmbedding).not.toHaveBeenCalled()
  })

  it('marks status as failed and rethrows when embedding generation fails for MOUNT_CHUNK', async () => {
    const chunk = { id: 'chunk-1', mountPointId: 'mp-1', content: 'Some content.' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    const embeddingError = new Error('Provider timeout')
    mockGenerateEmbeddingForUser.mockRejectedValue(embeddingError)

    await expect(handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))).rejects.toThrow(
      'Provider timeout'
    )
    expect(repos.embeddingStatus.markAsFailed).toHaveBeenCalledWith(
      'MOUNT_CHUNK',
      'chunk-1',
      'profile-1',
      'Provider timeout',
      'user-1'
    )
    expect(repos.docMountChunks.updateEmbedding).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Routing tests — ensure entity type dispatch works correctly
// ---------------------------------------------------------------------------

describe('handleEmbeddingGenerate — entity type routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGenerateEmbeddingForUser.mockResolvedValue(embeddingResult)
  })

  it('routes HELP_DOC to the help doc handler (uses helpDocs repository)', async () => {
    const doc = { id: 'doc-1', title: 'T', content: 'C' }
    const repos = makeRepos({ findById: jest.fn().mockResolvedValue(doc) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('HELP_DOC', 'doc-1'))

    expect(repos.helpDocs.findById).toHaveBeenCalledWith('doc-1')
    expect(repos.docMountChunks.findById).not.toHaveBeenCalled()
  })

  it('routes MOUNT_CHUNK to the mount chunk handler (uses docMountChunks repository)', async () => {
    const chunk = { id: 'chunk-1', mountPointId: 'mp-1', content: 'C' }
    const repos = makeRepos({}, { findById: jest.fn().mockResolvedValue(chunk) })
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await handleEmbeddingGenerate(makeJob('MOUNT_CHUNK', 'chunk-1'))

    expect(repos.docMountChunks.findById).toHaveBeenCalledWith('chunk-1')
    expect(repos.helpDocs.findById).not.toHaveBeenCalled()
  })

  it('throws for an unsupported entity type', async () => {
    const repos = makeRepos()
    mockGetRepositories.mockReturnValue(repos as ReturnType<typeof getRepositories>)

    await expect(handleEmbeddingGenerate(makeJob('UNSUPPORTED_TYPE', 'entity-1'))).rejects.toThrow(
      /unsupported entity type/i
    )
  })
})
