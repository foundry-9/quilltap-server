/**
 * The Built-in (TF-IDF) profile embeds a memory without its anchor line
 * (builtin-tfidf-memory-tuning §2); a neural profile embeds it unchanged.
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
import { embeddingTextFor, lexicalEmbeddingText } from '@/lib/memory/index-store'
import { isMemoryAnchorLine } from '@/lib/memory/episodic'
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

describe('lexicalEmbeddingText', () => {
  it('drops the anchor line embeddingTextFor appends', () => {
    const text = embeddingTextFor(memory, 'UTC')
    expect(text).toContain('(when: 2026-07-14')
    expect(lexicalEmbeddingText(text)).toBe(anchorFree)
  })

  it('leaves anchorless memory text, and arbitrary text, unchanged', () => {
    expect(lexicalEmbeddingText(anchorFree)).toBe(anchorFree)
    expect(lexicalEmbeddingText('one line')).toBe('one line')
    expect(lexicalEmbeddingText('a\n(an aside in parentheses)')).toBe('a\n(an aside in parentheses)')
  })

  it('recognises every part the anchor line can open with', () => {
    expect(isMemoryAnchorLine('(when: 2026-07-14)')).toBe(true)
    expect(isMemoryAnchorLine('(story time: dawn)')).toBe(true)
    expect(isMemoryAnchorLine('(place: Harbor Inn)')).toBe(true)
    expect(isMemoryAnchorLine('(where: Harbor Inn)')).toBe(false)
    expect(isMemoryAnchorLine('place: Harbor Inn')).toBe(false)
  })

  it('makes one fact told on two days identical to a lexical embedder', () => {
    const other = embeddingTextFor({ ...memory, occurredAt: '2026-08-02T12:00:00.000Z', entities: ['Harbor Inn'] }, 'UTC')
    const v = new TfIdfVectorizer(true)
    v.fitCorpus([
      embeddingTextFor(memory, 'UTC'),
      other,
      'Mara drinks Earl Grey\n\nMara orders Earl Grey with lemon.',
      'Bram keeps the lighthouse\n\nBram has kept the lighthouse for thirty years.',
    ])
    const cos = (a: string, b: string) => TfIdfVectorizer.cosineSimilarity(v.transform(a), v.transform(b))
    expect(cos(embeddingTextFor(memory, 'UTC'), other)).toBeLessThan(0.8)
    expect(cos(lexicalEmbeddingText(embeddingTextFor(memory, 'UTC')), lexicalEmbeddingText(other))).toBeCloseTo(1, 5)
  })
})

describe('generateEmbedding text shape by provider', () => {
  const generate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    generate.mockImplementation(() => ({ embedding: [1, 0], model: 'm', dimensions: 2 }))
  })

  it('BUILTIN embeds the memory without its anchor line', async () => {
    mockGetRepositories.mockReturnValue({
      tfidfVocabularies: {
        findByProfileId: jest.fn().mockResolvedValue({
          vocabulary: '[]', idf: '[]', avgDocLength: 1, vocabularySize: 0, includeBigrams: true, fittedAt: 'x',
        }),
      },
    } as never)
    mockIsLocal.mockReturnValue(true)
    mockCreate.mockReturnValue({ loadState: jest.fn(), generateEmbedding: generate } as never)

    await generateEmbedding(embeddingTextFor(memory, 'UTC'), profile('BUILTIN'), 'u-1')
    expect(generate).toHaveBeenCalledWith(anchorFree)
  })

  it('a neural profile embeds the anchored text unchanged', async () => {
    mockGetRepositories.mockReturnValue({ connections: { findApiKeyByIdAndUserId: jest.fn() } } as never)
    mockIsLocal.mockReturnValue(false)
    mockGetProvider.mockReturnValue({ config: { requiresApiKey: false } } as never)
    const apiGenerate = jest.fn().mockResolvedValue({ embedding: [1, 0], model: 'm', dimensions: 2 })
    mockCreate.mockReturnValue({ generateEmbedding: apiGenerate } as never)

    const text = embeddingTextFor(memory, 'UTC')
    await generateEmbedding(text, profile('OLLAMA'), 'u-1')
    expect(apiGenerate.mock.calls[0][0]).toBe(text)
  })
})
