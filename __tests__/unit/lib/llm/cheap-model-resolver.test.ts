/**
 * Run-time cheap-model resolution: a provider with no lasting model name
 * (Anthropic) names its background model through `resolveDefaultModel`, and
 * the host caches the answer without making the selection path async.
 */

import {
  getResolvedCheapModel,
  refreshCheapModel,
  clearCheapModelCache,
} from '@/lib/llm/cheap-model-resolver'
import { getCheapModelConfig } from '@/lib/plugins/provider-registry'
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/plugins/provider-registry', () => ({
  getCheapModelConfig: jest.fn(),
}))
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const profile = {
  provider: 'ANTHROPIC' as const,
  apiKeyId: 'key-1',
  baseUrl: null,
  userId: 'user-1',
}

const findApiKey = jest.fn()
const resolveDefaultModel = jest.fn()

beforeEach(() => {
  clearCheapModelCache()
  jest.clearAllMocks()
  findApiKey.mockResolvedValue({ key_value: 'sk-test' })
  resolveDefaultModel.mockResolvedValue('claude-haiku-newest')
  ;(getRepositories as jest.Mock).mockReturnValue({
    connections: { findApiKeyByIdAndUserId: findApiKey },
  })
  ;(getCheapModelConfig as jest.Mock).mockReturnValue({ resolveDefaultModel })
})

describe('cheap-model resolver', () => {
  it('returns null on a cold cache and starts one lookup', async () => {
    expect(getResolvedCheapModel(profile)).toBeNull()
    expect(getResolvedCheapModel(profile)).toBeNull()
    await refreshCheapModel(profile) // joins the in-flight lookup
    expect(resolveDefaultModel).toHaveBeenCalledTimes(1)
    expect(resolveDefaultModel).toHaveBeenCalledWith('sk-test', undefined)
    expect(getResolvedCheapModel(profile)).toBe('claude-haiku-newest')
  })

  it('serves a fresh answer from cache without asking again', async () => {
    await refreshCheapModel(profile)
    getResolvedCheapModel(profile)
    getResolvedCheapModel(profile)
    expect(resolveDefaultModel).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by API key', async () => {
    await refreshCheapModel(profile)
    expect(getResolvedCheapModel({ ...profile, apiKeyId: 'key-2' })).toBeNull()
  })

  it('treats a throwing resolver as no answer', async () => {
    resolveDefaultModel.mockRejectedValueOnce(new Error('network'))
    await expect(refreshCheapModel(profile)).resolves.toBeNull()
    expect(getResolvedCheapModel(profile)).toBeNull()
  })

  it('does not call the provider without a key', async () => {
    findApiKey.mockResolvedValueOnce(null)
    await expect(refreshCheapModel(profile)).resolves.toBeNull()
    expect(resolveDefaultModel).not.toHaveBeenCalled()
  })

  it('is inert for a provider that declares no resolver', async () => {
    ;(getCheapModelConfig as jest.Mock).mockReturnValue({ defaultModel: 'static' })
    expect(getResolvedCheapModel({ ...profile, provider: 'OPENAI' as never })).toBeNull()
    await expect(refreshCheapModel(profile)).resolves.toBeNull()
    expect(findApiKey).not.toHaveBeenCalled()
  })
})
