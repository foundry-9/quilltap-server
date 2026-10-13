/**
 * Bug 204: the background re-embed (EMBEDDING_GENERATE for a MEMORY) and the
 * BUILTIN vocabulary refit must build a memory's text through
 * `embeddingTextFor`, the builder the gate and the create paths use —
 * anchor line (when / place) included.
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
  averageEmbeddings: jest.fn(),
  EMBEDDING_MAX_CHARS: 128 * 1024,
}))

// The real text builder; only the index's row/cache write is stubbed.
jest.mock('@/lib/memory/index-store', () => ({
  ...jest.requireActual('@/lib/memory/index-store'),
  memoryIndex: { upsert: jest.fn().mockResolvedValue([]) },
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingReindexAll: jest.fn().mockResolvedValue(undefined),
}))

import { handleEmbeddingGenerate } from '@/lib/background-jobs/handlers/embedding-generate'
import { handleEmbeddingRefit } from '@/lib/background-jobs/handlers/embedding-refit'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { embeddingTextFor, memoryIndex } from '@/lib/memory/index-store'
import type { BackgroundJob } from '@/lib/schemas/types'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockGenerate = generateEmbeddingForUser as jest.MockedFunction<typeof generateEmbeddingForUser>

const anchoredMemory = {
  id: 'mem-1',
  characterId: 'char-1',
  summary: 'Lighthouse picnic',
  content: 'We ate sandwiches at the lighthouse.',
  occurredAt: '2026-07-14T12:00:00.000Z',
  narrativeTime: null,
  entities: ['Gullhaven'],
}

function job(type: string, payload: Record<string, unknown>): BackgroundJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    type,
    status: 'PROCESSING',
    payload,
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  } as unknown as BackgroundJob
}

describe('bug 204 — background memory embeds carry the anchor line', () => {
  beforeEach(() => jest.clearAllMocks())

  it('EMBEDDING_GENERATE embeds embeddingTextFor(memory), anchor line included, and writes through memoryIndex', async () => {
    mockGenerate.mockResolvedValue({ embedding: new Float32Array([1, 0]), dimensions: 2 } as never)
    mockGetRepositories.mockReturnValue({
      memories: {
        findById: jest.fn().mockResolvedValue(anchoredMemory),
        updateForCharacter: jest.fn().mockResolvedValue(anchoredMemory),
      },
      embeddingStatus: {
        markAsEmbedded: jest.fn().mockResolvedValue(undefined),
        markAsFailed: jest.fn().mockResolvedValue(undefined),
      },
    } as never)

    await handleEmbeddingGenerate(job('EMBEDDING_GENERATE', { entityType: 'MEMORY', entityId: 'mem-1', profileId: 'p-1' }))

    const expected = embeddingTextFor(anchoredMemory)
    expect(expected).toContain('place: Gullhaven')
    expect(mockGenerate).toHaveBeenCalledWith(expected, 'user-1', 'p-1', { priority: 'background' })
    // The vector lands through the index (row + cache), hot by default.
    expect(memoryIndex.upsert).toHaveBeenCalledWith('char-1', [
      { id: 'mem-1', embedding: new Float32Array([1, 0]), tier: 'hot' },
    ])
  })

  it('EMBEDDING_REFIT fits the vocabulary on the anchored text', async () => {
    const upsertByProfileId = jest.fn().mockResolvedValue(undefined)
    mockGetRepositories.mockReturnValue({
      embeddingProfiles: { findById: jest.fn().mockResolvedValue({ id: 'p-1', provider: 'BUILTIN' }) },
      characters: { findByUserId: jest.fn().mockResolvedValue([{ id: 'char-1' }]) },
      memories: { findByCharacterId: jest.fn().mockResolvedValue([anchoredMemory]) },
      helpDocs: { findAll: jest.fn().mockResolvedValue([]) },
      tfidfVocabularies: { upsertByProfileId },
    } as never)

    await handleEmbeddingRefit(job('EMBEDDING_REFIT', { profileId: 'p-1', triggerReindex: false }))

    // The entity word appears only in the anchor line; it is in the fitted
    // vocabulary only if the corpus was built with the anchor.
    const saved = upsertByProfileId.mock.calls[0][1] as { vocabulary: string }
    const terms = JSON.stringify(JSON.parse(saved.vocabulary))
    expect(terms).toContain('"gullhaven"')
    expect(terms).toContain('"place"')
  })
})
