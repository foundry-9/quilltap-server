/**
 * Embedding Service
 *
 * Provides text embedding functionality using configured embedding profiles.
 * Delegates to provider plugins for actual embedding generation.
 * Supports OpenAI, Ollama, OpenRouter, and built-in TF-IDF providers with
 * fallback to text search heuristics when embedding is not available.
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { isLocalEmbeddingProvider } from '@quilltap/plugin-types'
import type { EmbeddingProfile, EmbeddingProfileProvider } from '@/lib/schemas/types'

/**
 * Result of an embedding operation.
 *
 * The embedding is always a unit vector (L2-normalised) so downstream cosine
 * similarity reduces to a single dot product. Stored as Float32Array for
 * compact memory and fast iteration.
 */
export interface EmbeddingResult {
  /** The embedding vector — unit-length Float32Array */
  embedding: Float32Array
  /** The model used */
  model: string
  /** Number of dimensions */
  dimensions: number
  /** Provider used */
  provider: EmbeddingProfileProvider
}

/**
 * Fallback search result when embedding is not available
 */
export interface FallbackSearchResult {
  /** Whether embedding was used */
  usedEmbedding: false
  /** Keywords extracted from the text */
  keywords: string[]
  /** Exact phrases found */
  exactPhrases: string[]
}

/**
 * Combined result type
 */
export type SearchPreparationResult =
  | { usedEmbedding: true; embedding: EmbeddingResult }
  | FallbackSearchResult

/**
 * Error thrown when embedding fails
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
    public readonly originalError?: Error
  ) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

/**
 * Get the default embedding profile for a user
 */
export async function getDefaultEmbeddingProfile(userId: string): Promise<EmbeddingProfile | null> {
  const repos = getRepositories()
  return repos.embeddingProfiles.findDefault(userId)
}

/**
 * Get an embedding profile by ID
 */
export async function getEmbeddingProfile(profileId: string): Promise<EmbeddingProfile | null> {
  const repos = getRepositories()
  return repos.embeddingProfiles.findById(profileId)
}

/**
 * Get the decrypted API key for an embedding profile
 */
async function getApiKeyForProfile(
  profile: EmbeddingProfile,
  userId: string
): Promise<string | null> {
  if (!profile.apiKeyId) return null

  const repos = getRepositories()
  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)

  if (!apiKey) return null

  return apiKey.key_value
}

/**
 * Generate an embedding using an API-based provider (OpenAI, Ollama, OpenRouter)
 */
async function generateApiEmbedding(
  text: string,
  profile: EmbeddingProfile,
  userId: string
): Promise<EmbeddingResult> {
  const providerName = profile.provider

  // Get the embedding provider from the registry
  const embeddingProvider = providerRegistry.createEmbeddingProvider(providerName, profile.baseUrl || undefined)

  // For API providers, we need an API key (except Ollama which doesn't require one)
  let apiKey = ''
  const plugin = providerRegistry.getProvider(providerName)

  if (plugin?.config.requiresApiKey) {
    const key = await getApiKeyForProfile(profile, userId)
    if (!key) {
      throw new EmbeddingError(`No API key found for ${providerName} embedding profile`, providerName)
    }
    apiKey = key
  }

  // This is an API-based provider
  if (isLocalEmbeddingProvider(embeddingProvider)) {
    throw new EmbeddingError(
      `Provider ${providerName} returned a local embedding provider but API provider was expected`,
      providerName
    )
  }

  const result = await embeddingProvider.generateEmbedding(
    text,
    profile.modelName,
    apiKey,
    { dimensions: profile.dimensions || undefined }
  )

  return {
    embedding: toUnitVector(result.embedding),
    model: result.model,
    dimensions: result.dimensions,
    provider: providerName,
  }
}

/**
 * Generate an embedding for text using the built-in TF-IDF provider
 */
