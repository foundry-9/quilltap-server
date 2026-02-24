'use client'

import { useEffect, useCallback } from 'react'
import { WizardLayout, WizardNav } from './WizardLayout'
import { useProviderWizardState } from './useProviderWizardState'
import { loadExistingConfig } from './wizard-api'
import { ProviderSelectionStep } from './steps/ProviderSelectionStep'
import { ApiKeyEntryStep } from './steps/ApiKeyEntryStep'
import { ModelSelectionStep } from './steps/ModelSelectionStep'
import { EmbeddingProviderStep } from './steps/EmbeddingProviderStep'
import { ImageProviderStep } from './steps/ImageProviderStep'
import { TestConfirmStep } from './steps/TestConfirmStep'

interface ProviderWizardProps {
  mode: 'setup' | 'settings'
  onComplete: () => void
  onCancel?: () => void
}

const STEP_TITLES: Record<string, { title: string; subtitle: string }> = {
  providers: {
    title: 'Choose Your Providers',
    subtitle:
      'Select the AI providers you wish to engage. Each brings its own particular talents to the enterprise.',
  },
  'api-keys': {
    title: 'Present Your Credentials',
    subtitle:
      'Every establishment requires proper identification. Enter your API keys and we shall verify them forthwith.',
  },
  models: {
    title: 'Select Your Models',
    subtitle:
      'With credentials in order, choose which models shall serve as your primary conversationalists.',
  },
  embedding: {
    title: 'The Memory Engine',
    subtitle:
      'Embeddings power the Commonplace Book — your characters\u2019 long-term memory. This step is entirely optional.',
  },
  image: {
    title: 'The Lantern',
    subtitle:
      'Image generation brings visual atmosphere to your stories. Also entirely optional, but rather dashing.',
  },
  confirm: {
    title: 'Review & Confirm',
    subtitle:
      'A final inspection before we commit these arrangements to the ledger. Test if you like, then save.',
  },
}

/**
 * Multi-provider AI stack setup wizard.
 * Guides users through configuring API keys, selecting models, and creating profiles.
 */
