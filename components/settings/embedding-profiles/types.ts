/**
 * Type definitions for embedding profiles
 */

export type EmbeddingProvider = 'OPENAI' | 'OLLAMA' | 'OPENROUTER' | 'BUILTIN'

export interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

export interface EmbeddingModel {
  id: string
  name: string
  dimensions: number
  description: string
}

/**
 * Vocabulary stats for BUILTIN TF-IDF profiles
 */
export interface VocabularyStats {
  vocabularySize: number
  avgDocLength: number
  includeBigrams: boolean
  fittedAt: string
}

/**
 * Embedding status stats for a profile
 */
export interface EmbeddingStatusStats {
  pending: number
  embedded: number
  failed: number
  total: number
}

export interface EmbeddingProfile {
  id: string
  name: string
  provider: EmbeddingProvider
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  dimensions?: number
  isDefault: boolean
  apiKey?: ApiKey | null
  /** Vocabulary stats for BUILTIN profiles */
  vocabularyStats?: VocabularyStats | null
  /** Embedding status stats */
  embeddingStats?: EmbeddingStatusStats | null
}

export interface EmbeddingProfileFormData {
  name: string
  provider: EmbeddingProvider
  apiKeyId: string
  baseUrl: string
  modelName: string
  dimensions: string
  isDefault: boolean
}

/**
 * Map provider names to qt-badge-provider-* CSS classes
 */
export const PROVIDER_BADGE_CLASSES: Record<string, string> = {
  OPENAI: 'qt-badge-provider-openai',
  OLLAMA: 'qt-badge-provider-ollama',
  OPENROUTER: 'qt-badge-provider-openrouter',
  BUILTIN: 'qt-badge-provider-builtin',
}

/**
 * @deprecated Use PROVIDER_BADGE_CLASSES instead
 */
export const PROVIDER_COLORS = PROVIDER_BADGE_CLASSES