async function generateBuiltinEmbedding(
  text: string,
  profile: EmbeddingProfile
): Promise<EmbeddingResult> {
  const repos = getRepositories()


  // Get the stored vocabulary for this profile
  const vocabulary = await repos.tfidfVocabularies.findByProfileId(profile.id)

  if (!vocabulary) {
    throw new EmbeddingError(
      'Built-in embedding profile not yet fitted. ' +
      'Please wait for the vocabulary to be built from your memories.',
      'BUILTIN'
    )
  }

  try {
    // Get the local embedding provider from the registry
    const embeddingProvider = providerRegistry.createEmbeddingProvider('BUILTIN')

    if (!isLocalEmbeddingProvider(embeddingProvider)) {
      throw new EmbeddingError(
        'BUILTIN provider did not return a local embedding provider',
        'BUILTIN'
      )
    }

    // Load the saved state
    embeddingProvider.loadState({
      vocabulary: JSON.parse(vocabulary.vocabulary),
      idf: JSON.parse(vocabulary.idf),
      avgDocLength: vocabulary.avgDocLength,
      vocabularySize: vocabulary.vocabularySize,
      includeBigrams: vocabulary.includeBigrams,
      fittedAt: vocabulary.fittedAt,
    })

    // Generate the embedding
    const result = embeddingProvider.generateEmbedding(text)


    return {
      embedding: toUnitVector(result.embedding),
      model: result.model,
      dimensions: result.dimensions,
      provider: 'BUILTIN',
    }
  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error
    }
    throw new EmbeddingError(
      `Built-in embedding failed: ${error instanceof Error ? error.message : String(error)}`,
      'BUILTIN',
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Generate an embedding for text using the specified profile
 */
export async function generateEmbedding(
  text: string,
  profile: EmbeddingProfile,
  userId: string
): Promise<EmbeddingResult> {
  try {
    // Built-in provider has special handling for vocabulary state
    if (profile.provider === 'BUILTIN') {
      return generateBuiltinEmbedding(text, profile)
    }

    // All other providers use the API-based flow
    return generateApiEmbedding(text, profile, userId)
  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error
    }
    throw new EmbeddingError(
      `Embedding failed for provider ${profile.provider}: ${error instanceof Error ? error.message : String(error)}`,
      profile.provider,
      error instanceof Error ? error : undefined
    )
  }
}

/**
 * Generate an embedding for text using the user's default profile
 */
export async function generateEmbeddingForUser(
  text: string,
  userId: string,
  profileId?: string
): Promise<EmbeddingResult> {
  let profile: EmbeddingProfile | null = null
  let profileSource = 'default'

  if (profileId) {
    profile = await getEmbeddingProfile(profileId)
    if (profile) {
      profileSource = 'explicit'
    }
  }

  if (!profile) {
    profile = await getDefaultEmbeddingProfile(userId)
    profileSource = profileId ? 'default (explicit not found)' : 'default'
  }

  if (!profile) {
    throw new EmbeddingError('No embedding profile configured')
  }

  logger.debug('[Embedding] Generating embedding for user', {
    context: 'embedding-service',
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
    dimensions: profile.dimensions,
    profileSource,
    textLength: text.length,
  })

  return generateEmbedding(text, profile, userId)
}

/**
 * Extract keywords and phrases from text for fallback search
 * This is used when embedding is not available
 */
export function extractSearchTerms(text: string): FallbackSearchResult {
  // Extract exact phrases (quoted strings)
  const phraseMatches = text.match(/"[^"]+"/g) || []
  const exactPhrases = phraseMatches.map(p => p.replace(/"/g, ''))

  // Remove quoted phrases from text for keyword extraction
  let cleanText = text
  for (const phrase of phraseMatches) {
    cleanText = cleanText.replace(phrase, '')
  }

  // Common stop words to filter out
  const stopWords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
    'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
    'am', 'been', 'being', 'here', 'there', 'when', 'where', 'why', 'how',
    'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'any', 'if', 'then', 'because', 'while', 'although', 'though', 'once',
  ])

  // Extract keywords (words longer than 2 chars, not stop words)
  const words = cleanText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))

  // Remove duplicates and sort by length (longer words often more meaningful)
  const keywords = [...new Set(words)].sort((a, b) => b.length - a.length)

  return {
    usedEmbedding: false,
    keywords,
    exactPhrases,
  }
}

/**
 * Prepare text for search - tries embedding first, falls back to text extraction
 */
