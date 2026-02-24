'use client'

import { useState, useEffect, useCallback } from 'react'
import type { WizardState, WizardAction, ProviderInfo } from '../useProviderWizardState'
import { fetchImageModels } from '../wizard-api'

interface StepProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

export function ImageProviderStep({ state, dispatch }: StepProps) {
  const [selectedProvider, setSelectedProvider] = useState<string>(
    state.imageConfig?.provider || ''
  )
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState<string>(
    state.imageConfig?.model || ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get selected providers that have imageGeneration capability
  const imageProviders = state.selectedProviders
    .map((id) => state.availableProviders.find((p) => p.id === id))
    .filter(
      (p): p is ProviderInfo => p !== undefined && p.capabilities.imageGeneration
    )

  const loadModels = useCallback(
    async (provider: string) => {
      setLoading(true)
      setError(null)
      try {
        const apiKeyId = state.apiKeys[provider]?.apiKeyId
        const fetched = await fetchImageModels(provider, apiKeyId)
        setModels(fetched)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch image models')
        setModels([])
      } finally {
        setLoading(false)
      }
    },
    [state.apiKeys]
  )

  // Fetch models when provider changes
  useEffect(() => {
    if (selectedProvider) {
      loadModels(selectedProvider)
    } else {
      setModels([])
    }
  }, [selectedProvider, loadModels])

  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId)
    setSelectedModel('')

    if (!providerId) {
      dispatch({ type: 'SET_IMAGE_CONFIG', config: null })
    }
  }

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId)
    if (!modelId || !selectedProvider) {
      dispatch({ type: 'SET_IMAGE_CONFIG', config: null })
      return
    }

    dispatch({
      type: 'SET_IMAGE_CONFIG',
      config: {
        provider: selectedProvider,
        model: modelId,
      },
    })
  }

  return (
    <div className="space-y-6">
      {/* Provider list */}
      <div className="space-y-3">
        <label className="qt-text-label">Image Provider</label>

        <div className="space-y-2">
          {imageProviders.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => handleProviderSelect(provider.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedProvider === provider.id
                  ? 'qt-bg-active border-[var(--qt-border-active,var(--qt-primary))]'
                  : 'qt-bg-hover border-[var(--qt-border-color)]'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{ backgroundColor: provider.colors.bg, color: provider.colors.text }}
                >
                  {provider.abbreviation}
                </span>
                <div>
                  <span className="font-medium qt-text-primary">{provider.displayName}</span>
                  <p className="qt-text-small qt-text-muted mt-0.5">{provider.description}</p>
                </div>
              </div>
            </button>
          ))}

          {imageProviders.length === 0 && (
            <p className="qt-text-small qt-text-muted">
              None of your selected providers support image generation. You can skip this step and
              configure image generation later in The Foundry.
            </p>
          )}
        </div>
      </div>

      {/* Model selector */}
      {selectedProvider && (
        <div className="space-y-2">
          <label className="qt-text-label">Image Model</label>
          {loading ? (
            <div className="flex items-center gap-2 py-2">
              <span className="qt-spinner-sm" />
              <span className="qt-text-small qt-text-muted">Loading models...</span>
            </div>
          ) : error ? (
            <div className="qt-alert qt-alert-error">{error}</div>
          ) : (
            <select
              value={selectedModel}
              onChange={(e) => handleModelSelect(e.target.value)}
              className="w-full px-3 py-2 border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select an image model</option>
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Info note */}
      <div className="qt-alert qt-alert-info">
        <p className="qt-text-small">
          Image generation powers The Lantern background system. You can configure this later in The
          Foundry.
        </p>
      </div>
    </div>
  )
}
