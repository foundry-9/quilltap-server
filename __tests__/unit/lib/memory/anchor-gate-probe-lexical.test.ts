/**
 * On a lexical (Built-in TF-IDF) profile the anchor probe's two sides embed
 * the same text, so it says so instead of reporting "no difference" as a
 * finding (review of PR 96); the anchored side passes the lexical text as
 * admission does.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {
    shape: jest.fn(async () => ({ size: 1, matching: 1, dominantDimensions: 2 })),
    search: jest.fn(async () => []),
  },
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
  lexicalEmbeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').lexicalEmbeddingTextFor,
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  cosineSimilarity: jest.fn(() => 0),
}))

import { runAnchorGateProbe } from '@/lib/memory/anchor-gate-probe'
import { getRepositories } from '@/lib/repositories/factory'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'

const mockRepos = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockGenerate = generateEmbeddingForUser as jest.MockedFunction<typeof generateEmbeddingForUser>

const memory = {
  id: 'm-1',
  characterId: 'c-1',
  summary: 'Lorian fears deep water',
  content: 'He nearly drowned as a boy.',
  occurredAt: '2026-07-14T12:00:00.000Z',
  entities: ['Lighthouse Point'],
  createdAt: '2026-07-14T12:00:00.000Z',
}

describe('anchor probe on a lexical profile', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos.mockReturnValue({
      memories: { findRecent: jest.fn().mockResolvedValue([memory]), findByIds: jest.fn().mockResolvedValue([]) },
    } as never)
  })

  it('flags a Built-in profile and hands the anchored side its lexical text', async () => {
    mockGenerate.mockResolvedValue({ embedding: new Float32Array([1, 0]), provider: 'BUILTIN' } as never)
    const result = await runAnchorGateProbe({ characterId: 'c-1', userId: 'u-1' })
    expect(result.lexicalProfile).toBe(true)
    expect(result.note).toMatch(/not measurable/)
    expect(result.thresholds.reinforce).toBe(0.4)
    expect(mockGenerate.mock.calls[0][3]).toMatchObject({ lexicalText: 'Lorian fears deep water\n\nHe nearly drowned as a boy.' })
  })

  it('reports a neural profile as measurable', async () => {
    mockGenerate.mockResolvedValue({ embedding: new Float32Array([1, 0]), provider: 'OPENAI' } as never)
    const result = await runAnchorGateProbe({ characterId: 'c-1', userId: 'u-1' })
    expect(result.lexicalProfile).toBe(false)
    expect(result.note).toBeNull()
    expect(result.thresholds.reinforce).toBe(0.85)
  })
})
