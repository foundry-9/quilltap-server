'use client'

import { useState, useEffect, useCallback } from 'react'
import type { WizardState, WizardAction, ProviderInfo } from '../useProviderWizardState'
import { fetchEmbeddingModels } from '../wizard-api'

interface StepProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

interface EmbeddingModel {
  id: string
  name: string
  dimensions: number
  description: string
}

const BUILTIN_TFIDF_ID = '__builtin_tfidf__'

export function EmbeddingProviderStep({ state, dispatch }: StepProps) {
  const [selectedProvider, setSelectedProvider] = useState<string>(
    state.embeddingConfig?.provider || ''
  )
  const [models, setModels] = useState<EmbeddingModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string>(
    state.embeddingConfig?.model || ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get selected providers that have embeddings capability
  const embeddingProviders = state.selectedProviders
    .map((id) => state.availableProviders.find((p) => p.id === id))
    .filter(
      (p): p is ProviderInfo => p !== undefined && p.capabilities.embeddings
    )

  const loadModels = useCallback(async (provider: string) => {
    if (provider === BUILTIN_TFIDF_ID) {
      setModels([])
      return
    }

    setLoading(true)
    setError(null)
    try {
      const fetched = await fetchEmbeddingModels(provider)
      setModels(fetched)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch embedding models')
      setModels([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch models when provider changes
  useEffect(() => {
    if (selectedProvider && selectedProvider !== BUILTIN_TFIDF_ID) {
      loadModels(selectedProvider)
    } else {
      setModels([])
    }
  }, [selectedProvider, loadModels])

  const handleProviderSelect = (providerId: string) => {
    setSelectedProvider(providerId)
    setSelectedModel('')

    if (providerId === BUILTIN_TFIDF_ID) {
      // Built-in TF-IDF has no model to select; clear embedding config
      dispatch({ type: 'SET_EMBEDDING_CONFIG', config: null })
    } else if (!providerId) {
      dispatch({ type: 'SET_EMBEDDING_CONFIG', config: null })
    }
  }

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId)
    if (!modelId || !selectedProvider) {
      dispatch({ type: 'SET_EMBEDDING_CONFIG', config: null })
      return
    }

    const model = models.find((m) => m.id === modelId)
    dispatch({
      type: 'SET_EMBEDDING_CONFIG',
      config: {
        provider: selectedProvider,
        model: modelId,
        dimensions: model?.dimensions,
      },
    })
  }

  const selectedModelInfo = models.find((m) => m.id === selectedModel)

  return (
    <div className="space-y-6">
      {/* Provider list */}
      <div className="space-y-3">
        <label className="qt-text-label">Embedding Provider</label>

        <div className="space-y-2">
          {/* Built-in TF-IDF option */}
          <button
            type="button"
            onClick={() => handleProviderSelect(BUILTIN_TFIDF_ID)}
            className={`w-full text-left p-3 rounded-lg transition-colors ${
              selectedProvider === BUILTIN_TFIDF_ID
                ? 'qt-option-selected'
                : 'qt-option-unselected'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-medium qt-text-primary">Built-in (TF-IDF)</span>
                <p className="qt-text-small qt-text-muted mt-0.5">
                  Free keyword-based search. No API key required. Good for basic memory retrieval.
                </p>
              </div>
              <span className="qt-text-xs px-2 py-0.5 rounded qt-bg-success/10 qt-text-success">
                Free
              </span>
            </div>
          </button>

          {/* LLM providers with embedding capability */}
          {embeddingProviders.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => handleProviderSelect(provider.id)}
              className={`w-full text-left p-3 rounded-lg transition-colors ${
                selectedProvider === provider.id
                  ? 'qt-option-selected'
                  : 'qt-option-unselected'
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
                  <p className="qt-text-small qt-text-muted mt-0.5">
                    Semantic embeddings for more accurate memory search
                  </p>
                </div>
              </div>
            </button>
          ))}

          {embeddingProviders.length === 0 && (
            <p className="qt-text-small qt-text-muted">
              None of your selected providers support embeddings. You can use the built-in TF-IDF
              search or add a provider with embedding support.
            </p>
          )}
        </div>
      </div>

      {/* Model selector - shown when a non-builtin provider is selected */}
      {selectedProvider && selectedProvider !== BUILTIN_TFIDF_ID && (
        <div className="space-y-2">
          <label className="qt-text-label">Embedding Model</label>
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
              <option value="">Select an embedding model</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.dimensions}d)
                </option>
              ))}
            </select>
          )}

          {/* Dimension info */}
          {selectedModelInfo && (
            <div className="qt-alert qt-alert-info">
              <p className="qt-text-small">
                <strong>{selectedModelInfo.name}</strong> produces{' '}
                <strong>{selectedModelInfo.dimensions}-dimensional</strong> vectors.
                {selectedModelInfo.description && (
                  <span className="block mt-1 qt-text-muted">{selectedModelInfo.description}</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Info note */}
      <div className="qt-alert qt-alert-info">
        <p className="qt-text-small">
          Embeddings power the Commonplace Book memory system. You can configure this later in The
          Foundry.
        </p>
      </div>
    </div>
  )
}
