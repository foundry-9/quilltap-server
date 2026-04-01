/**
 * API helper functions for the provider setup wizard.
 * All functions are typed wrappers around existing REST endpoints.
 */

import type { ProviderInfo } from './useProviderWizardState'

// ============================================================================
// Provider Discovery
// ============================================================================

/**
 * Fetch all available LLM providers from the registry.
 */
export async function fetchProviders(): Promise<ProviderInfo[]> {
  const res = await fetch('/api/v1/providers')
  if (!res.ok) throw new Error('Failed to fetch providers')
  const data = await res.json()
  // Only include LLM providers (type: 'llm'), not search providers
  return (data.providers || []).filter(
    (p: ProviderInfo & { type?: string }) => p.type === 'llm'
  )
}

// ============================================================================
// API Key Management
// ============================================================================

/**
 * Create (store) a new API key in the vault.
 * Returns the created key's ID.
 */
export async function createApiKey(
  provider: string,
  label: string,
  apiKey: string
): Promise<{ id: string }> {
  const res = await fetch('/api/v1/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, label, apiKey }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to create API key')
  }
  const data = await res.json()
  return { id: data.apiKey.id }
}

/**
 * Test a connection to validate an API key works with a provider.
 * Uses the test-connection action on connection-profiles.
 */
export async function testConnection(
  provider: string,
  apiKeyId: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  const res = await fetch('/api/v1/connection-profiles?action=test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKeyId, baseUrl }),
  })
  const data = await res.json()
  return { valid: data.valid === true, error: data.error }
}

// ============================================================================
// Model Discovery
// ============================================================================

/**
 * Fetch available chat models for a provider.
 */
export async function fetchModels(
  provider: string,
  apiKeyId?: string,
  baseUrl?: string
): Promise<string[]> {
  const res = await fetch('/api/v1/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKeyId, baseUrl }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to fetch models')
  }
  const data = await res.json()
  return data.models || []
}

/**
 * Fetch available embedding models, optionally filtered by provider.
 */
export async function fetchEmbeddingModels(
  provider?: string
): Promise<Array<{ id: string; name: string; dimensions: number; description: string }>> {
  const url = provider
    ? `/api/v1/embedding-profiles?action=list-models&provider=${encodeURIComponent(provider)}`
    : '/api/v1/embedding-profiles?action=list-models'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch embedding models')
  const data = await res.json()
  // If provider-filtered, data has { provider, models }
  // If all, data is Record<string, models[]>
  if (provider) return data.models || []
  // Flatten all providers
  const allModels: Array<{ id: string; name: string; dimensions: number; description: string }> = []
  for (const models of Object.values(data)) {
    if (Array.isArray(models)) allModels.push(...models)
  }
  return allModels
}

/**
 * Fetch available embedding providers.
 */
export async function fetchEmbeddingProviders(): Promise<string[]> {
  const res = await fetch('/api/v1/embedding-profiles?action=list-providers')
  if (!res.ok) throw new Error('Failed to fetch embedding providers')
  const data = await res.json()
  return data.providers || []
}

/**
 * Fetch available image providers with their default models.
 */
export async function fetchImageProviders(): Promise<
  Array<{ value: string; label: string; defaultModels: string[]; apiKeyProvider: string }>
> {
  const res = await fetch('/api/v1/image-profiles?action=list-providers')
  if (!res.ok) throw new Error('Failed to fetch image providers')
  const data = await res.json()
  return data.providers || []
}

/**
 * Fetch available image models for a provider.
 */
