'use client'

import { useReducer, useCallback } from 'react'
import type { ExistingProfileRef } from './profile-plan'

// ============================================================================
// Types
// ============================================================================

export type WizardStep =
  | 'providers'
  | 'api-keys'
  | 'models'
  | 'embedding'
  | 'image'
  | 'confirm'

export interface ProviderInfo {
  id: string
  displayName: string
  description: string
  abbreviation: string
  colors: { bg: string; text: string; icon: string }
  capabilities: {
    chat: boolean
    imageGeneration: boolean
    embeddings: boolean
    webSearch: boolean
  }
  configRequirements: {
    requiresApiKey: boolean
    requiresBaseUrl: boolean
    apiKeyLabel?: string
    baseUrlLabel?: string
    baseUrlDefault?: string
    baseUrlPlaceholder?: string
  }
}

/**
 * Shown in the key field for a key that already exists (settings mode). It is
 * never a real key: validating with it untouched tests the stored key.
 */
export const EXISTING_KEY_MASK = '********'

export interface ApiKeyEntry {
  label: string
  key: string
  validated: boolean
  apiKeyId?: string
  /**
   * True when this wizard run stored the key. Re-validating with a different
   * key then replaces that row's value instead of adding another; a key the
   * operator already had is never overwritten.
   */
  storedByWizard?: boolean
  error?: string
}

export interface ChatConfig {
  provider: string
  model: string
}

export interface CheapConfig {
  strategy: 'PROVIDER_CHEAPEST' | 'USER_DEFINED'
  provider?: string
  model?: string
}

export interface EmbeddingConfig {
  provider: string
  model: string
  dimensions?: number
}

export interface ImageConfig {
  provider: string
  model: string
}

export type TestStatus = 'pending' | 'testing' | 'success' | 'error'

export interface WizardState {
  currentStep: WizardStep
  availableProviders: ProviderInfo[]
  selectedProviders: string[]
  apiKeys: Record<string, ApiKeyEntry>
  baseUrls: Record<string, string>
  availableModels: Record<string, string[]>
  chatConfig: ChatConfig
  cheapConfig: CheapConfig
  embeddingConfig: EmbeddingConfig | null
  imageConfig: ImageConfig | null
  testResults: Record<string, TestStatus>
  saving: boolean
  error: string | null
  /**
   * Settings mode only: the profiles each part was preloaded from, so Save can
   * keep or update them instead of creating duplicates (#268).
   */
  existingProfiles: {
    chat?: ExistingProfileRef
    cheap?: ExistingProfileRef
    embedding?: ExistingProfileRef
    image?: ExistingProfileRef
  }
  /** Settings mode only: names already taken, per profile kind. */
  takenProfileNames: {
    connection: string[]
    embedding: string[]
    image: string[]
  }
}

// ============================================================================
// Actions
// ============================================================================

export type WizardAction =
  | { type: 'SET_STEP'; step: WizardStep }
  | { type: 'SET_AVAILABLE_PROVIDERS'; providers: ProviderInfo[] }
  | { type: 'TOGGLE_PROVIDER'; providerId: string }
  | { type: 'SET_API_KEY'; providerId: string; entry: ApiKeyEntry }
  /** The key or base URL was edited after validating: it must be validated again (#332). */
  | { type: 'INVALIDATE_API_KEY'; providerId: string }
  | { type: 'SET_BASE_URL'; providerId: string; url: string }
  | { type: 'SET_AVAILABLE_MODELS'; providerId: string; models: string[] }
  | { type: 'SET_CHAT_CONFIG'; config: Partial<ChatConfig> }
  | { type: 'SET_CHEAP_CONFIG'; config: Partial<CheapConfig> }
  | { type: 'SET_EMBEDDING_CONFIG'; config: EmbeddingConfig | null }
  | { type: 'SET_IMAGE_CONFIG'; config: ImageConfig | null }
  | { type: 'SET_TEST_RESULT'; key: string; status: TestStatus }
  | { type: 'SET_SAVING'; saving: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'LOAD_EXISTING_CONFIG'; state: Partial<WizardState> }

// ============================================================================
// Initial State
// ============================================================================

export const INITIAL_WIZARD_STATE: WizardState = {
  currentStep: 'providers',
  availableProviders: [],
  selectedProviders: [],
  apiKeys: {},
  baseUrls: {},
  availableModels: {},
  chatConfig: { provider: '', model: '' },
  cheapConfig: { strategy: 'PROVIDER_CHEAPEST' },
  embeddingConfig: null,
  imageConfig: null,
  testResults: {},
  saving: false,
  error: null,
  existingProfiles: {},
  takenProfileNames: { connection: [], embedding: [], image: [] },
}

// ============================================================================
// Step ordering
// ============================================================================

export const WIZARD_STEPS: WizardStep[] = [
  'providers',
  'api-keys',
  'models',
  'embedding',
  'image',
  'confirm',
]