export function ProviderWizard({ mode, onComplete, onCancel }: ProviderWizardProps) {
  const {
    state,
    dispatch,
    goNext,
    goBack,
    canGoBack,
    isLastStep,
    hasValidChatProvider,
    allKeysValidated,
    getProvidersWithCapability,
  } = useProviderWizardState()

  // In settings mode, load existing config on mount
  useEffect(() => {
    if (mode !== 'settings') return

    let cancelled = false
    const load = async () => {
      try {
        const config = await loadExistingConfig()

        if (cancelled) return

        // Pre-populate selected providers from existing API keys
        const existingProviders = [
          ...new Set(config.apiKeys.map((k) => k.provider)),
        ]

        // Pre-populate API keys as validated (they exist already)
        const apiKeys: Record<string, { label: string; key: string; validated: boolean; apiKeyId?: string }> = {}
        for (const key of config.apiKeys) {
          if (!apiKeys[key.provider]) {
            apiKeys[key.provider] = {
              label: key.label,
              key: '********',
              validated: true,
              apiKeyId: key.id,
            }
          }
        }

        // Pre-populate chat config from default connection profile
        const defaultProfile = config.connectionProfiles.find((p) => p.isDefault)
        const chatConfig = defaultProfile
          ? { provider: defaultProfile.provider, model: defaultProfile.modelName }
          : { provider: '', model: '' }

        // Pre-populate cheap config
        const cheapProfile = config.connectionProfiles.find((p) => p.isCheap)
        const cheapConfig = cheapProfile
          ? { strategy: 'USER_DEFINED' as const, provider: cheapProfile.provider, model: cheapProfile.modelName }
          : { strategy: config.chatSettings?.cheapLLMSettings?.strategy as 'PROVIDER_CHEAPEST' || 'PROVIDER_CHEAPEST' as const }

        // Pre-populate embedding config
        const defaultEmb = config.embeddingProfiles.find((p) => p.isDefault) || config.embeddingProfiles[0]
        const embeddingConfig = defaultEmb
          ? { provider: defaultEmb.provider, model: defaultEmb.modelName, dimensions: defaultEmb.dimensions || undefined }
          : null

        // Pre-populate image config
        const defaultImg = config.imageProfiles.find((p) => p.isDefault) || config.imageProfiles[0]
        const imageConfig = defaultImg
          ? { provider: defaultImg.provider, model: defaultImg.modelName }
          : null

        dispatch({
          type: 'LOAD_EXISTING_CONFIG',
          state: {
            selectedProviders: existingProviders,
            apiKeys,
            chatConfig,
            cheapConfig,
            embeddingConfig,
            imageConfig,
          },
        })

        console.debug('[ProviderWizard] Loaded existing config for settings mode', {
          providers: existingProviders.length,
          profiles: config.connectionProfiles.length,
        })
      } catch (err) {
        console.error('[ProviderWizard] Failed to load existing config', err)
      }
    }

    load()
    return () => { cancelled = true }
  }, [mode, dispatch])

  // Step-specific validation for the "Next" button
  const canProceed = useCallback((): boolean => {
    switch (state.currentStep) {
      case 'providers':
        return state.selectedProviders.length > 0 && hasValidChatProvider
      case 'api-keys':
        return allKeysValidated
      case 'models':
        return !!state.chatConfig.provider && !!state.chatConfig.model
      case 'embedding':
        return true // optional step
      case 'image':
        return true // optional step
      case 'confirm':
        return true
      default:
        return false
    }
  }, [state.currentStep, state.selectedProviders, hasValidChatProvider, allKeysValidated, state.chatConfig])

  const handleNext = useCallback(() => {
    if (!canProceed()) return
    goNext()
  }, [canProceed, goNext])

  const handleSkip = useCallback(() => {
    if (state.currentStep === 'embedding') {
      dispatch({ type: 'SET_EMBEDDING_CONFIG', config: null })
    } else if (state.currentStep === 'image') {
      dispatch({ type: 'SET_IMAGE_CONFIG', config: null })
    }
    goNext()
  }, [state.currentStep, dispatch, goNext])

  const stepInfo = STEP_TITLES[state.currentStep] || { title: '', subtitle: '' }
  const isSkippable = state.currentStep === 'embedding' || state.currentStep === 'image'

  // Determine the appropriate step component
  const renderStep = () => {
    switch (state.currentStep) {
      case 'providers':
        return <ProviderSelectionStep state={state} dispatch={dispatch} />
      case 'api-keys':
        return <ApiKeyEntryStep state={state} dispatch={dispatch} />
      case 'models':
        return <ModelSelectionStep state={state} dispatch={dispatch} />
      case 'embedding':
        return <EmbeddingProviderStep state={state} dispatch={dispatch} />
      case 'image':
        return <ImageProviderStep state={state} dispatch={dispatch} />
      case 'confirm':
        return <TestConfirmStep state={state} dispatch={dispatch} onComplete={onComplete} />
      default:
        return null
    }
  }

  return (
    <WizardLayout
      currentStep={state.currentStep}
      title={stepInfo.title}
      subtitle={stepInfo.subtitle}
      footer={
        <WizardNav
          onBack={canGoBack ? goBack : (onCancel || undefined)}
          canGoBack={canGoBack || !!onCancel}
          onNext={!isLastStep ? handleNext : undefined}
          canGoNext={!isLastStep}
          nextDisabled={!canProceed()}
          nextLabel={isSkippable ? 'Next' : 'Next'}
          showSkip={isSkippable}
          onSkip={isSkippable ? handleSkip : undefined}
          loading={state.saving}
        />
      }
    >
      {state.error && (
        <div className="qt-alert qt-alert-error text-sm mb-4">{state.error}</div>
      )}
      {renderStep()}
    </WizardLayout>
  )
}
