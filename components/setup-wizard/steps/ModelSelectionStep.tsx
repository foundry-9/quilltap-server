'use client'

import { useEffect, useState, useCallback } from 'react'
import type { WizardState, WizardAction, ProviderInfo } from '../useProviderWizardState'
import { fetchModels } from '../wizard-api'
import { ModelSelector } from '@/components/settings/model-selector'

interface ModelSelectionStepProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

export function ModelSelectionStep({ state, dispatch }: ModelSelectionStepProps) {
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({})
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({})

  const chatProviders = state.selectedProviders
    .map((id) => state.availableProviders.find((p) => p.id === id))
    .filter((p): p is ProviderInfo => p !== undefined && p.capabilities.chat)

  const loadModelsForProvider = useCallback(
    async (provider: ProviderInfo) => {
      const apiKeyEntry = state.apiKeys[provider.id]
      const baseUrl = state.baseUrls[provider.id]

      setLoadingModels((prev) => ({ ...prev, [provider.id]: true }))
      setModelErrors((prev) => {
        const next = { ...prev }
        delete next[provider.id]
        return next
      })

      try {
        const models = await fetchModels(
          provider.id,
          apiKeyEntry?.apiKeyId,
          baseUrl || undefined
        )
        dispatch({ type: 'SET_AVAILABLE_MODELS', providerId: provider.id, models })
      } catch (err) {
        setModelErrors((prev) => ({
          ...prev,
          [provider.id]: err instanceof Error ? err.message : 'Failed to fetch models',
        }))
      } finally {
        setLoadingModels((prev) => ({ ...prev, [provider.id]: false }))
      }
    },
    [state.apiKeys, state.baseUrls, dispatch]
  )

  // Fetch models on mount for providers that don't have them yet
  useEffect(() => {
    for (const provider of chatProviders) {
      if (!state.availableModels[provider.id] && !loadingModels[provider.id]) {
        loadModelsForProvider(provider)
      }
    }
    // Only run on mount and when chatProviders change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatProviders.map((p) => p.id).join(',')])

  const handleChatModelChange = useCallback(
    (providerId: string, model: string) => {
      dispatch({
        type: 'SET_CHAT_CONFIG',
        config: { provider: providerId, model },
      })
    },
    [dispatch]
  )

  const handleCheapStrategyChange = useCallback(
    (strategy: 'PROVIDER_CHEAPEST' | 'USER_DEFINED') => {
      dispatch({
        type: 'SET_CHEAP_CONFIG',
        config: {
          strategy,
          ...(strategy === 'PROVIDER_CHEAPEST' ? { provider: undefined, model: undefined } : {}),
        },
      })
    },
    [dispatch]
  )

  const handleCheapProviderChange = useCallback(
    (providerId: string) => {
      dispatch({
        type: 'SET_CHEAP_CONFIG',
        config: { provider: providerId, model: '' },
      })
    },
    [dispatch]
  )

  const handleCheapModelChange = useCallback(
    (model: string) => {
      dispatch({
        type: 'SET_CHEAP_CONFIG',
        config: { model },
      })
    },
    [dispatch]
  )

  const cheapModels =
    state.cheapConfig.provider && state.availableModels[state.cheapConfig.provider]
      ? state.availableModels[state.cheapConfig.provider]
      : []

  return (
    <div className="space-y-8">
      <div>
        <h2 className="qt-heading-2">Choose Your Models</h2>
        <p className="qt-text-muted mt-1">
          Select which models to use for chat. You can always change these later in settings.
        </p>
      </div>

      {/* Primary chat model selection */}
      <section className="space-y-4">
        <h3 className="font-semibold text-lg">Primary Chat Model</h3>
        <p className="qt-text-muted qt-text-small">
          This is the main model used for conversations with your characters.
        </p>

        {chatProviders.map((provider) => {
          const models = state.availableModels[provider.id] || []
          const isLoading = loadingModels[provider.id]
          const error = modelErrors[provider.id]
          const isSelected = state.chatConfig.provider === provider.id

          return (
            <div key={provider.id} className="qt-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <span
                  className={`qt-badge-provider-${provider.id.toLowerCase()} inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold`}
                >
                  {provider.abbreviation}
                </span>
                <span className="font-medium">{provider.displayName}</span>
                {isSelected && state.chatConfig.model && (
                  <span className="ml-auto qt-text-xs qt-text-primary font-medium">
                    Selected
                  </span>
                )}
              </div>

              {isLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <span className="qt-spinner qt-spinner-sm" />
                  <span className="qt-text-muted qt-text-small">Fetching models...</span>
                </div>
              ) : error ? (
                <div className="space-y-2">
                  <div className="qt-alert qt-alert-error">{error}</div>
                  <button
                    type="button"
                    onClick={() => loadModelsForProvider(provider)}
                    className="qt-btn qt-button-secondary qt-text-small"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <ModelSelector
                  models={models}
                  value={isSelected ? state.chatConfig.model : ''}
                  onChange={(model) => handleChatModelChange(provider.id, model)}
                  placeholder={`Select a ${provider.displayName} model`}
                  disabled={models.length === 0}
                />
              )}

              {models.length === 0 && !isLoading && !error && (
                <p className="qt-text-muted qt-text-xs mt-1">
                  No models available. Ensure your API key is valid.
                </p>
              )}
            </div>
          )
        })}

        {chatProviders.length === 0 && (
          <div className="qt-alert qt-alert-warning">
            No chat-capable providers selected. Go back and select a provider with chat
            capability.
          </div>
        )}
      </section>

      {/* Cheap LLM configuration */}
      <section className="space-y-4">
        <h3 className="font-semibold text-lg">Background Model (Cheap LLM)</h3>
        <p className="qt-text-muted qt-text-small">
          A smaller, faster model used for background tasks like summaries, memory management,
          and classification. This keeps costs down while your primary model handles
          conversations.
        </p>

        <div className="space-y-3">
          <label className="flex items-start gap-3 qt-card p-4 cursor-pointer">
            <input
              type="radio"
              name="cheapStrategy"
              value="PROVIDER_CHEAPEST"
              checked={state.cheapConfig.strategy === 'PROVIDER_CHEAPEST'}
              onChange={() => handleCheapStrategyChange('PROVIDER_CHEAPEST')}
              className="mt-0.5"
            />
            <div>
              <span className="font-medium">Auto (Recommended)</span>
              <p className="qt-text-muted qt-text-small mt-0.5">
                Automatically use the cheapest available model from your primary chat
                provider. This is the simplest option and works well for most users.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 qt-card p-4 cursor-pointer">
            <input
              type="radio"
              name="cheapStrategy"
              value="USER_DEFINED"
              checked={state.cheapConfig.strategy === 'USER_DEFINED'}
              onChange={() => handleCheapStrategyChange('USER_DEFINED')}
              className="mt-0.5"
            />
            <div>
              <span className="font-medium">Manual</span>
              <p className="qt-text-muted qt-text-small mt-0.5">
                Choose a specific provider and model for background tasks.
              </p>
            </div>
          </label>
        </div>

        {state.cheapConfig.strategy === 'USER_DEFINED' && (
          <div className="ml-6 space-y-4 border-l-2 border-[var(--qt-color-primary)]/20 pl-4">
            <div>
              <label className="qt-text-label block mb-1.5">Provider</label>
              <select
                value={state.cheapConfig.provider || ''}
                onChange={(e) => handleCheapProviderChange(e.target.value)}
                className="qt-input w-full"
              >
                <option value="">Select a provider</option>
                {chatProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </option>
                ))}
              </select>
            </div>

            {state.cheapConfig.provider && (
              <div>
                <label className="qt-text-label block mb-1.5">Model</label>
                {loadingModels[state.cheapConfig.provider] ? (
                  <div className="flex items-center gap-2 py-2">
                    <span className="qt-spinner qt-spinner-sm" />
                    <span className="qt-text-muted qt-text-small">Fetching models...</span>
                  </div>
                ) : (
                  <ModelSelector
                    models={cheapModels}
                    value={state.cheapConfig.model || ''}
                    onChange={handleCheapModelChange}
                    placeholder="Select a background model"
                    disabled={cheapModels.length === 0}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
