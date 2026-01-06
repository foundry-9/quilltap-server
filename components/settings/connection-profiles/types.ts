/**
 * Type definitions for connection profiles
 */

export interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

export interface Tag {
  id: string
  name: string
  createdAt?: string
}

export interface ProviderConfig {
  name: string
  displayName: string
  configRequirements: {
    requiresApiKey: boolean
    requiresBaseUrl: boolean
  }
  capabilities: {
    chat: boolean
    imageGeneration: boolean
    embeddings: boolean
    webSearch: boolean
  }
}

export interface ConnectionProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  isCheap?: boolean
  allowWebSearch?: boolean
  useNativeWebSearch?: boolean
  apiKey?: ApiKey | null
  tags?: Tag[]
  messageCount?: number
  totalTokens?: number
  totalPromptTokens?: number
  totalCompletionTokens?: number
}

export interface ProfileFormData {
  name: string
  provider: string
  apiKeyId: string
  baseUrl: string
  modelName: string
  temperature: number
  maxTokens: number
  topP: number
  isDefault: boolean
  isCheap: boolean
  allowWebSearch: boolean
  useNativeWebSearch: boolean
  // OpenRouter-specific fields
  fallbackModels: string[]
  enableZDR: boolean
  providerOrder: string[]
  useCustomModel: boolean
  // Anthropic-specific fields
  enableCacheBreakpoints: boolean
  cacheStrategy: 'system_only' | 'system_and_long_context'
  cacheTTL: '5m' | '1h'
}

export const initialFormState: ProfileFormData = {
  name: '',
  provider: 'OPENAI',
  apiKeyId: '',
  baseUrl: '',
  modelName: 'gpt-3.5-turbo',
  temperature: 1,
  maxTokens: 4096,
  topP: 1,
  isDefault: false,
  isCheap: false,
  allowWebSearch: false,
  useNativeWebSearch: false,
  // OpenRouter-specific fields
  fallbackModels: [],
  enableZDR: false,
  providerOrder: [],
  useCustomModel: false,
  // Anthropic-specific fields
  enableCacheBreakpoints: false,
  cacheStrategy: 'system_and_long_context',
  cacheTTL: '5m',
}
