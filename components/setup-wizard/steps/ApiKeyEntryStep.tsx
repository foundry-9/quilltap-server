'use client'

import { useState, useCallback } from 'react'
import type { WizardState, WizardAction, ProviderInfo } from '../useProviderWizardState'
import { createApiKey, testConnection } from '../wizard-api'

interface ApiKeyEntryStepProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}

interface ProviderKeyFormState {
  key: string
  baseUrl: string
  validating: boolean
  validated: boolean
  error: string | null
  apiKeyId: string | null
}

export function ApiKeyEntryStep({ state, dispatch }: ApiKeyEntryStepProps) {
  const [formStates, setFormStates] = useState<Record<string, ProviderKeyFormState>>(() => {
    const initial: Record<string, ProviderKeyFormState> = {}
    for (const providerId of state.selectedProviders) {
      const provider = state.availableProviders.find((p) => p.id === providerId)
      const existingKey = state.apiKeys[providerId]
      initial[providerId] = {
        key: existingKey?.key || '',
        baseUrl: state.baseUrls[providerId] || provider?.configRequirements.baseUrlDefault || '',
        validating: false,
        validated: existingKey?.validated || false,
        error: existingKey?.error || null,
        apiKeyId: existingKey?.apiKeyId || null,
      }
    }
    return initial
  })

  const getFormState = useCallback(
    (providerId: string): ProviderKeyFormState => {
      return (
        formStates[providerId] || {
          key: '',
          baseUrl: '',
          validating: false,
          validated: false,
          error: null,
          apiKeyId: null,
        }
      )
    },
    [formStates]
  )

  const updateFormState = useCallback(
    (providerId: string, updates: Partial<ProviderKeyFormState>) => {
      setFormStates((prev) => ({
        ...prev,
        [providerId]: { ...prev[providerId], ...updates },
      }))
    },
    []
  )

  const handleValidate = useCallback(
    async (provider: ProviderInfo) => {
      const form = getFormState(provider.id)
      updateFormState(provider.id, { validating: true, error: null })

      try {
        let apiKeyId = form.apiKeyId
        const baseUrl = form.baseUrl || undefined

        // Store the API key if provider requires one
        if (provider.configRequirements.requiresApiKey) {
          if (!form.key.trim()) {
            updateFormState(provider.id, { validating: false, error: 'API key is required' })
            return
          }
          const label = `${provider.displayName} (Setup Wizard)`
          const result = await createApiKey(provider.id, label, form.key.trim())
          apiKeyId = result.id
        }

        // Test the connection
        const testResult = await testConnection(
          provider.id,
          apiKeyId || '',
          baseUrl
        )

        if (testResult.valid) {
          updateFormState(provider.id, {
            validating: false,
            validated: true,
            error: null,
            apiKeyId,
          })

          // Sync to wizard state
          dispatch({
            type: 'SET_API_KEY',
            providerId: provider.id,
            entry: {
              label: `${provider.displayName} (Setup Wizard)`,
              key: form.key,
              validated: true,
              apiKeyId: apiKeyId || undefined,
            },
          })

          if (baseUrl) {
            dispatch({ type: 'SET_BASE_URL', providerId: provider.id, url: baseUrl })
          }
        } else {
          updateFormState(provider.id, {
            validating: false,
            validated: false,
            error: testResult.error || 'Connection test failed',
          })
        }
      } catch (err) {
        updateFormState(provider.id, {
          validating: false,
          validated: false,
          error: err instanceof Error ? err.message : 'Validation failed',
        })
      }
    },
    [getFormState, updateFormState, dispatch]
  )

  const selectedProviderInfos = state.selectedProviders
    .map((id) => state.availableProviders.find((p) => p.id === id))
    .filter((p): p is ProviderInfo => p !== undefined)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="qt-heading-2">Configure API Keys</h2>
        <p className="qt-text-muted mt-1">
          Enter your API keys and validate the connection for each selected provider.
        </p>
      </div>

      <div className="space-y-6">
        {selectedProviderInfos.map((provider) => {
          const form = getFormState(provider.id)
          const requiresKey = provider.configRequirements.requiresApiKey
          const requiresBaseUrl = provider.configRequirements.requiresBaseUrl

          return (
            <div key={provider.id} className="qt-card p-5">
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`qt-badge-provider-${provider.id.toLowerCase()} inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold`}
                >
                  {provider.abbreviation}
                </span>
                <h3 className="font-semibold text-lg">{provider.displayName}</h3>
                {form.validated && (
                  <svg
                    className="w-5 h-5 qt-text-success ml-auto"
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

              <div className="space-y-4">
                {requiresKey && (
                  <div>
                    <label className="qt-text-label block mb-1.5">
                      {provider.configRequirements.apiKeyLabel || 'API Key'}
                    </label>
                    <input
                      type="password"
                      value={form.key}
                      onChange={(e) => {
                        updateFormState(provider.id, {
                          key: e.target.value,
                          validated: false,
                          error: null,
                        })
                      }}
                      placeholder="Enter your API key"
                      className="qt-input w-full"
                      disabled={form.validating}
                    />
                  </div>
                )}

                {requiresBaseUrl && (
                  <div>
                    <label className="qt-text-label block mb-1.5">
                      {provider.configRequirements.baseUrlLabel || 'Base URL'}
                    </label>
                    <input
                      type="text"
                      value={form.baseUrl}
                      onChange={(e) => {
                        updateFormState(provider.id, {
                          baseUrl: e.target.value,
                          validated: false,
                          error: null,
                        })
                      }}
                      placeholder={
                        provider.configRequirements.baseUrlPlaceholder || 'https://...'
                      }
                      className="qt-input w-full"
                      disabled={form.validating}
                    />
                    {provider.configRequirements.baseUrlDefault && !form.baseUrl && (
                      <p className="qt-text-xs qt-text-muted mt-1">
                        Default: {provider.configRequirements.baseUrlDefault}
                      </p>
                    )}
                  </div>
                )}

                {form.error && (
                  <div className="qt-alert qt-alert-error">
                    {form.error}
                  </div>
                )}

                {form.validated && (
                  <div className="qt-alert qt-alert-info">
                    Connection validated successfully.
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleValidate(provider)}
                  disabled={form.validating || (requiresKey && !form.key.trim())}
                  className="qt-btn qt-button-primary"
                >
                  {form.validating ? (
                    <span className="flex items-center gap-2">
                      <span className="qt-spinner qt-spinner-sm" />
                      Validating...
                    </span>
                  ) : form.validated ? (
                    'Re-validate'
                  ) : (
                    'Validate'
                  )}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {selectedProviderInfos.length === 0 && (
        <div className="qt-alert qt-alert-warning">
          No providers selected. Go back and select at least one provider.
        </div>
      )}
    </div>
  )
}
