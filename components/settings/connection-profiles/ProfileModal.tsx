'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchJson } from '@/lib/fetch-helpers'
import { TagEditor } from '@/components/tags/tag-editor'
import { BaseModal } from '@/components/ui/BaseModal'
import { ModelSelector, type ModelInfo } from '../model-selector'
import { getAttachmentSupportDescription } from '@/lib/llm/attachment-support'
import { FormActions } from '@/components/ui/FormActions'
import { MODEL_CLASSES, getModelClass } from '@/lib/llm/model-classes'
import type { ApiKey, ProviderConfig, ProfileFormData, ConnectionProfile } from './types'

interface ProfileModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  profile?: ConnectionProfile | null
  apiKeys: ApiKey[]
  providers: ProviderConfig[]
  form: {
    formData: ProfileFormData
    setField: (name: keyof ProfileFormData, value: any) => void
    handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void
    resetForm: () => void
  }
  operations: {
    saveLoading: boolean
    connectLoading: boolean
    connectError: string | null
    fetchModelsLoading: boolean
    testMessageLoading: boolean
    autoConfigureLoading: boolean
    handleConnect: (callback: (data: any) => void) => Promise<any>
    handleFetchModels: (callback: (data: any) => void) => Promise<any>
    handleTestMessage: (callback: (data: any) => void) => Promise<any>
    handleAutoConfigure: (callback: (data: any) => void) => Promise<any>
    handleSubmit: (editingId: string | null, onSuccess: () => void) => Promise<any>
    getProviderRequirements: (provider: string) => any
  }
}

