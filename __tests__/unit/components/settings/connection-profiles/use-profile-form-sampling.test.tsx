/**
 * #256 — a profile saved with `parameters: {}` (the setup wizard's) must not
 * come back from an unrelated edit with invented sampling values. An unset
 * knob stays unset, and the provider keeps its own default.
 */

import { act, renderHook } from '@testing-library/react'
import { useProfileForm } from '@/components/settings/connection-profiles/hooks/useProfileForm'
import type { ConnectionProfile, ProviderConfig } from '@/components/settings/connection-profiles/types'

jest.mock('@/lib/fetch-helpers', () => ({ fetchJson: jest.fn() }))

const PROVIDERS = [
  {
    name: 'ANTHROPIC',
    displayName: 'Anthropic',
    configRequirements: { requiresApiKey: true, requiresBaseUrl: false },
    capabilities: { chat: true, toolUse: true },
  },
] as unknown as ProviderConfig[]

const wizardProfile = {
  id: 'p1',
  name: 'Anthropic - claude-haiku-5-5',
  provider: 'ANTHROPIC',
  modelName: 'claude-haiku-5-5',
  apiKeyId: null,
  baseUrl: null,
  isDefault: true,
  parameters: {},
} as unknown as ConnectionProfile

describe('useProfileForm sampling parameters', () => {
  it('leaves absent sampling values absent on save', () => {
    const { result } = renderHook(() => useProfileForm(PROVIDERS, []))
    act(() => result.current.loadProfileIntoForm(wizardProfile))
    expect(result.current.form.formData.maxTokens).toBeNull()
    const body = result.current.buildRequestBody() as { parameters: Record<string, unknown> }
    expect(body.parameters).not.toHaveProperty('max_tokens')
    expect(body.parameters).not.toHaveProperty('temperature')
    expect(body.parameters).not.toHaveProperty('top_p')
  })

  it('still sends a value the profile stores', () => {
    const { result } = renderHook(() => useProfileForm(PROVIDERS, []))
    act(() =>
      result.current.loadProfileIntoForm({
        ...wizardProfile,
        parameters: { max_tokens: 2048, temperature: 0.4 },
      } as unknown as ConnectionProfile),
    )
    const body = result.current.buildRequestBody() as { parameters: Record<string, unknown> }
    expect(body.parameters).toMatchObject({ max_tokens: 2048, temperature: 0.4 })
    expect(body.parameters).not.toHaveProperty('top_p')
  })
})
