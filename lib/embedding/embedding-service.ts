/**
 * Embedding Service
 *
 * Provides text embedding functionality using configured embedding profiles.
 * Supports OpenAI, Ollama, and OpenRouter providers with fallback to text search
 * heuristics when embedding is not available.
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import { EmbeddingProfile, EmbeddingProfileProvider } from '@/lib/schemas/types'

/**
 * Result of an embedding operation
 */
export interface EmbeddingResult {
  /** The embedding vector */
  embedding: number[]
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
 * Generate an embedding for text using OpenAI
 */
async function generateOpenAIEmbedding(
  text: string,
  profile: EmbeddingProfile,
  apiKey: string
): Promise<EmbeddingResult> {
  const baseUrl = profile.baseUrl || 'https://api.openai.com/v1'

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: profile.modelName,
      input: text,
      dimensions: profile.dimensions || undefined,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new EmbeddingError(
      `OpenAI embedding failed: ${error.error?.message || response.statusText}`,
      'OPENAI'
    )
  }

  const data = await response.json()
  const embedding = data.data[0].embedding

  return {
    embedding,
    model: profile.modelName,
    dimensions: embedding.length,
    provider: 'OPENAI',
  }
}

/**
 * Generate an embedding for text using Ollama
 */
async function generateOllamaEmbedding(
  text: string,
  profile: EmbeddingProfile
): Promise<EmbeddingResult> {
  const baseUrl = profile.baseUrl || 'http://localhost:11434'

  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: profile.modelName,
      prompt: text,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new EmbeddingError(
      `Ollama embedding failed: ${error.error || response.statusText}`,
      'OLLAMA'
    )
  }

  const data = await response.json()
  const embedding = data.embedding

  return {
    embedding,
    model: profile.modelName,
    dimensions: embedding.length,
    provider: 'OLLAMA',
  }
}

/**
 * Generate an embedding for text using OpenRouter
 * Uses the OpenRouter SDK for embeddings API access
 */
async function generateOpenRouterEmbedding(
  text: string,
  profile: EmbeddingProfile,
  apiKey: string
): Promise<EmbeddingResult> {
  // Dynamic import to avoid loading SDK unless needed
  const { OpenRouter } = await import('@openrouter/sdk')

  const client = new OpenRouter({
    apiKey,
    httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    xTitle: 'Quilltap',
  })

  logger.debug('Generating OpenRouter embedding', {
    context: 'embedding-service',
    model: profile.modelName,
    textLength: text.length,
  })

  const response = await client.embeddings.generate({
    input: text,
    model: profile.modelName,
    dimensions: profile.dimensions || undefined,
  })

  // Handle case where response is a string (error case)
  if (typeof response === 'string') {
    throw new EmbeddingError(`OpenRouter returned an error: ${response}`, 'OPENROUTER')
  }

  // Handle both float array and base64 encoded responses
  const embeddingData = response.data[0]?.embedding
  if (!embeddingData) {
    throw new EmbeddingError('No embedding returned from OpenRouter', 'OPENROUTER')
  }

  // If embedding is base64 encoded string, decode it
  let embedding: number[]
  if (typeof embeddingData === 'string') {
    // Base64 encoded float array - decode it
    const buffer = Buffer.from(embeddingData, 'base64')
    embedding = Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4))
  } else {
    embedding = embeddingData
  }

  logger.debug('OpenRouter embedding generated', {
    context: 'embedding-service',
    model: response.model,
    dimensions: embedding.length,
    usage: response.usage,
  })

  return {
    embedding,
    model: response.model,
    dimensions: embedding.length,
    provider: 'OPENROUTER',
  }
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

  // Import the decryption utility
  const { decryptApiKey } = await import('@/lib/encryption')
  return decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, userId)
}

/**
 * Generate an embedding for text using the specified profile
 */
export async function generateEmbedding(
  text: string,
  profile: EmbeddingProfile,
  userId: string
): Promise<EmbeddingResult> {
  if (profile.provider === 'OPENAI') {
    const apiKey = await getApiKeyForProfile(profile, userId)
    if (!apiKey) {
      throw new EmbeddingError('No API key found for OpenAI embedding profile', 'OPENAI')
    }
    return generateOpenAIEmbedding(text, profile, apiKey)
  }

  if (profile.provider === 'OLLAMA') {
    return generateOllamaEmbedding(text, profile)
  }

  if (profile.provider === 'OPENROUTER') {
    const apiKey = await getApiKeyForProfile(profile, userId)
    if (!apiKey) {
      throw new EmbeddingError('No API key found for OpenRouter embedding profile', 'OPENROUTER')
    }
    return generateOpenRouterEmbedding(text, profile, apiKey)
  }

  throw new EmbeddingError(`Unsupported embedding provider: ${profile.provider}`)
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

  if (profileId) {
    profile = await getEmbeddingProfile(profileId)
  }

  if (!profile) {
    profile = await getDefaultEmbeddingProfile(userId)
  }

  if (!profile) {
    throw new EmbeddingError('No embedding profile configured')
  }

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
 * Calculate cosine similarity between two embedding vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
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
