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
    baseUrlLabel?: string
    baseUrlDefault?: string
  }
  capabilities: {
    chat: boolean
    imageGeneration: boolean
    embeddings: boolean
    webSearch: boolean
    toolUse?: boolean
  }
}

export interface ConnectionProfile {
  id: string
  name: string
  /** Transport — 'api' (default) or 'courier' for manual / clipboard. */
  transport?: 'api' | 'courier'
  /** The Courier — delta-mode flag (default true). */
  courierDeltaMode?: boolean
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  isCheap?: boolean
  isDangerousCompatible?: boolean
  allowWebSearch?: boolean
  useNativeWebSearch?: boolean
  allowToolUse?: boolean
  supportsImageUpload?: boolean
  modelClass?: string | null
  maxContext?: number | null
  sortIndex?: number
  apiKey?: ApiKey | null
  tags?: Tag[]
  messageCount?: number
  totalTokens?: number
  totalPromptTokens?: number
  totalCompletionTokens?: number
}

export interface ProfileFormData {
  name: string
  /**
   * Transport. 'api' = standard plugin-dispatched API call. 'courier' = manual
   * clipboard transport: the assembled request is rendered as Markdown for the
   * user to carry by hand to an external LLM and paste back. When 'courier',
   * provider/apiKeyId/baseUrl are ignored, all tool/web-search flags are
   * forced off server-side, and `modelName` is free-form informational text.
   */
  transport: 'api' | 'courier'
  /**
   * The Courier — delta mode. When true (default), after a character's first
   * successful Courier turn in a chat, subsequent placeholders render only
   * the delta since the last paste instead of the full context. The Salon
   * bubble keeps a full-context fallback alongside the delta. Ignored when
   * `transport === 'api'`.
   */
  courierDeltaMode: boolean
  provider: string
  apiKeyId: string
  baseUrl: string
  modelName: string
  temperature: number
  maxTokens: number
  topP: number
  isDefault: boolean
  isCheap: boolean
  isDangerousCompatible: boolean
  allowToolUse: boolean
  supportsImageUpload: boolean
  allowWebSearch: boolean
  useNativeWebSearch: boolean
  modelClass: string
  maxContext: string
  // OpenRouter-specific fields
  fallbackModels: string[]
  enableZDR: boolean
  providerOrder: string[]
  useCustomModel: boolean
  // Anthropic-specific fields
  enableCacheBreakpoints: boolean
  cacheStrategy: 'system_only' | 'system_and_long_context'
  cacheTTL: '5m' | '1h'
  // OpenAI-specific fields. Empty string means "leave unset / use model default".
  verbosity: '' | 'low' | 'medium' | 'high'
  reasoningEffort: '' | 'minimal' | 'low' | 'medium' | 'high'
}

export const initialFormState: ProfileFormData = {
  name: '',
  transport: 'api',
  courierDeltaMode: true,
  provider: 'OPENAI',
  apiKeyId: '',
  baseUrl: '',
  modelName: 'gpt-3.5-turbo',
  temperature: 1,
  maxTokens: 4096,
  topP: 1,
  isDefault: false,
  isCheap: false,
  isDangerousCompatible: false,
  allowToolUse: true,
  supportsImageUpload: false,
  allowWebSearch: false,
  useNativeWebSearch: false,
  modelClass: '',
  maxContext: '',
  // OpenRouter-specific fields
  fallbackModels: [],
  enableZDR: false,
  providerOrder: [],
  useCustomModel: false,
  // Anthropic-specific fields
  enableCacheBreakpoints: false,
  cacheStrategy: 'system_and_long_context',
  cacheTTL: '5m',
  // OpenAI-specific fields
  verbosity: '',
  reasoningEffort: '',
}
