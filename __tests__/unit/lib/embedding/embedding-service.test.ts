/**
 * Unit tests for the embedding service introduced after 1.5-dev.
 * Validates provider-specific calls, fallbacks, and similarity helpers.
 */

// Unmock the embedding service since jest.setup.ts mocks it globally,
// but this test needs the real module to test its actual behavior.
jest.unmock('@/lib/embedding/embedding-service')

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))
jest.mock('@/lib/plugins/provider-registry', () => ({
  providerRegistry: {
    createEmbeddingProvider: jest.fn(),
    getProvider: jest.fn(),
  },
}))
jest.mock('@quilltap/plugin-types', () => ({
  isLocalEmbeddingProvider: jest.fn(),
}))

import * as embeddingService from '@/lib/embedding/embedding-service'
import { getRepositories } from '@/lib/repositories/factory'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { isLocalEmbeddingProvider } from '@quilltap/plugin-types'
import type { EmbeddingProfile } from '@/lib/schemas/types'

const {
  getDefaultEmbeddingProfile,
  getEmbeddingProfile,
  generateEmbedding,
  generateEmbeddingForUser,
  extractSearchTerms,
  prepareForSearch,
  cosineSimilarity,
  textSimilarity,
  isEmbeddingAvailable,
  getUserEmbeddingProfiles,
} = embeddingService

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockIsLocalEmbeddingProvider = isLocalEmbeddingProvider as jest.MockedFunction<typeof isLocalEmbeddingProvider>
const mockCreateEmbeddingProvider = providerRegistry.createEmbeddingProvider as jest.MockedFunction<typeof providerRegistry.createEmbeddingProvider>
const mockGetProvider = providerRegistry.getProvider as jest.MockedFunction<typeof providerRegistry.getProvider>

const now = new Date().toISOString()
const userId = '11111111-1111-1111-1111-111111111111'

const mockRepos = {
  embeddingProfiles: {
    findDefault: jest.fn(),
    findById: jest.fn(),
    findByUserId: jest.fn(),
  },
  connections: {
    findApiKeyById: jest.fn(),
    findApiKeyByIdAndUserId: jest.fn(),
  },
}

