/**
 * POST /api/v1/embedding-profiles?action=test embeds one short text with an
 * unsaved profile's settings, so the setup wizard's Test All checks the
 * embedding step instead of reporting "all tests passed" after testing chat
 * alone. Nothing is stored.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/embedding/embedding-service', () => ({
  ...jest.requireActual('@/lib/embedding/embedding-service'),
  generateEmbedding: jest.fn(),
}))

import { POST } from '../../../../../../app/api/v1/embedding-profiles/route'
import { generateEmbedding } from '../../../../../../lib/embedding/embedding-service'
import { getServerSession } from '../../../../../../lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '../../../../../../lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '../../../../lib/fixtures/mock-repositories'

const KEY_ID = '44444444-4444-4444-8444-444444444444'
const mockRepos = createMockRepositoryContainer() as any

function testReq(body: unknown) {
  const url = 'http://localhost/api/v1/embedding-profiles?action=test'
  return { url, nextUrl: new URL(url), method: 'POST', headers: new Headers(), json: async () => body } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue(mockRepos)
  jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos)
  setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos)
  mockRepos.connections.findApiKeyById.mockImplementation(async (id: string) =>
    id === KEY_ID ? { id, provider: 'OPENAI', label: 'k', isActive: true } : null,
  )
  mockRepos.embeddingProfiles.create = jest.fn()
})

describe('POST /api/v1/embedding-profiles?action=test', () => {
  it('reports success with the returned width, and stores nothing', async () => {
    jest.mocked(generateEmbedding).mockResolvedValue({ embedding: new Float32Array(3), model: 'm', dimensions: 1536, provider: 'OPENAI' } as never)
    const res = await POST(testReq({ provider: 'OPENAI', modelName: 'text-embedding-3-small', apiKeyId: KEY_ID }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, dimensions: 1536 })
    expect(generateEmbedding).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ provider: 'OPENAI', modelName: 'text-embedding-3-small', apiKeyId: KEY_ID }),
      expect.any(String),
    )
    expect(mockRepos.embeddingProfiles.create).not.toHaveBeenCalled()
  })

  it('reports the provider error as a failed test, not a server error', async () => {
    jest.mocked(generateEmbedding).mockRejectedValue(new Error('Incorrect API key provided') as never)
    const res = await POST(testReq({ provider: 'OPENAI', modelName: 'text-embedding-3-small', apiKeyId: KEY_ID }))
    expect(await res.json()).toMatchObject({ success: false, error: 'Incorrect API key provided' })
  })

  it('passes a Built-in profile without calling a provider', async () => {
    const res = await POST(testReq({ provider: 'BUILTIN', modelName: 'tfidf-bm25-v1' }))
    expect(await res.json()).toMatchObject({ success: true })
    expect(generateEmbedding).not.toHaveBeenCalled()
  })

  it('refuses a key that does not exist', async () => {
    const res = await POST(testReq({ provider: 'OPENAI', modelName: 'x', apiKeyId: '55555555-5555-4555-8555-555555555555' }))
    expect(res.status).toBe(404)
  })
})
