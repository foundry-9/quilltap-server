import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}))

jest.mock('@/lib/mongodb/repositories', () => ({
  getRepositories: jest.fn(),
}))

type RouteModule = typeof import('@/app/api/prompt-templates/route')
type SessionModule = typeof import('@/lib/auth/session')
type RepositoriesModule = typeof import('@/lib/mongodb/repositories')

let GET: RouteModule['GET']
let POST: RouteModule['POST']
let mockGetServerSession: jest.MockedFunction<SessionModule['getServerSession']>
let mockGetRepositories: jest.MockedFunction<RepositoriesModule['getRepositories']>

describe('Prompt Templates API', () => {
  beforeAll(async () => {
    const routeModule = await import('@/app/api/prompt-templates/route')
    GET = routeModule.GET
    POST = routeModule.POST

    const sessionModule = await import('@/lib/auth/session')
    mockGetServerSession = sessionModule.getServerSession as jest.MockedFunction<SessionModule['getServerSession']>

    const repositoriesModule = await import('@/lib/mongodb/repositories')
    mockGetRepositories = repositoriesModule.getRepositories as jest.MockedFunction<RepositoriesModule['getRepositories']>
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReset()
  })

  it('requires authentication for all routes', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const getResponse = await GET()
    expect(getResponse.status).toBe(401)

    const postResponse = await POST(
      new Request('http://test.local/api/prompt-templates', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test', content: 'Example' }),
      })
    )
    expect(postResponse.status).toBe(401)
  })

  it('returns all templates available to the user', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    mockGetRepositories.mockReturnValue({
      promptTemplates: {
        findAllForUser: jest.fn().mockResolvedValue([
          { id: 'built-in', name: 'Standard', isBuiltIn: true },
          { id: 'user-1', name: 'My Prompt', isBuiltIn: false },
        ]),
      },
    } as any)

    const response = await GET()
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(2)
    expect(data[0].name).toBe('Standard')
  })

  it('creates a prompt template when payload is valid', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const create = jest.fn().mockResolvedValue({
      id: 'template-123',
      name: 'Lore Helper',
      content: 'Explain the lore of {{char}} for {{user}}.',
      isBuiltIn: false,
    })

    mockGetRepositories.mockReturnValue({
      promptTemplates: {
        findAllForUser: jest.fn(),
        create,
      },
    } as any)

    const request = new Request('http://test.local/api/prompt-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Lore Helper',
        content: 'Explain the lore of {{char}} for {{user}}.',
        description: 'Great for immersive chats',
        category: 'Storytelling',
        modelHint: 'gpt-4o',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({ id: 'template-123', name: 'Lore Helper' })
    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'Lore Helper',
      content: 'Explain the lore of {{char}} for {{user}}.',
      description: 'Great for immersive chats',
      isBuiltIn: false,
      category: 'Storytelling',
      modelHint: 'gpt-4o',
      tags: [],
    })
  })

  it('rejects invalid template payloads', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockGetRepositories.mockReturnValue({
      promptTemplates: {
        create: jest.fn(),
      },
    } as any)

    const request = new Request('http://test.local/api/prompt-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '',
        content: '',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(Array.isArray(payload.error)).toBe(true)
  })
})
