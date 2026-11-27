'use client'

import { useState, useCallback } from 'react'
import { Icon } from '@/components/ui/icon'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useInvalidateProfileLists } from '@/lib/hooks/use-profiles'
import type { WizardState, WizardAction, TestStatus } from '../useProviderWizardState'
import {
  testMessage,
  testEmbedding,
  createConnectionProfile,
  createEmbeddingProfile,
  createImageProfile,
  updateChatSettings,
  updateConnectionProfile,
  updateEmbeddingProfile,
  updateImageProfile,
} from '../wizard-api'
import { planProfileWrite, type DesiredProfile } from '../profile-plan'

interface StepProps {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  onComplete: () => void
}

function TestStatusIndicator({ status, error }: { status?: TestStatus; error?: string }) {
  switch (status) {
    case 'testing':
      return (
        <span className="qt-spinner-sm" role="status">
          <span className="sr-only">Testing</span>
        </span>
      )
    case 'success':
      return <Icon name="check" className="w-5 h-5 qt-text-success" title="Test passed" />
    case 'error':
      return (
        <div className="flex items-center gap-2">
          <Icon name="close" className="w-5 h-5 qt-text-destructive flex-shrink-0" title="Test failed" />
          {error && <span className="qt-text-xs qt-text-destructive">{error}</span>}
        </div>
      )
    case 'pending':
    default:
      return (
        <span className="w-3 h-3 rounded-full qt-bg-muted inline-block" aria-hidden="true" />
      )
  }
}

/** The note beside Test All, naming exactly what was tested. */
export function testedSummary(cheapTested: boolean, embeddingsTested: boolean): string {
  const parts = ['Chat', ...(cheapTested ? ['the background model'] : []), ...(embeddingsTested ? ['embeddings'] : [])]
  if (parts.length === 1) return 'Chat works'
  const last = parts.pop()
  return `${parts.join(', ')} and ${last} work`
}