export function ProfileModal({
  isOpen,
  onClose,
  onSuccess,
  profile,
  apiKeys,
  providers,
  form,
  operations,
}: ProfileModalProps) {
  // Connection testing states
  const [isConnected, setIsConnected] = useState(false)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)

  // Fetch models states
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchedModelsWithInfo, setFetchedModelsWithInfo] = useState<ModelInfo[]>([])
  const [modelsMessage, setModelsMessage] = useState<string | null>(null)

  // Test message states
  const [testMessageResult, setTestMessageResult] = useState<string | null>(null)

  // Auto-configure states
  const [autoConfigureMessage, setAutoConfigureMessage] = useState<string | null>(null)

  // Note: No need for state reset effect - modal is keyed by profile.id so it remounts fresh

  // Auto-fetch models when editing
  useEffect(() => {
    if (isOpen && profile?.id) {
      const fetchModelsForEdit = async () => {
        try {
          const result = await fetchJson<any>('/api/v1/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: profile.provider,
              apiKeyId: profile.apiKeyId || undefined,
              baseUrl: profile.baseUrl || undefined,
            }),
          })
          if (result.ok) {
            setFetchedModels(result.data?.models || [])
            setFetchedModelsWithInfo(result.data?.modelsWithInfo || [])
            setModelsMessage(`Found ${result.data?.models?.length || 0} models`)
          }
        } catch {
          // Silently ignore
        }
      }
      fetchModelsForEdit()
    }
  }, [isOpen, profile?.id, profile?.provider, profile?.apiKeyId, profile?.baseUrl])

  const handleConnectClick = useCallback(async () => {
    const result = await operations.handleConnect((data) => {
      setIsConnected(true)
      setConnectionMessage(data.message || 'Connection successful!')
    })
    if (!result) {
      setIsConnected(false)
      setConnectionMessage(null)
    }
  }, [operations])

  const handleFetchModelsClick = useCallback(async () => {
    const result = await operations.handleFetchModels((data) => {
      setFetchedModels(data.models || [])
      setFetchedModelsWithInfo(data.modelsWithInfo || [])
      setModelsMessage(`Found ${data.models?.length || 0} models`)
    })
    if (!result) {
      setFetchedModels([])
      setModelsMessage(null)
    }
  }, [operations])

  const handleTestMessageClick = useCallback(async () => {
    const result = await operations.handleTestMessage((data) => {
      setTestMessageResult(data.message || 'Test message sent successfully!')
    })
    if (!result) {
      setTestMessageResult(null)
    }
  }, [operations])

  const handleAutoConfigureClick = useCallback(async () => {
    const result = await operations.handleAutoConfigure((data) => {
      form.setField('temperature', data.suggestions.temperature)
      form.setField('maxTokens', data.suggestions.maxTokens)
      form.setField('topP', data.suggestions.topP)
      form.setField('maxContext', String(data.suggestions.maxContext))
      form.setField('modelClass', data.suggestions.modelClass)
      form.setField('isDangerousCompatible', data.suggestions.isDangerousCompatible)
      setAutoConfigureMessage('Configuration applied successfully!')
    })
    if (!result) {
      setAutoConfigureMessage(null)
    }
  }, [operations, form])

  const handleFormSubmit = async () => {
    const result = await operations.handleSubmit(profile?.id || null, () => {
      onSuccess()
      onClose()
    })
    return result
  }

  const handleClose = () => {
    form.resetForm()
    onClose()
  }

  const getModelSuggestions = (provider: string): string[] => {
    const models: Record<string, string[]> = {
      OPENAI: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'],
      ANTHROPIC: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-1-20250805'],
      GOOGLE: ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest', 'gemini-1.0-pro', 'gemini-pro-vision'],
      GROK: ['grok-beta', 'grok-2', 'grok-vision-beta'],
      OLLAMA: ['llama2', 'neural-chat', 'mistral'],
      OPENROUTER: ['openai/gpt-4', 'anthropic/claude-2', 'meta-llama/llama-2-70b'],
      OPENAI_COMPATIBLE: ['gpt-3.5-turbo'],
    }
    return (models[provider] || ['gpt-3.5-turbo']).sort()
  }

  const getSelectedModelInfo = useCallback(() => {
    if (!form.formData.modelName || fetchedModelsWithInfo.length === 0) return null
    return fetchedModelsWithInfo.find((m) => m.id === form.formData.modelName) || null
  }, [form.formData.modelName, fetchedModelsWithInfo])

  const getMaxTokensLimit = useCallback(() => {
    const modelInfo = getSelectedModelInfo()
    return modelInfo?.maxOutputTokens || 128000
  }, [getSelectedModelInfo])

  const reqs = operations.getProviderRequirements(form.formData.provider)
  const isValid = form.formData.name.trim() && form.formData.modelName.trim()

  // Handle provider change - auto-fill base URL for providers that have defaults
  const handleProviderChange = (newProvider: string) => {
    form.setField('provider', newProvider)

    // Auto-fill base URL for providers with defaults
    const providerConfig = providers.find(p => p.name === newProvider)
    if (providerConfig?.configRequirements?.baseUrlDefault && !form.formData.baseUrl) {
      form.setField('baseUrl', providerConfig.configRequirements.baseUrlDefault)
    }

    // Auto-default allowToolUse based on provider capability (new profiles only)
    if (!profile?.id) {
      const supportsToolUse = providerConfig?.capabilities?.toolUse ?? false
      form.setField('allowToolUse', supportsToolUse)
    }
  }

  // Handle model change - auto-fill name if empty (new profile only)
  const handleModelChange = (modelName: string) => {
    form.setField('modelName', modelName)

    // Auto-fill name with PROVIDER/MODEL if name is empty and this is a new profile
    if (!profile?.id && !form.formData.name.trim() && modelName.trim()) {
      form.setField('name', `${form.formData.provider}/${modelName}`)
    }
  }

  const footer = (
    <FormActions
      onCancel={handleClose}
      onSubmit={handleFormSubmit}
      submitLabel={operations.saveLoading ? 'Saving...' : profile?.id ? 'Update Profile' : 'Create Profile'}
      isLoading={operations.saveLoading}
      isDisabled={!isValid}
    />
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title={profile?.id ? 'Edit Connection Profile' : 'Create Connection Profile'}
      maxWidth="3xl"
      footer={footer}
    >
      <div className="space-y-4">
            {/* Name and Provider Row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block qt-text-label mb-2">
                  Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={form.formData.name}
                  onChange={(e) => form.setField('name', e.target.value)}
                  placeholder="e.g., My GPT-4 Profile"
                  className="qt-input"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="provider" className="block qt-text-label mb-2">
                  Provider *
                </label>
                <select
                  id="provider"
                  name="provider"
                  value={form.formData.provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="qt-select"
                >
                  {providers.length > 0 ? (
                    providers
                      .filter((p) => p.capabilities?.chat)
                      .map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.displayName}
                        </option>
                      ))
                  ) : (
                    <>
                      <option value="OPENAI">OpenAI</option>
                      <option value="ANTHROPIC">Anthropic</option>
                      <option value="GOOGLE">Google</option>
                      <option value="GROK">Grok</option>
                      <option value="OLLAMA">Ollama</option>
                      <option value="OPENROUTER">OpenRouter</option>
                      <option value="OPENAI_COMPATIBLE">OpenAI Compatible</option>
                    </>
                  )}
                </select>
                <p className="qt-text-xs mt-1">
                  File attachments: {getAttachmentSupportDescription(form.formData.provider as any, form.formData.baseUrl || undefined)}
                </p>
              </div>
            </div>

            {/* API Key and Base URL Fields */}
            {(() => {
              const showApiKey = reqs.requiresApiKey
              const showBaseUrl = reqs.requiresBaseUrl
              const showBoth = showApiKey && showBaseUrl

              return (
                <div className={showBoth ? 'grid grid-cols-2 gap-4' : ''}>
                  {showApiKey && (
                    <div>
                      <label htmlFor="apiKeyId" className="block qt-text-label mb-2">
                        API Key *
                      </label>
                      <select
                        id="apiKeyId"
                        name="apiKeyId"
                        value={form.formData.apiKeyId}
                        onChange={(e) => form.setField('apiKeyId', e.target.value)}
                        className="qt-select"
                      >
                        <option value="">Select an API Key</option>
                        {(apiKeys || [])
                          .filter((key) => key.provider === form.formData.provider)
                          .map((key) => (
                            <option key={key.id} value={key.id}>
                              {key.label}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  {showBaseUrl && (
                    <div>
                      <label htmlFor="baseUrl" className="block qt-text-label mb-2">
                        Base URL *
                      </label>
                      <input
                        type="url"
                        id="baseUrl"
                        name="baseUrl"
                        value={form.formData.baseUrl}
                        onChange={(e) => form.setField('baseUrl', e.target.value)}
                        placeholder="http://localhost:11434"
                        className="qt-input"
                      />
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Connection Testing Section */}
            <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/50">
              <h4 className="font-medium text-sm mb-3">Connection Testing</h4>

              <div className="flex flex-wrap gap-3 mb-3">
                <button
                  type="button"
                  onClick={handleConnectClick}
                  disabled={operations.connectLoading}
                  className="qt-button-primary disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.connectLoading ? 'Connecting...' : 'Connect'}
                </button>

                <button
                  type="button"
                  onClick={handleFetchModelsClick}
                  disabled={(() => {
                    if (operations.fetchModelsLoading) return true
                    if (reqs.requiresBaseUrl && !form.formData.baseUrl) return true
                    if (reqs.requiresApiKey && !isConnected) return true
                    return false
                  })()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:qt-bg-primary/90 disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.fetchModelsLoading ? 'Fetching...' : 'Fetch Models'}
                </button>

                <button
                  type="button"
                  onClick={handleTestMessageClick}
                  disabled={!isConnected || operations.testMessageLoading || !form.formData.modelName}
                  className="qt-button-primary disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.testMessageLoading ? 'Testing...' : 'Test Message'}
                </button>

                <button
                  type="button"
                  onClick={handleAutoConfigureClick}
                  disabled={!form.formData.modelName || operations.autoConfigureLoading}
                  className="qt-button-primary disabled:qt-bg-muted disabled:qt-text-secondary disabled:cursor-not-allowed"
                >
                  {operations.autoConfigureLoading ? 'Auto-Configuring...' : 'Auto-Configure'}
                </button>
              </div>

              {/* Status messages */}
              {connectionMessage && (
                <div className="text-sm qt-alert-success">
                  ✓ {connectionMessage}
                </div>
              )}

              {operations.connectError && (
                <div className="text-sm qt-alert-destructive">
                  ✗ {operations.connectError}
                </div>
              )}

              {modelsMessage && (
                <div className="text-sm qt-alert-info">
                  ✓ {modelsMessage}
                </div>
              )}

              {testMessageResult && (
                <div className="text-sm qt-alert-info">
                  ✓ {testMessageResult}
                </div>
              )}

              {autoConfigureMessage && (
                <div className="text-sm qt-alert-success">
                  {autoConfigureMessage}
                </div>
              )}

              <p className="qt-text-xs mt-2">
                1. Click Connect to test the connection • 2. Fetch Models • 3. Test Message to verify
              </p>
            </div>

            {/* Model Selection */}
            <div>
              <label htmlFor="modelName" className="block qt-text-label mb-2">
                Model *
              </label>
              {form.formData.provider === 'OPENROUTER' && form.formData.useCustomModel ? (
                <>
                  <input
                    type="text"
                    id="modelName"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={(e) => handleModelChange(e.target.value)}
                    placeholder="e.g., openai/gpt-4-turbo"
                    list="modelSuggestions"
                    className="qt-input"
                  />
                  <datalist id="modelSuggestions">
                    {fetchedModels.length > 0
                      ? fetchedModels.map((model) => <option key={model} value={model} />)
                      : getModelSuggestions(form.formData.provider).map((model) => (
                          <option key={model} value={model} />
                        ))}
                  </datalist>
                </>
              ) : fetchedModels.length > 0 ? (
                <ModelSelector
                  models={fetchedModels}
                  modelsWithInfo={fetchedModelsWithInfo}
                  value={form.formData.modelName}
                  onChange={handleModelChange}
                  placeholder="Select or search a model"
                  required
                  showFetchedCount
                />
              ) : (
                <>
                  <input
                    type="text"
                    id="modelName"
                    name="modelName"
                    value={form.formData.modelName}
                    onChange={(e) => handleModelChange(e.target.value)}
                    placeholder="e.g., gpt-4"
                    list="modelSuggestions"
                    className="qt-input"
                  />
                  <datalist id="modelSuggestions">
                    {getModelSuggestions(form.formData.provider).map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </>
              )}
            </div>

            {/* Model Parameters */}
            <div className="border-t qt-border-default pt-4">
              <h4 className="font-medium text-sm mb-3">Model Parameters (Optional)</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label htmlFor="temperature" className="block qt-text-label mb-2">
                    Temperature ({form.formData.temperature})
                  </label>
                  <input
                    type="range"
                    id="temperature"
                    min="0"
                    max="2"
                    step="0.1"
                    value={form.formData.temperature}
                    onChange={(e) => form.setField('temperature', parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="qt-text-xs mt-1">0 = deterministic, 2 = creative</p>
                </div>

                <div>
                  <label htmlFor="maxTokens" className="block qt-text-label mb-2">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    id="maxTokens"
                    value={form.formData.maxTokens}
                    onChange={(e) => form.setField('maxTokens', parseInt(e.target.value))}
                    min="1"
                    max={getMaxTokensLimit()}
                    className="qt-input"
                  />
                  <p className="qt-text-xs mt-1">
                    {getSelectedModelInfo()?.maxOutputTokens
                      ? `Reported model limit: ${getSelectedModelInfo()?.maxOutputTokens?.toLocaleString()}`
                      : 'Max output tokens'}
                  </p>
                </div>

                <div>
                  <label htmlFor="topP" className="block qt-text-label mb-2">
                    Top P ({form.formData.topP})
                  </label>
                  <input
                    type="range"
                    id="topP"
                    min="0"
                    max="1"
                    step="0.05"
                    value={form.formData.topP}
                    onChange={(e) => form.setField('topP', parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="qt-text-xs mt-1">Nucleus sampling (0-1)</p>
                </div>
              </div>
            </div>

            {/* Checkboxes */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={form.formData.isDefault}
                  onChange={(e) => form.setField('isDefault', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="isDefault" className="text-sm">
                  Set as default profile
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isCheap"
                  checked={form.formData.isCheap}
                  onChange={(e) => form.setField('isCheap', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="isCheap" className="text-sm">
                  Mark as cheap LLM (for cost-effective tasks)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDangerousCompatible"
                  checked={form.formData.isDangerousCompatible}
                  onChange={(e) => form.setField('isDangerousCompatible', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="isDangerousCompatible" className="text-sm">
                  Uncensored-compatible (suitable for dangerous/sensitive content routing)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowToolUse"
                  checked={form.formData.allowToolUse}
                  onChange={(e) => form.setField('allowToolUse', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="allowToolUse" className="text-sm">
                  Allow tool use (overrides chat and project tool settings when disabled)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowWebSearch"
                  checked={form.formData.allowWebSearch}
                  onChange={(e) => form.setField('allowWebSearch', e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="allowWebSearch" className="text-sm">
                  Allow web search tool
                </label>
              </div>
              {reqs.supportsWebSearch && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useNativeWebSearch"
                    checked={form.formData.useNativeWebSearch}
                    onChange={(e) => form.setField('useNativeWebSearch', e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  <label htmlFor="useNativeWebSearch" className="text-sm">
                    Use provider native web search
                  </label>
                </div>
              )}
            </div>

            {/* Model Class and Max Context */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="modelClass" className="block qt-text-label mb-2">
                  Model Class
                </label>
                <select
                  id="modelClass"
                  name="modelClass"
                  value={form.formData.modelClass}
                  onChange={(e) => form.setField('modelClass', e.target.value)}
                  className="qt-select"
                >
                  <option value="">(None)</option>
                  {MODEL_CLASSES.map((mc) => (
                    <option key={mc.name} value={mc.name}>
                      {mc.name} (Tier {mc.tier})
                    </option>
                  ))}
                </select>
                {form.formData.modelClass && (() => {
                  const mc = getModelClass(form.formData.modelClass)
                  if (!mc) return null
                  return (
                    <p className="qt-text-xs mt-1">
                      Context: {mc.maxContext.toLocaleString()} | Output: {mc.maxOutput.toLocaleString()} | Quality: {mc.quality} | Tags: {mc.tags.join(', ')}
                    </p>
                  )
                })()}
              </div>
              <div>
                <label htmlFor="maxContext" className="block qt-text-label mb-2">
                  Max Context (tokens)
                </label>
                <input
                  type="number"
                  id="maxContext"
                  name="maxContext"
                  value={form.formData.maxContext}
                  onChange={(e) => form.setField('maxContext', e.target.value)}
                  placeholder="e.g., 128000"
                  min="1"
                  className="qt-input"
                />
                <p className="qt-text-xs mt-1">
                  Override context window size. Leave blank to use provider default.
                </p>
              </div>
            </div>

            {/* OpenRouter-specific options */}
            {form.formData.provider === 'OPENROUTER' && (
              <OpenRouterOptions formData={form.formData} fetchedModels={fetchedModels} onSetField={form.setField} />
            )}

            {/* Anthropic-specific options */}
            {form.formData.provider === 'ANTHROPIC' && (
              <AnthropicOptions formData={form.formData} onSetField={form.setField} />
            )}

            {/* Tag Editor (only show when editing) */}
            {profile?.id && (
              <div className="pt-4">
                <TagEditor entityType="profile" entityId={profile.id} />
              </div>
            )}
      </div>
    </BaseModal>
  )
}

/**
 * OpenRouter-specific options component
 */
function OpenRouterOptions({
  formData,
  fetchedModels,
  onSetField,
}: {
  formData: ProfileFormData
  fetchedModels: string[]
  onSetField: (name: keyof ProfileFormData, value: any) => void
}) {
  return (
    <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/50">
      <h4 className="font-medium text-sm mb-3">OpenRouter Options</h4>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="checkbox"
          id="enableZDR"
          checked={formData.enableZDR}
          onChange={(e) => onSetField('enableZDR', e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="enableZDR" className="text-sm">
            Enable Zero Data Retention (ZDR)
          </label>
          <p className="qt-text-xs">
            Providers will not store or log your prompts and responses.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          type="checkbox"
          id="useCustomModel"
          checked={formData.useCustomModel}
          onChange={(e) => onSetField('useCustomModel', e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="useCustomModel" className="text-sm">
            Use Custom Model ID
          </label>
          <p className="qt-text-xs">
            Enter an arbitrary model ID not in the fetched list.
          </p>
        </div>
      </div>

      {fetchedModels.length > 0 && (
        <div className="mb-4">
          <label className="block qt-text-label mb-2">Fallback Models (max 2)</label>
          <div className="space-y-1 max-h-32 overflow-y-auto border qt-border-default rounded p-2 bg-background">
            {fetchedModels
              .filter((model) => model !== formData.modelName)
              .slice(0, 50)
              .map((model) => {
                const isSelected = formData.fallbackModels.includes(model)
                const isDisabled = !isSelected && formData.fallbackModels.length >= 2
                return (
                  <label
                    key={model}
                    className={`flex items-center gap-2 p-1 rounded ${
                      isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:qt-bg-muted'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={(e) => {
                        if (e.target.checked && formData.fallbackModels.length < 2) {
                          onSetField('fallbackModels', [...formData.fallbackModels, model])
                        } else if (!e.target.checked) {
                          onSetField('fallbackModels', formData.fallbackModels.filter((m) => m !== model))
                        }
                      }}
                      className="w-3 h-3 rounded"
                    />
                    <span className="qt-text-xs text-foreground truncate">{model}</span>
                  </label>
                )
              })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Anthropic-specific options component
 */
function AnthropicOptions({
  formData,
  onSetField,
}: {
  formData: ProfileFormData
  onSetField: (name: keyof ProfileFormData, value: any) => void
}) {
  return (
    <div className="border qt-border-default rounded-lg p-4 qt-bg-muted/50">
      <h4 className="font-medium text-sm mb-3">Anthropic Options</h4>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="checkbox"
          id="enableCacheBreakpoints"
          checked={formData.enableCacheBreakpoints}
          onChange={(e) => onSetField('enableCacheBreakpoints', e.target.checked)}
          className="w-4 h-4 rounded"
        />
        <label htmlFor="enableCacheBreakpoints" className="text-sm">
          Enable Prompt Caching
        </label>
      </div>
      {formData.enableCacheBreakpoints && (
        <div className="space-y-3 pl-6 mb-3">
          <div className="space-y-2">
            <p className="qt-text-label-xs">Cache Strategy</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="cacheStrategy"
                value="system_only"
                checked={formData.cacheStrategy === 'system_only'}
                onChange={(e) => onSetField('cacheStrategy', e.target.value as any)}
                className="w-3 h-3"
              />
              <span className="text-sm">System message only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="cacheStrategy"
                value="system_and_long_context"
                checked={formData.cacheStrategy === 'system_and_long_context'}
                onChange={(e) => onSetField('cacheStrategy', e.target.value as any)}
                className="w-3 h-3"
              />
              <span className="text-sm">System + tools + conversation (recommended)</span>
            </label>
          </div>

          <div className="space-y-2">
            <label htmlFor="cacheTTL" className="qt-text-label-xs">
              Cache Duration
            </label>
            <select
              id="cacheTTL"
              value={formData.cacheTTL}
              onChange={(e) => onSetField('cacheTTL', e.target.value as '5m' | '1h')}
              className="qt-select text-sm"
            >
              <option value="5m">5 minutes (1.25x write cost)</option>
              <option value="1h">1 hour (2x write cost)</option>
            </select>
          </div>
        </div>
      )}
      <p className="qt-text-xs">
        Prompt caching can reduce costs by up to 90% for repeated context.
      </p>
    </div>
  )
}

export default ProfileModal