function makeProfile(overrides: Partial<EmbeddingProfile> = {}): EmbeddingProfile {
  return {
    id: 'profile-1',
    userId,
    name: 'Default Embedding',
    provider: 'OPENAI',
    apiKeyId: 'key-1',
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'text-embedding-3-small',
    dimensions: 1536,
    isDefault: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createMockEmbeddingProvider(embedding: number[]) {
  return {
    generateEmbedding: jest.fn().mockResolvedValue({
      embedding,
      model: 'test-model',
      dimensions: embedding.length,
    }),
  }
}

describe('embedding service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReturnValue(mockRepos as any)
    mockRepos.embeddingProfiles.findDefault.mockResolvedValue(null)
    mockRepos.embeddingProfiles.findById.mockResolvedValue(null)
    mockRepos.embeddingProfiles.findByUserId.mockResolvedValue([])
    mockRepos.connections.findApiKeyById.mockResolvedValue(null)
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue(null)
    mockIsLocalEmbeddingProvider.mockReturnValue(false)
  })

  it('calls OpenAI embeddings API when provider is OPENAI', async () => {
    const profile = makeProfile()
    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({
      key_value: 'sk-test',
    })

    // Use a unit-length fixture so the service's L2 normalisation is a no-op
    // and we can assert exact output.
    const mockProvider = createMockEmbeddingProvider([1, 0, 0])
    mockCreateEmbeddingProvider.mockReturnValue(mockProvider as any)
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: true } } as any)

    const embedding = await generateEmbedding('hello world', profile, userId)

    expect(mockCreateEmbeddingProvider).toHaveBeenCalledWith('OPENAI', profile.baseUrl)
    expect(mockProvider.generateEmbedding).toHaveBeenCalledWith(
      'hello world',
      profile.modelName,
      'sk-test',
      { dimensions: profile.dimensions }
    )
    expect(embedding.embedding).toBeInstanceOf(Float32Array)
    expect(Array.from(embedding.embedding)).toEqual([1, 0, 0])
    expect(embedding.provider).toBe('OPENAI')
  })

  it('calls Ollama embedding endpoint when provider is OLLAMA', async () => {
    const profile = makeProfile({
      provider: 'OLLAMA',
      baseUrl: 'http://localhost:11434',
      apiKeyId: null,
    })

    const mockProvider = createMockEmbeddingProvider([0.5, 0.4, 0.3])
    mockCreateEmbeddingProvider.mockReturnValue(mockProvider as any)
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: false } } as any)

    const embedding = await generateEmbedding('text to embed', profile, userId)

    expect(mockCreateEmbeddingProvider).toHaveBeenCalledWith('OLLAMA', profile.baseUrl)
    expect(embedding.provider).toBe('OLLAMA')
    expect(embedding.embedding.length).toBe(3)
  })

  it('throws when OpenAI profile lacks an API key', async () => {
    const profile = makeProfile({ apiKeyId: null })
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: true } } as any)
    mockCreateEmbeddingProvider.mockReturnValue({
      generateEmbedding: jest.fn(),
    } as any)

    await expect(generateEmbedding('missing key', profile, userId)).rejects.toThrow('No API key found')
  })

  it('selects explicit profile IDs before using defaults', async () => {
    const profile = makeProfile({ id: 'profile-abc', provider: 'OLLAMA', baseUrl: 'http://localhost:11434', apiKeyId: null })
    mockRepos.embeddingProfiles.findById.mockResolvedValue(profile)

    // [0.6, 0.8] is already unit length — normalisation is a no-op.
    const mockProvider = createMockEmbeddingProvider([0.6, 0.8])
    mockCreateEmbeddingProvider.mockReturnValue(mockProvider as any)
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: false } } as any)

    const result = await generateEmbeddingForUser('text', userId, profile.id)
    expect(Array.from(result.embedding)).toEqual([expect.closeTo(0.6, 5), expect.closeTo(0.8, 5)])
    expect(mockRepos.embeddingProfiles.findDefault).not.toHaveBeenCalled()
  })

  it('falls back to the default profile when no explicit ID is provided', async () => {
    const profile = makeProfile()
    mockRepos.embeddingProfiles.findDefault.mockResolvedValue(profile)

    mockRepos.connections.findApiKeyByIdAndUserId.mockResolvedValue({
      key_value: 'sk-test',
    })

    // Unit-length fixture so normalisation leaves it unchanged.
    const mockProvider = createMockEmbeddingProvider([1, 0])
    mockCreateEmbeddingProvider.mockReturnValue(mockProvider as any)
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: true } } as any)

    const result = await generateEmbeddingForUser('fallback text', userId)
    expect(mockCreateEmbeddingProvider).toHaveBeenCalledWith('OPENAI', profile.baseUrl)
    expect(Array.from(result.embedding)).toEqual([1, 0])
  })

  it('extracts keywords and phrases for fallback search', () => {
    const result = extractSearchTerms('"exact phrase" find quick brown fox jumps')
    expect(result.exactPhrases).toEqual(['exact phrase'])
    expect(result.keywords).toEqual(expect.arrayContaining(['quick', 'brown', 'fox', 'jumps']))
    expect(result.usedEmbedding).toBe(false)
  })

  it('prepares embeddings for search when generation succeeds', async () => {
    const profile = makeProfile({ provider: 'OLLAMA', baseUrl: 'http://localhost:11434', apiKeyId: null })
    mockRepos.embeddingProfiles.findDefault.mockResolvedValue(profile)

    const mockProvider = createMockEmbeddingProvider([0, 1])
    mockCreateEmbeddingProvider.mockReturnValue(mockProvider as any)
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: false } } as any)

    const result = await prepareForSearch('embed me', userId)
    expect(result.usedEmbedding).toBe(true)
    if (result.usedEmbedding) {
      expect(Array.from(result.embedding.embedding)).toEqual([0, 1])
    }
  })

  it('falls back to keyword extraction when embedding fails', async () => {
    mockRepos.embeddingProfiles.findDefault.mockResolvedValue(null)
    const result = await prepareForSearch('fallback search content', userId)
    expect(result.usedEmbedding).toBe(false)
    expect(result.keywords.length).toBeGreaterThan(0)
  })

  it('computes cosine similarity and keyword similarity scores', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)

    const terms = extractSearchTerms('"hello world" quick fox')
    const score = textSimilarity(terms, 'hello world quick fox jumps over')
    expect(score).toBeGreaterThan(0)
  })

  it('reports embedding availability for the current user', async () => {
    const profile = makeProfile()
    mockRepos.embeddingProfiles.findDefault.mockResolvedValueOnce(profile)
    expect(await isEmbeddingAvailable(userId)).toBe(true)

    mockRepos.embeddingProfiles.findDefault.mockResolvedValueOnce(null)
    expect(await isEmbeddingAvailable(userId)).toBe(false)
  })

  it('exposes helper accessors for profiles', async () => {
    const profile = makeProfile()
    mockRepos.embeddingProfiles.findByUserId.mockResolvedValue([profile])
    mockRepos.embeddingProfiles.findById.mockResolvedValue(profile)

    expect(await getUserEmbeddingProfiles(userId)).toEqual([profile])
    expect(await getDefaultEmbeddingProfile(userId)).toBeNull()
    expect(await getEmbeddingProfile(profile.id)).toBe(profile)
  })
})
