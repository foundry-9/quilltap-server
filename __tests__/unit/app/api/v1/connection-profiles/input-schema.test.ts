/**
 * Connection-profile create and update validate through one schema
 * (`lib/llm/connection-profile-input.ts`) and share the database rules
 * (`checkConnectionProfileReferences`). The copies they replaced disagreed:
 * create stored a `null` or string `parameters`, coerced `courierDeltaMode`
 * and silently turned a bad `pseudoToolMode` into `'auto'`.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

// The provider registry needs loaded plugins; these are the questions the
// create route asks of it (`requiresBaseUrl` is stubbed in jest.setup.ts).
jest.mock('@/lib/plugins/provider-registry', () => ({
  ...jest.requireActual('@/lib/plugins/provider-registry'),
  profileRunsThinkingTurn: () => false,
}))
jest.mock('@/lib/llm/attachment-support', () => ({
  ...jest.requireActual('@/lib/llm/attachment-support'),
  supportsMimeType: () => true,
}))
import { POST } from '../../../../../../app/api/v1/connection-profiles/route'
import { PUT } from '../../../../../../app/api/v1/connection-profiles/[id]/route'
import { getServerSession } from '../../../../../../lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '../../../../../../lib/repositories/factory'
import { createMockRepositoryContainer, setupAuthMocks } from '../../../../lib/fixtures/mock-repositories'

const USER = 'user-123'
const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const COURIER_ID = '33333333-3333-4333-8333-333333333333'
const KEY_ID = '44444444-4444-4444-8444-444444444444'

const mockRepos = createMockRepositoryContainer() as any

function request(url: string, method: string, body: unknown) {
  return { url, nextUrl: new URL(url), method, headers: new Headers(), json: async () => body } as any
}

const createReq = (body: unknown) => request('http://localhost/api/v1/connection-profiles', 'POST', body)
const updateReq = (body: unknown) => request(`http://localhost/api/v1/connection-profiles/${PROFILE_ID}`, 'PUT', body)
const params = { params: Promise.resolve({ id: PROFILE_ID }) }

const existing = { id: PROFILE_ID, userId: USER, name: 'Main', provider: 'OPENAI', transport: 'api', tags: [] }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getRepositories).mockReturnValue(mockRepos)
  jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos)
  setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos)
  mockRepos.connections.findByUserId = jest.fn(async () => [existing])
  mockRepos.connections.findById.mockImplementation(async (id: string) => {
    if (id === PROFILE_ID) return existing
    if (id === OTHER_ID) return { id, userId: USER, transport: 'api' }
    if (id === COURIER_ID) return { id, userId: USER, transport: 'courier' }
    return null
  })
  mockRepos.connections.findApiKeyById.mockImplementation(async (id: string) =>
    id === KEY_ID ? { id, provider: 'OPENAI', label: 'k', isActive: true } : null,
  )
  mockRepos.connections.create.mockImplementation(async (data: any) => ({ id: 'new', ...data }))
  mockRepos.connections.update.mockImplementation(async (id: string, data: any) => ({ ...existing, id, ...data }))
  mockRepos.tags.findById = jest.fn(async () => null)
})

describe('POST /api/v1/connection-profiles', () => {
  const minimal = { name: '  Fresh  ', provider: 'OPENAI', modelName: 'gpt-x' }

  it('creates with entity defaults and a trimmed name', async () => {
    const res = await POST(createReq(minimal))
    expect(res.status).toBe(201)
    const data = mockRepos.connections.create.mock.calls[0][0]
    expect(data).toMatchObject({
      name: 'Fresh',
      transport: 'api',
      parameters: {},
      isDefault: false,
      pseudoToolMode: 'auto',
      maxImagesPerRequest: 4,
      apiKeyId: null,
      sortIndex: 1,
    })
  })

  it.each([
    ['a null parameters', { parameters: null }],
    ['a string parameters', { parameters: 'temp=1' }],
    ['an unknown pseudoToolMode', { pseudoToolMode: 'smoke-signals' }],
    ['a string courierDeltaMode', { courierDeltaMode: 'yes' }],
    ['a non-boolean isDefault', { isDefault: 'true' }],
    ['an unknown model class', { modelClass: 'Gargantuan' }],
    ['a negative maxContext', { maxContext: -4 }],
    ['an unknown key', { colour: 'teal' }],
    ['a blank name', { name: '   ' }],
  ])('refuses %s with 400 and creates nothing', async (_label, extra) => {
    const res = await POST(createReq({ ...minimal, ...extra }))
    expect(res.status).toBe(400)
    expect(mockRepos.connections.create).not.toHaveBeenCalled()
  })

  it('says what was wrong in the message', async () => {
    const res = await POST(createReq({ ...minimal, name: '' }))
    const body = await res.json()
    expect(body.message).toContain('Name is required')
  })

  it('forces a Courier profile off keys, tools and images', async () => {
    const res = await POST(createReq({
      ...minimal, transport: 'courier', apiKeyId: KEY_ID, allowToolUse: true, supportsImageUpload: true, pseudoToolMode: 'native',
    }))
    expect(res.status).toBe(201)
    expect(mockRepos.connections.create.mock.calls[0][0]).toMatchObject({
      apiKeyId: null, allowToolUse: false, supportsImageUpload: false, pseudoToolMode: 'auto',
    })
  })

  it('refuses a Courier fallback', async () => {
    const res = await POST(createReq({ ...minimal, fallbackProfileId: COURIER_ID }))
    expect(res.status).toBe(400)
  })

  it('treats an empty fallback, base URL and model class as cleared', async () => {
    const res = await POST(createReq({ ...minimal, fallbackProfileId: '', baseUrl: '', modelClass: '' }))
    expect(res.status).toBe(201)
    expect(mockRepos.connections.create.mock.calls[0][0]).toMatchObject({ fallbackProfileId: null, baseUrl: null, modelClass: null })
  })
})

describe('PUT /api/v1/connection-profiles/[id]', () => {
  it('writes only what was sent', async () => {
    const res = await PUT(updateReq({ isCheap: true }), params)
    expect(res.status).toBe(200)
    expect(mockRepos.connections.update).toHaveBeenCalledWith(PROFILE_ID, { isCheap: true })
  })

  it('clears a nullable field sent as null, and ignores a null counter', async () => {
    await PUT(updateReq({ fallbackProfileId: null, maxContext: 0, maxImagesPerRequest: null }), params)
    expect(mockRepos.connections.update).toHaveBeenCalledWith(PROFILE_ID, { fallbackProfileId: null, maxContext: null })
  })

  it('refuses a profile as its own fallback', async () => {
    const res = await PUT(updateReq({ fallbackProfileId: PROFILE_ID }), params)
    expect(res.status).toBe(400)
    expect(mockRepos.connections.update).not.toHaveBeenCalled()
  })

  it('refuses an API key for another provider', async () => {
    const res = await PUT(updateReq({ provider: 'ANTHROPIC', apiKeyId: KEY_ID }), params)
    expect(res.status).toBe(400)
  })

  it('refuses a bad pseudoToolMode and a non-object parameters', async () => {
    expect((await PUT(updateReq({ pseudoToolMode: 'x' }), params)).status).toBe(400)
    expect((await PUT(updateReq({ parameters: [] }), params)).status).toBe(400)
    expect(mockRepos.connections.update).not.toHaveBeenCalled()
  })

  it('accepts a sortIndex and refuses a negative one', async () => {
    expect((await PUT(updateReq({ sortIndex: 3 }), params)).status).toBe(200)
    expect((await PUT(updateReq({ sortIndex: -1 }), params)).status).toBe(400)
  })
})
