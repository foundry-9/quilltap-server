/**
 * @jest-environment node
 *
 * `isWebSearchConfigured(userId)` — whether a web search would have a backend
 * to run on. A registered provider that needs an API key and has none is not
 * configured: offering `search_web` then only buys a failure on every call.
 */

import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'

jest.mock('@/lib/plugins/search-provider-registry', () => ({
  searchProviderRegistry: { getDefaultProvider: jest.fn() },
}))
jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}))

import { searchProviderRegistry } from '@/lib/plugins/search-provider-registry'
import { getUserRepositories } from '@/lib/repositories/user-scoped'

const provider = (requiresApiKey: boolean) =>
  ({ metadata: { providerName: 'SERPER', displayName: 'Serper' }, config: { requiresApiKey } }) as never

const withKeys = (keys: Array<{ provider: string; isActive: boolean; key_value: string }>) =>
  jest.mocked(getUserRepositories).mockReturnValue({
    connections: { getAllApiKeys: jest.fn(async () => keys) },
  } as never)

const originalEnv = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv }
  delete process.env.SERPER_API_KEY
})

afterAll(() => {
  process.env = originalEnv
})

describe('isWebSearchConfigured', () => {
  it('is true for a provider that needs a key and has an active one', async () => {
    jest.mocked(searchProviderRegistry.getDefaultProvider).mockReturnValue(provider(true))
    withKeys([{ provider: 'SERPER', isActive: true, key_value: 'k' }])
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(true)
    expect(getUserRepositories).toHaveBeenCalledWith('user-1')
  })

  it('is false for a registered provider with no key, an inactive key, or another provider\'s key', async () => {
    jest.mocked(searchProviderRegistry.getDefaultProvider).mockReturnValue(provider(true))
    withKeys([])
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(false)
    withKeys([{ provider: 'SERPER', isActive: false, key_value: 'k' }])
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(false)
    withKeys([{ provider: 'OPENAI', isActive: true, key_value: 'k' }])
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(false)
  })

  it('does not let the legacy env var stand in for a registered provider\'s missing key', async () => {
    // The tool itself never falls back to the env var once a provider is registered.
    process.env.SERPER_API_KEY = 'legacy'
    jest.mocked(searchProviderRegistry.getDefaultProvider).mockReturnValue(provider(true))
    withKeys([])
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(false)
  })

  it('is true for a provider that needs no key, without reading any', async () => {
    jest.mocked(searchProviderRegistry.getDefaultProvider).mockReturnValue(provider(false))
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(true)
    expect(getUserRepositories).not.toHaveBeenCalled()
  })

  it('reads as not configured when the key lookup fails', async () => {
    jest.mocked(searchProviderRegistry.getDefaultProvider).mockReturnValue(provider(true))
    jest.mocked(getUserRepositories).mockImplementation(() => {
      throw new Error('database closed')
    })
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(false)
  })

  it('with no provider registered, follows the legacy env var', async () => {
    jest.mocked(searchProviderRegistry.getDefaultProvider).mockReturnValue(null as never)
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(false)
    process.env.SERPER_API_KEY = 'legacy'
    await expect(isWebSearchConfigured('user-1')).resolves.toBe(true)
  })
})
