/**
 * Review of PR 90, finding 1 (embedding half): every path that builds a
 * memory's embedded text resolves the memory-calendar zone first, so the
 * anchor line's `when:` date is the instance's calendar date even on a cold
 * timezone cache (a freshly forked job child) — never the env/system
 * fallback's.
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
  EmbeddingError: class EmbeddingError extends Error {},
  EMBEDDING_MAX_CHARS: 128 * 1024,
}))

jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {
    search: jest.fn(),
    shape: jest.fn(),
    upsert: jest.fn().mockResolvedValue([]),
    indexInserted: jest.fn(),
    setTier: jest.fn(),
    remove: jest.fn(),
    reload: jest.fn(),
    reloadAll: jest.fn(),
    entries: jest.fn(),
  },
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
}))

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueEmbeddingReindexAll: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/database/manager', () => ({ rawQuery: jest.fn() }))

import { handleEmbeddingGenerate } from '@/lib/background-jobs/handlers/embedding-generate'
import { reembedMemory } from '@/lib/memory/memory-gate'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { resetMemoryTimeZoneCacheForTests } from '@/lib/memory/time/calendar'
import type { BackgroundJob, Memory } from '@/lib/schemas/types'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockGenerate = generateEmbeddingForUser as jest.MockedFunction<typeof generateEmbeddingForUser>

// Local midnight of 2026-07-14 in Tokyo, stored as UTC (the day before).
const tokyoMemory = {
  id: 'mem-1',
  characterId: 'char-1',
  summary: 'Lighthouse picnic',
  content: 'We ate sandwiches at the lighthouse.',
  occurredAt: '2026-07-13T15:00:00.000Z',
  narrativeTime: null,
  entities: [],
} as unknown as Memory

const ORIGINAL_ENV_TZ = process.env.QUILLTAP_TIMEZONE

function job(payload: Record<string, unknown>): BackgroundJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    type: 'EMBEDDING_GENERATE',
    status: 'PROCESSING',
    payload,
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  } as unknown as BackgroundJob
}

function embeddedText(): string {
  return mockGenerate.mock.calls[mockGenerate.mock.calls.length - 1][0] as string
}

beforeEach(() => {
  jest.clearAllMocks()
  resetMemoryTimeZoneCacheForTests()
  process.env.QUILLTAP_TIMEZONE = 'UTC'
  mockGenerate.mockResolvedValue({ embedding: new Float32Array([1, 0]), dimensions: 2 } as never)
  mockGetRepositories.mockReturnValue({
    chatSettings: { findAll: jest.fn().mockResolvedValue([{ timezone: 'Asia/Tokyo' }]) },
    memories: {
      findById: jest.fn().mockResolvedValue(tokyoMemory),
      updateForCharacter: jest.fn().mockResolvedValue(tokyoMemory),
    },
    embeddingStatus: {
      markAsEmbedded: jest.fn().mockResolvedValue(undefined),
      markAsFailed: jest.fn().mockResolvedValue(undefined),
    },
  } as never)
})

afterAll(() => {
  if (ORIGINAL_ENV_TZ === undefined) delete process.env.QUILLTAP_TIMEZONE
  else process.env.QUILLTAP_TIMEZONE = ORIGINAL_ENV_TZ
  resetMemoryTimeZoneCacheForTests()
})

describe('memory anchor line on a cold timezone cache', () => {
  it('EMBEDDING_GENERATE (job child) embeds the instance-zone date', async () => {
    await handleEmbeddingGenerate(job({ entityType: 'MEMORY', entityId: 'mem-1', profileId: 'p-1' }))
    expect(embeddedText()).toContain('when: 2026-07-14')
  })

  it('reembedMemory embeds the instance-zone date', async () => {
    await reembedMemory(tokyoMemory, 'user-1', 'p-1')
    expect(embeddedText()).toContain('when: 2026-07-14')
  })
})