export const STEP_LABELS: Record<WizardStep, string> = {
  providers: 'Providers',
  'api-keys': 'API Keys',
  models: 'Models',
  embedding: 'Embeddings',
  image: 'Images',
  confirm: 'Confirm',
}

// ============================================================================
// Reducer
// ============================================================================

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, currentStep: action.step, error: null }

    case 'SET_AVAILABLE_PROVIDERS':
      return { ...state, availableProviders: action.providers }

    case 'TOGGLE_PROVIDER': {
      const isSelected = state.selectedProviders.includes(action.providerId)
      const selectedProviders = isSelected
        ? state.selectedProviders.filter((id) => id !== action.providerId)
        : [...state.selectedProviders, action.providerId]
      if (!isSelected) return { ...state, selectedProviders }
      // Deselecting: nothing may still point at the removed provider, or Save
      // would create its profiles anyway (#331).
      const removed = action.providerId
      return {
        ...state,
        selectedProviders,
        chatConfig:
          state.chatConfig.provider === removed ? { provider: '', model: '' } : state.chatConfig,
        cheapConfig:
          state.cheapConfig.provider === removed
            ? { strategy: 'PROVIDER_CHEAPEST' }
            : state.cheapConfig,
        embeddingConfig:
          state.embeddingConfig?.provider === removed ? null : state.embeddingConfig,
        imageConfig: state.imageConfig?.provider === removed ? null : state.imageConfig,
      }
    }

    case 'INVALIDATE_API_KEY': {
      const entry = state.apiKeys[action.providerId]
      if (!entry?.validated) return state
      return {
        ...state,
        apiKeys: { ...state.apiKeys, [action.providerId]: { ...entry, validated: false } },
      }
    }

    case 'SET_API_KEY':
      return {
        ...state,
        apiKeys: { ...state.apiKeys, [action.providerId]: action.entry },
      }

    case 'SET_BASE_URL': {
      // An emptied field means "no URL", not an empty-string URL.
      const { [action.providerId]: _previous, ...rest } = state.baseUrls
      void _previous
      return {
        ...state,
        baseUrls: action.url ? { ...rest, [action.providerId]: action.url } : rest,
      }
    }

    case 'SET_AVAILABLE_MODELS':
      return {
        ...state,
        availableModels: { ...state.availableModels, [action.providerId]: action.models },
      }

    case 'SET_CHAT_CONFIG':
      return { ...state, chatConfig: { ...state.chatConfig, ...action.config } }

    case 'SET_CHEAP_CONFIG':
      return { ...state, cheapConfig: { ...state.cheapConfig, ...action.config } }

    case 'SET_EMBEDDING_CONFIG':
      return { ...state, embeddingConfig: action.config }

    case 'SET_IMAGE_CONFIG':
      return { ...state, imageConfig: action.config }

    case 'SET_TEST_RESULT':
      return {
        ...state,
        testResults: { ...state.testResults, [action.key]: action.status },
      }

    case 'SET_SAVING':
      return { ...state, saving: action.saving }

    case 'SET_ERROR':
      return { ...state, error: action.error }

    case 'LOAD_EXISTING_CONFIG':
      return { ...state, ...action.state }

    default:
      return state
  }
}

// ============================================================================
// Derived state
// ============================================================================

/** The selected providers that have a capability, in selection order. */
export function providersWithCapability(
  state: Pick<WizardState, 'selectedProviders' | 'availableProviders'>,
  capability: 'chat' | 'embeddings' | 'imageGeneration',
): ProviderInfo[] {
  return state.selectedProviders
    .map((id) => state.availableProviders.find((p) => p.id === id))
    .filter((p): p is ProviderInfo => p !== undefined && p.capabilities[capability])
}

// ============================================================================
// Hook
// ============================================================================

export function useProviderWizardState() {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD_STATE)

  const currentStepIndex = WIZARD_STEPS.indexOf(state.currentStep)

  const goNext = useCallback(() => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < WIZARD_STEPS.length) {
      dispatch({ type: 'SET_STEP', step: WIZARD_STEPS[nextIndex] })
    }
  }, [currentStepIndex])

  const goBack = useCallback(() => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      dispatch({ type: 'SET_STEP', step: WIZARD_STEPS[prevIndex] })
    }
  }, [currentStepIndex])

  const canGoBack = currentStepIndex > 0
  const isLastStep = currentStepIndex === WIZARD_STEPS.length - 1

  /** Check if at least one selected provider has chat capability */
  const hasValidChatProvider = providersWithCapability(state, 'chat').length > 0

  /** Check if all selected providers have validated API keys (or don't need them) */
  const allKeysValidated = state.selectedProviders.every((id) => {
    const provider = state.availableProviders.find((p) => p.id === id)
    if (!provider?.configRequirements.requiresApiKey) return true
    return state.apiKeys[id]?.validated === true
  })

  return {
    state,
    dispatch,
    goNext,
    goBack,
    canGoBack,
    isLastStep,
    currentStepIndex,
    hasValidChatProvider,
    allKeysValidated,
  }
}
