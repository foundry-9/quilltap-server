/**
 * The Built-in (TF-IDF) profile embeds the memory text a writer hands over as
 * `lexicalText` — without its anchor line (builtin-tfidf-memory-tuning §2); a
 * neural profile embeds the canonical text unchanged.
 */

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

import { generateEmbedding } from '@/lib/embedding/embedding-service'
import { embeddingTextFor, lexicalEmbeddingTextFor } from '@/lib/memory/index-store'
import { getRepositories } from '@/lib/repositories/factory'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { isLocalEmbeddingProvider } from '@quilltap/plugin-types'
import { TfIdfVectorizer } from '@/plugins/dist/qtap-plugin-builtin-embeddings/tfidf-vectorizer'
import type { EmbeddingProfile } from '@/lib/schemas/types'

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>
const mockCreate = providerRegistry.createEmbeddingProvider as jest.MockedFunction<typeof providerRegistry.createEmbeddingProvider>
const mockGetProvider = providerRegistry.getProvider as jest.MockedFunction<typeof providerRegistry.getProvider>
const mockIsLocal = isLocalEmbeddingProvider as jest.MockedFunction<typeof isLocalEmbeddingProvider>

const memory = {
  summary: 'Lorian fears deep water',
  content: 'Lorian nearly drowned as a boy in the millpond.',
  occurredAt: '2026-07-14T12:00:00.000Z',
  narrativeTime: 'second evening',
  entities: ['Lighthouse Point', 'Bram'],
}
const anchorFree = 'Lorian fears deep water\n\nLorian nearly drowned as a boy in the millpond.'

function profile(provider: string): EmbeddingProfile {
  const now = new Date().toISOString()
  return {
    id: 'p-1',
    userId: 'u-1',
    name: 'p',
    provider,
    apiKeyId: null,
    baseUrl: null,
    modelName: provider === 'BUILTIN' ? 'tfidf-bm25-v1' : 'text-embedding-3-small',
    dimensions: null,
    isDefault: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as EmbeddingProfile
}

describe('lexicalEmbeddingTextFor', () => {
  it('is the canonical text without its anchor line', () => {
    const text = embeddingTextFor(memory, 'UTC')
    expect(text).toContain('(when: 2026-07-14')
    expect(lexicalEmbeddingTextFor(memory)).toBe(anchorFree)
    expect(text.startsWith(lexicalEmbeddingTextFor(memory))).toBe(true)
  })

  it('keeps content that happens to end in an anchor-like line', () => {
    const garden = { summary: 'Garden', content: 'We sat outside.\n(place: the garden)' }
    expect(lexicalEmbeddingTextFor(garden)).toBe('Garden\n\nWe sat outside.\n(place: the garden)')
  })

  it('makes one fact told on two days identical to a lexical embedder', () => {
    const other = { ...memory, occurredAt: '2026-08-02T12:00:00.000Z', entities: ['Harbor Inn'] }
    const v = new TfIdfVectorizer(true)
    v.fitCorpus([
      embeddingTextFor(memory, 'UTC'),
      embeddingTextFor(other, 'UTC'),
      'Mara drinks Earl Grey\n\nMara orders Earl Grey with lemon.',
      'Bram keeps the lighthouse\n\nBram has kept the lighthouse for thirty years.',
    ])
    const cos = (a: string, b: string) => TfIdfVectorizer.cosineSimilarity(v.transform(a), v.transform(b))
    expect(cos(embeddingTextFor(memory, 'UTC'), embeddingTextFor(other, 'UTC'))).toBeLessThan(0.8)
    expect(cos(lexicalEmbeddingTextFor(memory), lexicalEmbeddingTextFor(other))).toBeCloseTo(1, 5)
  })
})

describe('generateEmbedding text shape by provider', () => {
  const generate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    generate.mockImplementation(() => ({ embedding: [1, 0], model: 'm', dimensions: 2 }))
  })

  it('BUILTIN embeds the lexical text a memory writer hands over, and other text as given', async () => {
    mockGetRepositories.mockReturnValue({
      tfidfVocabularies: {
        findByProfileId: jest.fn().mockResolvedValue({
          vocabulary: '[]', idf: '[]', avgDocLength: 1, vocabularySize: 0, includeBigrams: true, fittedAt: 'x',
        }),
      },
    } as never)
    mockIsLocal.mockReturnValue(true)
    mockCreate.mockReturnValue({ loadState: jest.fn(), generateEmbedding: generate } as never)

    await generateEmbedding(embeddingTextFor(memory, 'UTC'), profile('BUILTIN'), 'u-1', { lexicalText: lexicalEmbeddingTextFor(memory) })
    expect(generate).toHaveBeenLastCalledWith(anchorFree)
    // A help section or query that ends in parentheses is never trimmed.
    await generateEmbedding('Section\n(place: the garden)', profile('BUILTIN'), 'u-1')
    expect(generate).toHaveBeenLastCalledWith('Section\n(place: the garden)')
  })

  it('a neural profile embeds the anchored text unchanged', async () => {
    mockGetRepositories.mockReturnValue({ connections: { findApiKeyByIdAndUserId: jest.fn() } } as never)
    mockIsLocal.mockReturnValue(false)
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: false } } as never)
    const apiGenerate = jest.fn().mockResolvedValue({ embedding: [1, 0], model: 'm', dimensions: 2 })
    mockCreate.mockReturnValue({ generateEmbedding: apiGenerate } as never)

    const text = embeddingTextFor(memory, 'UTC')
    await generateEmbedding(text, profile('OLLAMA'), 'u-1', { lexicalText: lexicalEmbeddingTextFor(memory) })
    expect(apiGenerate.mock.calls[0][0]).toBe(text)
  })
})
