'use client'

import { useEffect } from 'react'
import { TagEditor } from '@/components/tags/tag-editor'
import { ModelSelector, type ModelInfo } from '../model-selector'
import { getAttachmentSupportDescription } from '@/lib/llm/attachment-support'
import type { ApiKey, ProviderConfig, ProfileFormData } from './types'

interface ProfileFormProps {
  editingId: string | null
  formData: ProfileFormData
  onFormChange: (name: string, value: any) => void
  onFormSetField: (name: string, value: any) => void
  apiKeys: ApiKey[]
  providers: ProviderConfig[]
  fetchedModels: string[]
  fetchedModelsWithInfo: ModelInfo[]
  connectionMessage: string | null
  modelsMessage: string | null
  testMessageResult: string | null
  isConnected: boolean
  isConnecting: boolean
  isFetchingModels: boolean
  isTestingMessage: boolean
  isSaving: boolean
  onConnect: () => void
  onFetchModels: () => void
  onTestMessage: () => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  getProviderRequirements: (provider: string) => any
  getSelectedModelInfo: () => ModelInfo | null
  getMaxTokensLimit: () => number
  getModelSuggestions: (provider: string) => string[]
}

/**
 * Form component for creating/editing connection profiles
 * Handles all form fields and provider-specific options
 */
