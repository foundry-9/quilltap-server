/**
 * Type definitions for embedding profiles
 */

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

export interface EmbeddingProfile {
  id: string
  name: string
  provider: 'OPENAI' | 'OLLAMA'
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  dimensions?: number
  isDefault: boolean
  apiKey?: ApiKey | null
}

export interface EmbeddingProfileFormData {
  name: string
  provider: 'OPENAI' | 'OLLAMA'
  apiKeyId: string
  baseUrl: string
  modelName: string
  dimensions: string
  isDefault: boolean
}

export const PROVIDER_COLORS: Record<string, string> = {
  OPENAI: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  OLLAMA: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
}
