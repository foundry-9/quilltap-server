'use client'

import { useEffect, useState } from 'react'
import type { WizardState, WizardAction, ProviderInfo } from '../useProviderWizardState'
import { fetchProviders } from '../wizard-api'

interface ProviderSelectionStepProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

const CAPABILITY_LABELS: Record<string, string> = {
  chat: 'Chat',
  embeddings: 'Embeddings',
  imageGeneration: 'Images',
  webSearch: 'Web Search',
}

export function ProviderSelectionStep({ state, dispatch }: ProviderSelectionStepProps) {
  const [loading, setLoading] = useState(state.availableProviders.length === 0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (state.availableProviders.length > 0) return

    let cancelled = false

    fetchProviders()
      .then((providers) => {
        if (!cancelled) {
          dispatch({ type: 'SET_AVAILABLE_PROVIDERS', providers })
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load providers')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [state.availableProviders.length, dispatch])

  const hasValidChatProvider = state.selectedProviders.some((id) => {
    const provider = state.availableProviders.find((p) => p.id === id)
    return provider?.capabilities.chat
  })

  const handleToggle = (providerId: string) => {
    dispatch({ type: 'TOGGLE_PROVIDER', providerId })
  }

  const getCapabilities = (provider: ProviderInfo): string[] => {
    const caps: string[] = []
    for (const [key, label] of Object.entries(CAPABILITY_LABELS)) {
      if (provider.capabilities[key as keyof typeof provider.capabilities]) {
        caps.push(label)
      }
    }
    return caps
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="qt-spinner qt-spinner-sm mr-3" />
        <span className="qt-text-muted">Loading available providers...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="qt-alert qt-alert-error">
        <p>{error}</p>
        <button
          className="qt-btn qt-button-secondary mt-2"
          onClick={() => {
            setError(null)
            setLoading(true)
            fetchProviders()
              .then((providers) => {
                dispatch({ type: 'SET_AVAILABLE_PROVIDERS', providers })
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : 'Failed to load providers')
              })
              .finally(() => setLoading(false))
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="qt-heading-2">Select Your Providers</h2>
        <p className="qt-text-muted mt-1">
          Choose one or more AI providers to connect. You must select at least one provider
          with chat capability to continue.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {state.availableProviders.map((provider) => {
          const isSelected = state.selectedProviders.includes(provider.id)
          const capabilities = getCapabilities(provider)

          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => handleToggle(provider.id)}
              className={`w-full p-4 text-left rounded-lg transition-all ${
                isSelected
                  ? 'qt-option-selected'
                  : 'qt-option-unselected'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`qt-badge-provider-${provider.id.toLowerCase()} inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold shrink-0`}
                >
                  {provider.abbreviation}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{provider.displayName}</span>
                    {isSelected && (
                      <svg
                        className="w-5 h-5 text-[var(--qt-color-primary)]"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                  <p className="qt-text-muted qt-text-small mt-1">{provider.description}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="qt-text-xs px-2 py-0.5 rounded-full bg-[var(--qt-color-primary)]/10 qt-text-primary"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {state.selectedProviders.length > 0 && !hasValidChatProvider && (
        <div className="qt-alert qt-alert-warning">
          None of your selected providers support chat. Please select at least one chat-capable
          provider to continue.
        </div>
      )}

      {state.selectedProviders.length === 0 && (
        <p className="qt-text-muted qt-text-small text-center">
          Select at least one provider to get started.
        </p>
      )}
    </div>
  )
}