export function ProfileForm({
  editingId,
  formData,
  onFormChange,
  onFormSetField,
  apiKeys,
  providers,
  fetchedModels,
  fetchedModelsWithInfo,
  connectionMessage,
  modelsMessage,
  testMessageResult,
  isConnected,
  isConnecting,
  isFetchingModels,
  isTestingMessage,
  isSaving,
  onConnect,
  onFetchModels,
  onTestMessage,
  onSubmit,
  onCancel,
  getProviderRequirements,
  getSelectedModelInfo,
  getMaxTokensLimit,
  getModelSuggestions,
}: ProfileFormProps) {
  useEffect(() => {
    // Scroll form into view when component mounts
    const formElement = document.getElementById('profile-form')
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  return (
    <div id="profile-form" className="bg-muted border border-border rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">
        {editingId ? 'Edit Connection Profile' : 'Add New Connection Profile'}
      </h3>
      <form onSubmit={onSubmit} className="space-y-4">
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
              value={formData.name}
              onChange={(e) => onFormChange('name', e.target.value)}
              placeholder="e.g., My GPT-4 Profile"
              required
              className="qt-input"
            />
          </div>

          <div>
            <label htmlFor="provider" className="block qt-text-label mb-2">
              Provider *
            </label>
            <select
              id="provider"
              name="provider"
              value={formData.provider}
              onChange={(e) => onFormChange('provider', e.target.value)}
              className="qt-select"
            >
              {providers.length > 0 ? (
                providers
                  .filter((p) => p.capabilities.chat)
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
              File attachments: {getAttachmentSupportDescription(formData.provider as any, formData.baseUrl || undefined)}
            </p>
          </div>
        </div>

        {/* API Key and Base URL Fields */}
        {(() => {
          const reqs = getProviderRequirements(formData.provider)
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
                    value={formData.apiKeyId}
                    onChange={(e) => onFormChange('apiKeyId', e.target.value)}
                    className="qt-select"
                  >
                    <option value="">Select an API Key</option>
                    {apiKeys
                      .filter((key) => key.provider === formData.provider)
                      .map((key) => (
                        <option key={key.id} value={key.id}>
                          {key.label}
                        </option>
                      ))}
                  </select>
                  <p className="qt-text-xs mt-1">Required for this provider</p>
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
                    value={formData.baseUrl}
                    onChange={(e) => onFormChange('baseUrl', e.target.value)}
                    placeholder="http://localhost:11434"
                    className="qt-input"
                  />
                  <p className="qt-text-xs mt-1">Required for this provider</p>
                </div>
              )}
            </div>
          )
        })()}

        {/* Connection Testing Section */}
        <div className="border border-border rounded-lg p-4 bg-muted/50">
          <h4 className="font-medium text-sm mb-3">Connection Testing</h4>

          <div className="flex flex-wrap gap-3 mb-3">
            <button
              type="button"
              onClick={onConnect}
              disabled={isConnecting}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>

            <button
              type="button"
              onClick={onFetchModels}
              disabled={(() => {
                const reqs = getProviderRequirements(formData.provider)
                if (isFetchingModels) return true
                // For providers that need baseUrl, require it
                if (reqs.requiresBaseUrl && !formData.baseUrl) return true
                // For providers that need API key and aren't connected yet, require connection
                if (reqs.requiresApiKey && !isConnected) return true
                return false
              })()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              {isFetchingModels ? 'Fetching...' : 'Fetch Models'}
            </button>

            <button
              type="button"
              onClick={onTestMessage}
              disabled={!isConnected || isTestingMessage || !formData.modelName}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
            >
              {isTestingMessage ? 'Testing...' : 'Test Message'}
            </button>
          </div>

          {/* Status messages */}
          {connectionMessage && (
            <div className="text-sm text-green-700 bg-green-50/50 border border-green-200/70 rounded px-3 py-2 mb-2">
              ✓ {connectionMessage}
            </div>
          )}

          {modelsMessage && (
            <div className="text-sm text-blue-700 bg-blue-50/50 border border-blue-200/70 rounded px-3 py-2 mb-2">
              ✓ {modelsMessage}
            </div>
          )}

          {testMessageResult && (
            <div className="text-sm text-purple-700 bg-purple-50/50 border border-purple-200/70 rounded px-3 py-2 mb-2">
              ✓ {testMessageResult}
            </div>
          )}

          <p className="qt-text-xs mt-2">
            1. Click Connect to test the connection • 2. Fetch Models (enabled after connection) • 3. Test
            Message to verify API functionality
          </p>
        </div>

        {/* Model Selection */}
        <div>
          <label htmlFor="modelName" className="block qt-text-label mb-2">
            Model *
          </label>
          {/* Show text input for custom model (OpenRouter only) or when models haven't been fetched */}
          {formData.provider === 'OPENROUTER' && formData.useCustomModel ? (
            <>
              <input
                type="text"
                id="modelName"
                name="modelName"
                value={formData.modelName}
                onChange={(e) => onFormChange('modelName', e.target.value)}
                placeholder="e.g., openai/gpt-4-turbo or anthropic/claude-3-opus"
                list="modelSuggestions"
                required
                className="qt-input"
              />
              <datalist id="modelSuggestions">
                {fetchedModels.length > 0 ? (
                  fetchedModels.map((model) => (
                    <option key={model} value={model} />
                  ))
                ) : (
                  getModelSuggestions(formData.provider).map((model) => (
                    <option key={model} value={model} />
                  ))
                )}
              </datalist>
              <p className="qt-text-xs mt-1">
                Enter any OpenRouter model ID. Use &quot;Test Message&quot; to verify.
              </p>
            </>
          ) : fetchedModels.length > 0 ? (
            <ModelSelector
              models={fetchedModels}
              modelsWithInfo={fetchedModelsWithInfo}
              value={formData.modelName}
              onChange={(value) => onFormSetField('modelName', value)}
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
                value={formData.modelName}
                onChange={(e) => onFormChange('modelName', e.target.value)}
                placeholder="e.g., gpt-4"
                list="modelSuggestions"
                required
                className="qt-input"
              />
              <datalist id="modelSuggestions">
                {getModelSuggestions(formData.provider).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </>
          )}
        </div>

        {/* Model Parameters */}
        <div className="border-t border-border pt-4">
          <h4 className="font-medium text-sm mb-3">Model Parameters (Optional)</h4>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="temperature" className="block qt-text-label mb-2">
                Temperature ({formData.temperature})
              </label>
              <input
                type="range"
                id="temperature"
                name="temperature"
                min="0"
                max="2"
                step="0.1"
                value={formData.temperature}
                onChange={(e) => onFormChange('temperature', parseFloat(e.target.value))}
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
                name="maxTokens"
                value={formData.maxTokens}
                onChange={(e) => onFormChange('maxTokens', parseInt(e.target.value))}
                min="1"
                max={getMaxTokensLimit()}
                className="qt-input"
              />
              <p className="qt-text-xs mt-1">
                {getSelectedModelInfo()?.maxOutputTokens
                  ? `Model limit: ${getSelectedModelInfo()?.maxOutputTokens?.toLocaleString()} tokens`
                  : 'Max output tokens for responses'}
              </p>
            </div>

            <div>
              <label htmlFor="topP" className="block qt-text-label mb-2">
                Top P ({formData.topP})
              </label>
              <input
                type="range"
                id="topP"
                name="topP"
                min="0"
                max="1"
                step="0.05"
                value={formData.topP}
                onChange={(e) => onFormChange('topP', parseFloat(e.target.value))}
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
              name="isDefault"
              checked={formData.isDefault}
              onChange={(e) => onFormChange('isDefault', e.target.checked)}
              className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
            />
            <label htmlFor="isDefault" className="text-sm">
              Set as default profile
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isCheap"
              name="isCheap"
              checked={formData.isCheap}
              onChange={(e) => onFormChange('isCheap', e.target.checked)}
              className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
            />
            <label htmlFor="isCheap" className="text-sm">
              Mark as cheap LLM (suitable for cost-effective tasks like memory extraction)
            </label>
          </div>
          {(() => {
            const supportsWebSearch = getProviderRequirements(formData.provider).supportsWebSearch
            return (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowWebSearch"
                  name="allowWebSearch"
                  checked={formData.allowWebSearch}
                  onChange={(e) => onFormChange('allowWebSearch', e.target.checked)}
                  disabled={!supportsWebSearch}
                  className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="allowWebSearch"
                    className={`text-sm ${supportsWebSearch ? '' : 'text-muted-foreground'}`}
                  >
                    Allow Web Search
                  </label>
                  {supportsWebSearch ? (
                    <p className="qt-text-xs">
                      Enable the LLM to search the web for real-time information when responding to queries
                    </p>
                  ) : (
                    <p className="qt-text-xs">
                      This provider does not support web search
                    </p>
                  )}
                </div>
              </div>
            )
          })()}
        </div>

        {/* OpenRouter-specific options */}
        {formData.provider === 'OPENROUTER' && (
          <OpenRouterOptions formData={formData} fetchedModels={fetchedModels} onSetField={onFormSetField} />
        )}

        {/* Anthropic-specific options */}
        {formData.provider === 'ANTHROPIC' && (
          <AnthropicOptions formData={formData} onSetField={onFormSetField} />
        )}

        {/* Tag Editor (only show when editing existing profile) */}
        {editingId && (
          <div className="pt-4">
            <TagEditor entityType="profile" entityId={editingId} />
          </div>
        )}

        {/* Form Actions */}
        <div className="flex gap-3 pt-4 border-t border-border">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
          >
            {isSaving ? 'Saving...' : editingId ? 'Update Profile' : 'Create Profile'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 bg-muted text-foreground rounded-lg hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
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
  onSetField: (name: string, value: any) => void
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-muted/50">
      <h4 className="font-medium text-sm mb-3">OpenRouter Options</h4>

      {/* ZDR Toggle */}
      <div className="flex items-center gap-2 mb-4">
        <input
          type="checkbox"
          id="enableZDR"
          checked={formData.enableZDR}
          onChange={(e) => onSetField('enableZDR', e.target.checked)}
          className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="enableZDR" className="text-sm">
            Enable Zero Data Retention (ZDR)
          </label>
          <p className="qt-text-xs">
            When enabled, providers will not store or log your prompts and responses. May limit available providers.
          </p>
        </div>
      </div>

      {/* Custom Model Toggle */}
      <div className="flex items-center gap-2 mb-4">
        <input
          type="checkbox"
          id="useCustomModel"
          checked={formData.useCustomModel}
          onChange={(e) => onSetField('useCustomModel', e.target.checked)}
          className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="useCustomModel" className="text-sm">
            Use Custom Model ID
          </label>
          <p className="qt-text-xs">
            Enable this to enter an arbitrary model ID not in the fetched list. Use the &quot;Test Message&quot; button to
            verify the model works.
          </p>
        </div>
      </div>

      {/* Fallback Models */}
      {fetchedModels.length > 0 && (
        <div className="mb-4">
          <label className="block qt-text-label mb-2">Fallback Models (Optional, max 2)</label>
          <p className="qt-text-xs mb-2">
            If the primary model fails or is unavailable, OpenRouter will try these models in order. OpenRouter
            supports up to 3 total models (1 primary + 2 fallbacks).
          </p>
          {formData.fallbackModels.length >= 2 && (
            <p className="qt-text-xs text-amber-600 dark:text-amber-400 mb-2">
              Maximum fallback models reached. Remove one to add a different model.
            </p>
          )}
          <div className="space-y-1 max-h-32 overflow-y-auto border border-border rounded p-2 bg-background">
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
                      isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-muted'
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
                          onSetField(
                            'fallbackModels',
                            formData.fallbackModels.filter((m) => m !== model)
                          )
                        }
                      }}
                      className="w-3 h-3 rounded"
                    />
                    <span className="qt-text-xs text-foreground truncate">{model}</span>
                  </label>
                )
              })}
          </div>
          {formData.fallbackModels.length > 0 && (
            <div className="mt-2">
              <p className="qt-text-xs mb-1">Selected fallbacks ({formData.fallbackModels.length}/2):</p>
              <div className="flex flex-wrap gap-1">
                {formData.fallbackModels.map((model, idx) => (
                  <span
                    key={model}
                    className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded flex items-center gap-1"
                  >
                    {idx + 1}. {model.split('/').pop()}
                    <button
                      type="button"
                      onClick={() =>
                        onSetField(
                          'fallbackModels',
                          formData.fallbackModels.filter((m) => m !== model)
                        )
                      }
                      className="hover:text-destructive ml-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Provider Order */}
      <div>
        <label className="block qt-text-label mb-2">Provider Order (Optional)</label>
        <p className="qt-text-xs mb-2">
          Specify which infrastructure providers to prefer when routing requests.
        </p>
        <div className="grid grid-cols-3 gap-1 mb-2">
          {['OpenAI', 'Anthropic', 'Google', 'Azure', 'AWS Bedrock', 'Together', 'Fireworks', 'DeepInfra', 'Cloudflare', 'Lepton']
            .filter((p) => !formData.providerOrder.includes(p))
            .map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => onSetField('providerOrder', [...formData.providerOrder, provider])}
                className="px-2 py-1 text-xs bg-muted text-foreground rounded hover:bg-accent text-left truncate"
              >
                + {provider}
              </button>
            ))}
        </div>
        {formData.providerOrder.length > 0 && (
          <div className="space-y-1 border border-border rounded p-2 bg-background">
            <p className="qt-text-label-xs mb-1">Priority order:</p>
            {formData.providerOrder.map((provider, idx) => (
              <div key={provider} className="flex items-center gap-2 bg-primary/5 rounded px-2 py-1">
                <span className="qt-text-label-xs w-4">{idx + 1}.</span>
                <span className="qt-text-xs flex-1">{provider}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (idx > 0) {
                      const newOrder = [...formData.providerOrder]
                      ;[newOrder[idx], newOrder[idx - 1]] = [newOrder[idx - 1], newOrder[idx]]
                      onSetField('providerOrder', newOrder)
                    }
                  }}
                  disabled={idx === 0}
                  className="px-1 text-xs disabled:opacity-30 hover:bg-muted rounded"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (idx < formData.providerOrder.length - 1) {
                      const newOrder = [...formData.providerOrder]
                      ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
                      onSetField('providerOrder', newOrder)
                    }
                  }}
                  disabled={idx === formData.providerOrder.length - 1}
                  className="px-1 qt-text-xs disabled:opacity-30 hover:bg-muted rounded"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onSetField(
                      'providerOrder',
                      formData.providerOrder.filter((p) => p !== provider)
                    )
                  }
                  className="px-1 qt-text-xs text-destructive hover:bg-destructive/10 rounded"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
  onSetField: (name: string, value: any) => void
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-muted/50">
      <h4 className="font-medium text-sm mb-3">Anthropic Options</h4>

      {/* Cache Control */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="checkbox"
          id="enableCacheBreakpoints"
          checked={formData.enableCacheBreakpoints}
          onChange={(e) => onSetField('enableCacheBreakpoints', e.target.checked)}
          className="w-4 h-4 rounded dark:bg-slate-800 dark:border-slate-600"
        />
        <label htmlFor="enableCacheBreakpoints" className="text-sm">
          Enable Prompt Caching
        </label>
      </div>
      {formData.enableCacheBreakpoints && (
        <div className="space-y-3 pl-6 mb-3">
          {/* Cache Strategy */}
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

          {/* Cache TTL */}
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
            <p className="qt-text-xs">
              Cache reads are 10% of base input cost. 5m is auto-refreshed on use.
            </p>
          </div>
        </div>
      )}
      <p className="qt-text-xs">
        Prompt caching can reduce costs by up to 90% for repeated context. Caches tools, system prompts, and
        conversation history.
      </p>
    </div>
  )
}