export async function fetchImageModels(
  provider: string,
  apiKeyId?: string
): Promise<string[]> {
  let url = `/api/v1/image-profiles?action=list-models&provider=${encodeURIComponent(provider)}`
  if (apiKeyId) url += `&apiKeyId=${encodeURIComponent(apiKeyId)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch image models')
  const data = await res.json()
  return data.models || data.supportedModels || []
}

// ============================================================================
// Profile Creation
// ============================================================================

/**
 * Create a connection profile for chat.
 */
export async function createConnectionProfile(params: {
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  isDefault?: boolean
  isCheap?: boolean
}): Promise<{ id: string }> {
  const res = await fetch('/api/v1/connection-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      provider: params.provider,
      apiKeyId: params.apiKeyId || null,
      baseUrl: params.baseUrl || null,
      modelName: params.modelName,
      isDefault: params.isDefault ?? false,
      isCheap: params.isCheap ?? false,
      parameters: {},
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to create connection profile')
  }
  const data = await res.json()
  return { id: data.profile.id }
}

/**
 * Create an embedding profile.
 */
export async function createEmbeddingProfile(params: {
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  dimensions?: number
  isDefault?: boolean
}): Promise<{ id: string }> {
  const res = await fetch('/api/v1/embedding-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      provider: params.provider,
      apiKeyId: params.apiKeyId || null,
      baseUrl: params.baseUrl || null,
      modelName: params.modelName,
      dimensions: params.dimensions || null,
      isDefault: params.isDefault ?? true,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to create embedding profile')
  }
  const data = await res.json()
  return { id: data.id }
}

/**
 * Create an image profile.
 */
export async function createImageProfile(params: {
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  isDefault?: boolean
}): Promise<{ id: string }> {
  const res = await fetch('/api/v1/image-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: params.name,
      provider: params.provider,
      apiKeyId: params.apiKeyId || null,
      baseUrl: params.baseUrl || null,
      modelName: params.modelName,
      parameters: {},
      isDefault: params.isDefault ?? true,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to create image profile')
  }
  const data = await res.json()
  return { id: data.id }
}

/**
 * Update chat settings (cheap LLM configuration).
 */
export async function updateChatSettings(cheapLLMSettings: {
  strategy: string
  profileId?: string
}): Promise<void> {
  const res = await fetch('/api/v1/settings/chat', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cheapLLMSettings }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to update chat settings')
  }
}

/**
 * Send a test message to verify a connection profile works end-to-end.
 */
export async function testMessage(params: {
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
}): Promise<{ success: boolean; message?: string; error?: string }> {
  const res = await fetch('/api/v1/connection-profiles?action=test-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: params.provider,
      apiKeyId: params.apiKeyId,
      baseUrl: params.baseUrl,
      modelName: params.modelName,
      parameters: { max_tokens: 50 },
    }),
  })
  const data = await res.json()
  return {
    success: data.success === true,
    message: data.message,
    error: data.error,
  }
}

// ============================================================================
// Load Existing Config (for settings re-entry mode)
// ============================================================================

/**
 * Load existing configuration for pre-populating wizard in settings mode.
 */
export async function loadExistingConfig(): Promise<{
  apiKeys: Array<{ id: string; provider: string; label: string; isActive: boolean }>
  connectionProfiles: Array<{
    id: string
    name: string
    provider: string
    apiKeyId: string | null
    baseUrl: string | null
    modelName: string
    isDefault: boolean
    isCheap: boolean
  }>
  embeddingProfiles: Array<{
    id: string
    name: string
    provider: string
    apiKeyId: string | null
    modelName: string
    dimensions: number | null
    isDefault: boolean
  }>
  imageProfiles: Array<{
    id: string
    name: string
    provider: string
    apiKeyId: string | null
    modelName: string
    isDefault: boolean
  }>
  chatSettings: { cheapLLMSettings?: { strategy?: string; profileId?: string } }
}> {
  const [keysRes, connRes, embRes, imgRes, settingsRes] = await Promise.all([
    fetch('/api/v1/api-keys'),
    fetch('/api/v1/connection-profiles'),
    fetch('/api/v1/embedding-profiles'),
    fetch('/api/v1/image-profiles'),
    fetch('/api/v1/settings/chat'),
  ])

  const [keysData, connData, embData, imgData, settingsData] = await Promise.all([
    keysRes.ok ? keysRes.json() : { apiKeys: [] },
    connRes.ok ? connRes.json() : { profiles: [] },
    embRes.ok ? embRes.json() : { profiles: [] },
    imgRes.ok ? imgRes.json() : { profiles: [] },
    settingsRes.ok ? settingsRes.json() : {},
  ])

  return {
    apiKeys: keysData.apiKeys || [],
    connectionProfiles: connData.profiles || [],
    embeddingProfiles: embData.profiles || [],
    imageProfiles: imgData.profiles || [],
    chatSettings: settingsData || {},
  }
}
