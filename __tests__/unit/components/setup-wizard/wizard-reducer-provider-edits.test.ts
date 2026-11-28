/**
 * Provider wizard reducer: edits after configuration.
 *
 * #331 — unticking a provider left the chat, cheap, embedding and image
 * configs pointing at it, so Save still created its profiles.
 * #332 — editing a key or base URL after validating left the wizard state
 * "validated", so Next stayed enabled and Save used the earlier key and URL.
 */

import {
  INITIAL_WIZARD_STATE,
  wizardReducer,
  type WizardState,
} from '@/components/setup-wizard/useProviderWizardState'

function configured(): WizardState {
  return {
    ...INITIAL_WIZARD_STATE,
    selectedProviders: ['A', 'B'],
    apiKeys: { A: { label: 'A', key: 'k', validated: true, apiKeyId: 'key-a' } },
    baseUrls: { A: 'https://a.example' },
    chatConfig: { provider: 'A', model: 'a-chat' },
    cheapConfig: { strategy: 'USER_DEFINED', provider: 'A', model: 'a-cheap' },
    embeddingConfig: { provider: 'A', model: 'a-embed' },
    imageConfig: { provider: 'A', model: 'a-image' },
  }
}

describe('TOGGLE_PROVIDER off (#331)', () => {
  it('clears every config that names the removed provider', () => {
    const next = wizardReducer(configured(), { type: 'TOGGLE_PROVIDER', providerId: 'A' })
    expect(next.selectedProviders).toEqual(['B'])
    expect(next.chatConfig).toEqual({ provider: '', model: '' })
    expect(next.cheapConfig).toEqual({ strategy: 'PROVIDER_CHEAPEST' })
    expect(next.embeddingConfig).toBeNull()
    expect(next.imageConfig).toBeNull()
  })

  it('leaves configs for another provider alone', () => {
    const state = { ...configured(), imageConfig: { provider: 'B', model: 'b-image' } }
    const next = wizardReducer(state, { type: 'TOGGLE_PROVIDER', providerId: 'A' })
    expect(next.imageConfig).toEqual({ provider: 'B', model: 'b-image' })
  })

  it('toggling a provider on changes no config', () => {
    const state = configured()
    const next = wizardReducer(state, { type: 'TOGGLE_PROVIDER', providerId: 'C' })
    expect(next.selectedProviders).toEqual(['A', 'B', 'C'])
    expect(next.chatConfig).toBe(state.chatConfig)
    expect(next.imageConfig).toBe(state.imageConfig)
  })
})

describe('INVALIDATE_API_KEY (#332)', () => {
  it('marks a validated key unvalidated and keeps its stored id', () => {
    const next = wizardReducer(configured(), { type: 'INVALIDATE_API_KEY', providerId: 'A' })
    expect(next.apiKeys.A).toMatchObject({ validated: false, apiKeyId: 'key-a' })
  })

  it('is a no-op for a provider with no validated key', () => {
    const state = configured()
    expect(wizardReducer(state, { type: 'INVALIDATE_API_KEY', providerId: 'B' })).toBe(state)
  })
})

describe('SET_BASE_URL', () => {
  it('stores an edited URL', () => {
    const next = wizardReducer(configured(), { type: 'SET_BASE_URL', providerId: 'A', url: 'https://new.example' })
    expect(next.baseUrls.A).toBe('https://new.example')
  })

  it('removes the URL when the field is emptied', () => {
    const next = wizardReducer(configured(), { type: 'SET_BASE_URL', providerId: 'A', url: '' })
    expect('A' in next.baseUrls).toBe(false)
  })
})