export async function prepareForSearch(
  text: string,
  userId: string,
  profileId?: string
): Promise<SearchPreparationResult> {
  try {
    const embedding = await generateEmbeddingForUser(text, userId, profileId)
    return {
      usedEmbedding: true,
      embedding,
    }
  } catch (error) {
    // Log the error but don't throw - fall back to text search
    logger.warn('Embedding failed, falling back to text search', { context: 'embedding-service', error: error instanceof Error ? error.message : String(error) })
    return extractSearchTerms(text)
  }
}

/**
 * Normalise a vector in place to unit length (L2). If the vector is all zeros,
 * it is returned unchanged. Accepts either Float32Array or number[] input;
 * always returns Float32Array.
 *
 * All embeddings produced by `generateEmbeddingForUser` and stored by the
 * `normalize-embeddings-unit-vectors-v1` migration are unit vectors, which
 * lets `cosineSimilarity` skip norm computation.
 */
export function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i]
  }
  if (norm === 0) return v
  const inv = 1 / Math.sqrt(norm)
  for (let i = 0; i < v.length; i++) {
    v[i] = v[i] * inv
  }
  return v
}

/**
 * Convert an arbitrary embedding (number[] or Float32Array) to a fresh
 * unit-length Float32Array. Does not mutate the input.
 */
function toUnitVector(v: ArrayLike<number>): Float32Array {
  const out = v instanceof Float32Array ? new Float32Array(v) : new Float32Array(Array.from(v))
  return normalizeVector(out)
}

/**
 * Calculate cosine similarity between two embedding vectors.
 *
 * Assumes both inputs are unit-length (guaranteed by `generateEmbeddingForUser`
 * and the `normalize-embeddings-unit-vectors-v1` migration), so the result is
 * just the dot product. Accepts any ArrayLike<number>; Float32Array is
 * preferred for speed and memory.
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
  }

  return dotProduct
}

/**
 * Calculate text similarity score using keyword/phrase matching
 * Returns a score between 0 and 1
 */
export function textSimilarity(
  searchTerms: FallbackSearchResult,
  targetText: string
): number {
  const lowerTarget = targetText.toLowerCase()
  let score = 0
  let maxScore = 0

  // Exact phrase matches are worth more (3 points each)
  for (const phrase of searchTerms.exactPhrases) {
    maxScore += 3
    if (lowerTarget.includes(phrase.toLowerCase())) {
      score += 3
    }
  }

  // Keyword matches (1 point each, up to max of keyword count)
  const keywordMatches = searchTerms.keywords.filter(kw =>
    lowerTarget.includes(kw)
  ).length
  const keywordScore = Math.min(keywordMatches, searchTerms.keywords.length)
  score += keywordScore
  maxScore += searchTerms.keywords.length

  if (maxScore === 0) return 0
  return score / maxScore
}

/**
 * Check if embedding is available for a user
 */
export async function isEmbeddingAvailable(userId: string): Promise<boolean> {
  const profile = await getDefaultEmbeddingProfile(userId)
  return profile !== null
}

/**
 * Get all embedding profiles for a user
 */
export async function getUserEmbeddingProfiles(userId: string): Promise<EmbeddingProfile[]> {
  const repos = getRepositories()
  return repos.embeddingProfiles.findByUserId(userId)
}

/**
 * Invalidate all embeddings for a profile
 * Marks all embedding statuses as PENDING so they will be re-embedded
 *
 * @param userId The user ID
 * @param profileId The embedding profile ID
 * @returns Number of embeddings invalidated
 */
export async function invalidateAllEmbeddings(
  userId: string,
  profileId: string
): Promise<number> {
  const repos = getRepositories()

  logger.info('Invalidating all embeddings for profile', {
    context: 'embedding-service.invalidateAllEmbeddings',
    userId,
    profileId,
  })

  // Mark all embedding statuses as PENDING
  const invalidatedCount = await repos.embeddingStatus.markAllPendingByProfileId(profileId)

  logger.info('Embeddings invalidated', {
    context: 'embedding-service.invalidateAllEmbeddings',
    userId,
    profileId,
    invalidatedCount,
  })

  return invalidatedCount
}