export function TestConfirmStep({ state, dispatch, onComplete }: StepProps) {
  const [testErrors, setTestErrors] = useState<Record<string, string>>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const queryClient = useQueryClient()
  const invalidateProfileLists = useInvalidateProfileLists()

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

  // Chat, a manually chosen background model and embeddings are tested with a
  // real call. Images are not: a test would draw, and bill, a picture, so the
  // row says so instead. Auto needs no test of its own: it uses the chat
  // provider's cheapest model on the key the chat test just proved.
  const embeddingTestable = !!state.embeddingConfig && state.embeddingConfig.provider !== 'BUILTIN'
  const cheapTestable =
    state.cheapConfig.strategy === 'USER_DEFINED' && !!state.cheapConfig.provider && !!state.cheapConfig.model

  const handleTestAll = useCallback(async () => {
    setTestErrors({})
    const errors: Record<string, string> = {}

    dispatch({ type: 'SET_TEST_RESULT', key: 'chat', status: 'testing' })
    try {
      const result = await testMessage({
        provider: state.chatConfig.provider,
        apiKeyId: state.apiKeys[state.chatConfig.provider]?.apiKeyId,
        baseUrl: state.baseUrls[state.chatConfig.provider],
        modelName: state.chatConfig.model,
      })
      dispatch({ type: 'SET_TEST_RESULT', key: 'chat', status: result.success ? 'success' : 'error' })
      if (!result.success) errors.chat = result.error || 'Chat test failed'
    } catch (err) {
      dispatch({ type: 'SET_TEST_RESULT', key: 'chat', status: 'error' })
      errors.chat = err instanceof Error ? err.message : 'Chat test failed'
    }

    if (cheapTestable && state.cheapConfig.provider && state.cheapConfig.model) {
      const cheapProviderId = state.cheapConfig.provider
      dispatch({ type: 'SET_TEST_RESULT', key: 'cheap', status: 'testing' })
      try {
        const result = await testMessage({
          provider: cheapProviderId,
          apiKeyId: state.apiKeys[cheapProviderId]?.apiKeyId,
          baseUrl: state.baseUrls[cheapProviderId],
          modelName: state.cheapConfig.model,
        })
        dispatch({ type: 'SET_TEST_RESULT', key: 'cheap', status: result.success ? 'success' : 'error' })
        if (!result.success) errors.cheap = result.error || 'Background model test failed'
      } catch (err) {
        dispatch({ type: 'SET_TEST_RESULT', key: 'cheap', status: 'error' })
        errors.cheap = err instanceof Error ? err.message : 'Background model test failed'
      }
    }

    if (state.embeddingConfig && embeddingTestable) {
      const emb = state.embeddingConfig
      dispatch({ type: 'SET_TEST_RESULT', key: 'embedding', status: 'testing' })
      try {
        const result = await testEmbedding({
          provider: emb.provider,
          apiKeyId: state.apiKeys[emb.provider]?.apiKeyId,
          baseUrl: state.baseUrls[emb.provider],
          modelName: emb.model,
          dimensions: emb.dimensions,
        })
        dispatch({ type: 'SET_TEST_RESULT', key: 'embedding', status: result.success ? 'success' : 'error' })
        if (!result.success) errors.embedding = result.error || 'Embedding test failed'
      } catch (err) {
        dispatch({ type: 'SET_TEST_RESULT', key: 'embedding', status: 'error' })
        errors.embedding = err instanceof Error ? err.message : 'Embedding test failed'
      }
    }

    setTestErrors(errors)
  }, [state.chatConfig, state.cheapConfig, state.embeddingConfig, state.apiKeys, state.baseUrls, cheapTestable, embeddingTestable, dispatch])

  const testedKeys = [
    'chat',
    ...(cheapTestable ? ['cheap'] : []),
    ...(embeddingTestable ? ['embedding'] : []),
  ]
  const testing = testedKeys.some((k) => state.testResults[k] === 'testing')
  const allTestsPassed = testedKeys.every((k) => state.testResults[k] === 'success')
  const passedSummary = testedSummary(cheapTestable, embeddingTestable)

  // ------------------------------------------------------------------
  // Save & Complete
  // ------------------------------------------------------------------

  const handleSave = useCallback(async () => {
    dispatch({ type: 'SET_SAVING', saving: true })
    dispatch({ type: 'SET_ERROR', error: null })
    setSaveSuccess(false)

    // Each part is kept, updated or created by `planProfileWrite`: a re-run
    // from Settings over an existing setup must not re-create what is already
    // there under a taken name (#268). On a fresh instance every part creates.
    const displayName = (provider: string) =>
      state.availableProviders.find((p) => p.id === provider)?.displayName || provider
    const autoName = (d: DesiredProfile) => `${displayName(d.provider)} - ${d.model}`
    const cheapAutoName = (d: DesiredProfile) => `Cheap - ${autoName(d)}`
    const existing = state.existingProfiles ?? {}
    const taken = state.takenProfileNames ?? { connection: [], embedding: [], image: [] }
    // Names created during this save are taken too, for the parts after them
    const takenConnection = [...taken.connection]

    try {
      // 1. Main (default) connection profile
      const chatDesired = { provider: state.chatConfig.provider, model: state.chatConfig.model }
      const chatPlan = planProfileWrite(existing.chat, chatDesired, autoName, takenConnection)
      const chatWrite = {
        provider: state.chatConfig.provider,
        apiKeyId: state.apiKeys[state.chatConfig.provider]?.apiKeyId,
        baseUrl: state.baseUrls[state.chatConfig.provider],
        modelName: state.chatConfig.model,
        isDefault: true,
      }
      if (chatPlan.kind === 'create') {
        await createConnectionProfile({ ...chatWrite, name: chatPlan.name })
        takenConnection.push(chatPlan.name)
      } else if (chatPlan.kind === 'update') {
        await updateConnectionProfile(chatPlan.id, { ...chatWrite, name: chatPlan.name })
        takenConnection.push(chatPlan.name)
      }

      let cheapProfileId: string | undefined
      // 2. If the background model is manual, its own connection profile
      if (state.cheapConfig.strategy === 'USER_DEFINED' && state.cheapConfig.provider && state.cheapConfig.model) {
        const cheapDesired = { provider: state.cheapConfig.provider, model: state.cheapConfig.model }
        const cheapPlan = planProfileWrite(existing.cheap, cheapDesired, cheapAutoName, takenConnection)
        const cheapWrite = {
          provider: state.cheapConfig.provider,
          apiKeyId: state.apiKeys[state.cheapConfig.provider]?.apiKeyId,
          baseUrl: state.baseUrls[state.cheapConfig.provider],
          modelName: state.cheapConfig.model,
          isCheap: true,
        }
        if (cheapPlan.kind === 'create') {
          cheapProfileId = (await createConnectionProfile({ ...cheapWrite, name: cheapPlan.name })).id
        } else {
          if (cheapPlan.kind === 'update') {
            await updateConnectionProfile(cheapPlan.id, { ...cheapWrite, name: cheapPlan.name })
          }
          cheapProfileId = cheapPlan.id
        }
      }

      // 3. Embedding profile, if configured
      if (state.embeddingConfig) {
        const emb = state.embeddingConfig
        const embPlan = planProfileWrite(existing.embedding, { provider: emb.provider, model: emb.model }, autoName, taken.embedding)
        const embWrite = {
          provider: emb.provider,
          apiKeyId: state.apiKeys[emb.provider]?.apiKeyId,
          baseUrl: state.baseUrls[emb.provider],
          modelName: emb.model,
          dimensions: emb.dimensions,
          isDefault: true,
        }
        if (embPlan.kind === 'create') {
          await createEmbeddingProfile({ ...embWrite, name: embPlan.name })
        } else if (embPlan.kind === 'update') {
          await updateEmbeddingProfile(embPlan.id, { ...embWrite, name: embPlan.name })
        }
      }

      // 4. Image profile, if configured
      if (state.imageConfig) {
        const img = state.imageConfig
        const imgPlan = planProfileWrite(existing.image, { provider: img.provider, model: img.model }, autoName, taken.image)
        const imgWrite = {
          provider: img.provider,
          apiKeyId: state.apiKeys[img.provider]?.apiKeyId,
          baseUrl: state.baseUrls[img.provider],
          modelName: img.model,
          isDefault: true,
        }
        if (imgPlan.kind === 'create') {
          await createImageProfile({ ...imgWrite, name: imgPlan.name })
        } else if (imgPlan.kind === 'update') {
          await updateImageProfile(imgPlan.id, { ...imgWrite, name: imgPlan.name })
        }
      }

      // 5. Update chat settings with cheap LLM strategy
      await updateChatSettings({
        strategy: state.cheapConfig.strategy,
        userDefinedProfileId: cheapProfileId,
      })

      // Every picker and settings view now has new rows to show.
      void invalidateProfileLists('apiKeys', 'connectionProfiles', 'embeddingProfiles', 'imageProfiles')
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.chat })

      dispatch({ type: 'SET_SAVING', saving: false })
      setSaveSuccess(true)
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : 'Failed to save configuration',
      })
      dispatch({ type: 'SET_SAVING', saving: false })
    }
  }, [state, dispatch, invalidateProfileLists, queryClient])

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Summary table */}
      <div className="space-y-3">
        <h3 className="qt-text-label">Configuration Summary</h3>

        <div className="border qt-border-default rounded-lg divide-y qt-divide-default">
          {/* Chat */}
          <div className="flex items-center justify-between p-3">
            <div className="flex-1">
              <span className="qt-text-label">Chat</span>
              <p className="qt-text-small qt-text-muted">
                {chatProvider?.displayName || state.chatConfig.provider} &mdash;{' '}
                {state.chatConfig.model}
              </p>
            </div>
            <TestStatusIndicator status={state.testResults.chat} error={testErrors.chat} />
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
            {cheapTestable && (
              <TestStatusIndicator status={state.testResults.cheap} error={testErrors.cheap} />
            )}
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
                      <>
                        {' '}
                        <span className="qt-text-xs">({state.embeddingConfig.dimensions}d)</span>
                      </>
                    )}
                  </>
                ) : (
                  'Skipped'
                )}
              </p>
            </div>
            {embeddingTestable && (
              <TestStatusIndicator status={state.testResults.embedding} error={testErrors.embedding} />
            )}
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
              {state.imageConfig && (
                <p className="qt-text-xs qt-text-muted">
                  Not tested here, as a test would commission (and bill you for) an actual picture.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Test button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTestAll}
          disabled={state.saving || testing}
          className="qt-button-secondary"
        >
          {testing ? (
            <span className="flex items-center gap-2">
              <span className="qt-spinner-sm" />
              Testing...
            </span>
          ) : (
            'Test All'
          )}
        </button>
        {!testing && allTestsPassed && (
          <span className="qt-text-small qt-text-success" role="status">{passedSummary}</span>
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
