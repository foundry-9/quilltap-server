'use client'

import { useState, useCallback } from 'react'
import type { WizardState, WizardAction, TestStatus } from '../useProviderWizardState'
import {
  testMessage,
  createConnectionProfile,
  createEmbeddingProfile,
  createImageProfile,
  updateChatSettings,
} from '../wizard-api'

interface StepProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  onComplete: () => void
}

function TestStatusIndicator({ status, error }: { status?: TestStatus; error?: string }) {
  switch (status) {
    case 'testing':
      return <span className="qt-spinner-sm" />
    case 'success':
      return (
        <svg
          className="w-5 h-5 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      )
    case 'error':
      return (
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-red-500 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          {error && <span className="qt-text-xs text-red-500">{error}</span>}
        </div>
      )
    case 'pending':
    default:
      return (
        <span className="w-3 h-3 rounded-full bg-gray-300 inline-block" />
      )
  }
}

export function TestConfirmStep({ state, dispatch, onComplete }: StepProps) {
  const [testError, setTestError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const chatProvider = state.availableProviders.find((p) => p.id === state.chatConfig.provider)
  const cheapProvider =
    state.cheapConfig.strategy === 'USER_DEFINED' && state.cheapConfig.provider
      ? state.availableProviders.find((p) => p.id === state.cheapConfig.provider)
      : null
  const embeddingProvider = state.embeddingConfig
    ? state.availableProviders.find((p) => p.id === state.embeddingConfig?.provider)
    : null
  const imageProvider = state.imageConfig
    ? state.availableProviders.find((p) => p.id === state.imageConfig?.provider)
    : null

  // ------------------------------------------------------------------
  // Test All
  // ------------------------------------------------------------------

  const handleTestAll = useCallback(async () => {
    setTestError(null)

    // Test chat configuration
    dispatch({ type: 'SET_TEST_RESULT', key: 'chat', status: 'testing' })
    try {
      const result = await testMessage({
        provider: state.chatConfig.provider,
        apiKeyId: state.apiKeys[state.chatConfig.provider]?.apiKeyId,
        baseUrl: state.baseUrls[state.chatConfig.provider],
        modelName: state.chatConfig.model,
      })
      dispatch({
        type: 'SET_TEST_RESULT',
        key: 'chat',
        status: result.success ? 'success' : 'error',
      })
      if (!result.success) {
        setTestError(result.error || 'Chat test failed')
      }
    } catch (err) {
      dispatch({ type: 'SET_TEST_RESULT', key: 'chat', status: 'error' })
      setTestError(err instanceof Error ? err.message : 'Chat test failed')
    }
  }, [state.chatConfig, state.apiKeys, state.baseUrls, dispatch])

  // ------------------------------------------------------------------
  // Save & Complete
  // ------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    dispatch({ type: 'SET_SAVING', saving: true })
    dispatch({ type: 'SET_ERROR', error: null })
    setSaveSuccess(false)

    try {
      // 1. Create main connection profile
      const mainProfile = await createConnectionProfile({
        name: `${chatProvider?.displayName || state.chatConfig.provider} - ${state.chatConfig.model}`,
        provider: state.chatConfig.provider,
        apiKeyId: state.apiKeys[state.chatConfig.provider]?.apiKeyId,
        baseUrl: state.baseUrls[state.chatConfig.provider],
        modelName: state.chatConfig.model,
        isDefault: true,
      })

      let cheapProfileId: string | undefined
      // 2. If cheap LLM is manual, create separate cheap connection profile
      if (state.cheapConfig.strategy === 'USER_DEFINED' && state.cheapConfig.provider && state.cheapConfig.model) {
        const cheapProfile = await createConnectionProfile({
          name: `Cheap - ${state.cheapConfig.provider} - ${state.cheapConfig.model}`,
          provider: state.cheapConfig.provider,
          apiKeyId: state.apiKeys[state.cheapConfig.provider]?.apiKeyId,
          baseUrl: state.baseUrls[state.cheapConfig.provider],
          modelName: state.cheapConfig.model,
          isCheap: true,
        })
        cheapProfileId = cheapProfile.id
      }

      // 3. Create embedding profile if configured
      let embeddingProfileId: string | undefined
      if (state.embeddingConfig) {
        const embProfile = await createEmbeddingProfile({
          name: `${embeddingProvider?.displayName || state.embeddingConfig.provider} - ${state.embeddingConfig.model}`,
          provider: state.embeddingConfig.provider,
          apiKeyId: state.apiKeys[state.embeddingConfig.provider]?.apiKeyId,
          baseUrl: state.baseUrls[state.embeddingConfig.provider],
          modelName: state.embeddingConfig.model,
          dimensions: state.embeddingConfig.dimensions,
          isDefault: true,
        })
        embeddingProfileId = embProfile.id
      }

      // 4. Create image profile if configured
      let imageProfileId: string | undefined
      if (state.imageConfig) {
        const imgProfile = await createImageProfile({
          name: `${imageProvider?.displayName || state.imageConfig.provider} - ${state.imageConfig.model}`,
          provider: state.imageConfig.provider,
          apiKeyId: state.apiKeys[state.imageConfig.provider]?.apiKeyId,
          baseUrl: state.baseUrls[state.imageConfig.provider],
          modelName: state.imageConfig.model,
          isDefault: true,
        })
        imageProfileId = imgProfile.id
      }

      // 5. Update chat settings with cheap LLM strategy
      await updateChatSettings({
        strategy: state.cheapConfig.strategy,
        profileId: cheapProfileId,
      })

      // 6. Dispatch created profile IDs
      dispatch({
        type: 'SET_CREATED_PROFILE_IDS',
        ids: {
          connectionProfileId: mainProfile.id,
          embeddingProfileId,
          imageProfileId,
        },
      })

      dispatch({ type: 'SET_SAVING', saving: false })
      setSaveSuccess(true)
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'Failed to save configuration',
      })
      dispatch({ type: 'SET_SAVING', saving: false })
    }
  }, [state, chatProvider, embeddingProvider, imageProvider, dispatch])

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Summary table */}
      <div className="space-y-3">
        <h3 className="qt-text-label">Configuration Summary</h3>

        <div className="border border-[var(--qt-border-color)] rounded-lg divide-y divide-[var(--qt-border-color)]">
          {/* Chat */}
          <div className="flex items-center justify-between p-3">
            <div className="flex-1">
              <span className="qt-text-label">Chat</span>
              <p className="qt-text-small qt-text-muted">
                {chatProvider?.displayName || state.chatConfig.provider} &mdash;{' '}
                {state.chatConfig.model}
              </p>
            </div>
            <TestStatusIndicator
              status={state.testResults.chat}
              error={testError || undefined}
            />
          </div>

          {/* Cheap LLM */}
          <div className="flex items-center justify-between p-3">
            <div className="flex-1">
              <span className="qt-text-label">Cheap LLM</span>
              <p className="qt-text-small qt-text-muted">
                {state.cheapConfig.strategy === 'PROVIDER_CHEAPEST' ? (
                  'Auto (provider selects cheapest model)'
                ) : (
                  <>
                    Manual &mdash; {cheapProvider?.displayName || state.cheapConfig.provider}{' '}
                    &mdash; {state.cheapConfig.model}
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Embeddings */}
          <div className="flex items-center justify-between p-3">
            <div className="flex-1">
              <span className="qt-text-label">Embeddings</span>
              <p className="qt-text-small qt-text-muted">
                {state.embeddingConfig ? (
                  <>
                    {embeddingProvider?.displayName || state.embeddingConfig.provider} &mdash;{' '}
                    {state.embeddingConfig.model}
                    {state.embeddingConfig.dimensions && (
                      <span className="qt-text-xs ml-1">
                        ({state.embeddingConfig.dimensions}d)
                      </span>
                    )}
                  </>
                ) : (
                  'Skipped'
                )}
              </p>
            </div>
          </div>

          {/* Images */}
          <div className="flex items-center justify-between p-3">
            <div className="flex-1">
              <span className="qt-text-label">Images</span>
              <p className="qt-text-small qt-text-muted">
                {state.imageConfig ? (
                  <>
                    {imageProvider?.displayName || state.imageConfig.provider} &mdash;{' '}
                    {state.imageConfig.model}
                  </>
                ) : (
                  'Skipped'
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Test button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTestAll}
          disabled={state.saving || state.testResults.chat === 'testing'}
          className="qt-button-secondary"
        >
          {state.testResults.chat === 'testing' ? (
            <span className="flex items-center gap-2">
              <span className="qt-spinner-sm" />
              Testing...
            </span>
          ) : (
            'Test All'
          )}
        </button>
        {state.testResults.chat === 'success' && (
          <span className="qt-text-small text-green-600">All tests passed</span>
        )}
      </div>

      {/* Error display */}
      {state.error && <div className="qt-alert qt-alert-error">{state.error}</div>}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={state.saving || saveSuccess}
          className="qt-button-primary"
        >
          {state.saving ? (
            <span className="flex items-center gap-2">
              <span className="qt-spinner-sm" />
              Saving...
            </span>
          ) : saveSuccess ? (
            'Saved'
          ) : (
            'Save & Complete'
          )}
        </button>
      </div>

      {/* Success message */}
      {saveSuccess && (
        <div className="space-y-4">
          <div className="qt-alert qt-alert-info">
            <p className="qt-text-small">
              Configuration saved successfully. Your AI workspace is ready to use. You can adjust any
              of these settings later in The Foundry.
            </p>
          </div>
          <button
            type="button"
            onClick={onComplete}
            className="qt-button-primary w-full py-2"
          >
            Continue to Quilltap
          </button>
        </div>
      )}
    </div>
  )
}
