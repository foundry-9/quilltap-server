import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals'

jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}))

jest.mock('@/lib/mongodb/repositories', () => ({
  getRepositories: jest.fn(),
}))

type RouteModule = typeof import('@/app/api/characters/[id]/prompts/route')
type SessionModule = typeof import('@/lib/auth/session')
type RepositoriesModule = typeof import('@/lib/mongodb/repositories')

let GET: RouteModule['GET']
let POST: RouteModule['POST']
let mockGetServerSession: jest.MockedFunction<SessionModule['getServerSession']>
let mockGetRepositories: jest.MockedFunction<RepositoriesModule['getRepositories']>

const buildContext = (id: string = 'char-1') => ({
  params: Promise.resolve({ id }),
})

describe('Character System Prompts API', () => {
  beforeAll(async () => {
    const routeModule = await import('@/app/api/characters/[id]/prompts/route')
    GET = routeModule.GET
    POST = routeModule.POST

    const sessionModule = await import('@/lib/auth/session')
    mockGetServerSession = sessionModule.getServerSession as jest.MockedFunction<SessionModule['getServerSession']>

    const reposModule = await import('@/lib/mongodb/repositories')
    mockGetRepositories = reposModule.getRepositories as jest.MockedFunction<RepositoriesModule['getRepositories']>
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetRepositories.mockReset()
  })

  it('returns prompts for the owning user', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const systemPrompts = [
      { id: 'p1', name: 'Default', content: 'You are {{char}}.', isDefault: true },
      { id: 'p2', name: 'Battle', content: 'Protect {{user}}.', isDefault: false },
    ]

    mockGetRepositories.mockReturnValue({
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: 'char-1',
          userId: 'user-1',
          systemPrompts,
        }),
      },
    } as any)

    const response = await GET(new Request('http://test.local/api/characters/char-1/prompts'), buildContext())
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(systemPrompts)
  })

  it('returns 403 when character belongs to another user', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const findById = jest.fn().mockResolvedValue({
      id: 'char-1',
      userId: 'user-2',
      systemPrompts: [],
    })
    mockGetRepositories.mockReturnValue({ characters: { findById } } as any)

    const response = await GET(new Request('http://test.local/api/characters/char-1/prompts'), buildContext())
    expect(response.status).toBe(403)
    const payload = await response.json()
    expect(payload.error).toBe('Forbidden')
  })

  it('creates a new prompt via POST and returns 201', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const addSystemPrompt = jest.fn().mockResolvedValue({
      id: 'prompt-new',
      name: 'Mission',
      content: 'Stay focused, {{char}}.',
      isDefault: true,
    })

    mockGetRepositories.mockReturnValue({
      characters: {
        findById: jest.fn().mockResolvedValue({
          id: 'char-1',
          userId: 'user-1',
          systemPrompts: [],
        }),
        addSystemPrompt,
      },
    } as any)

    const request = new Request('http://test.local/api/characters/char-1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mission',
        content: 'Stay focused, {{char}}.',
        isDefault: true,
      }),
    })

    const response = await POST(request, buildContext())
    expect(response.status).toBe(201)
    const data = await response.json()
    expect(data).toMatchObject({ id: 'prompt-new', name: 'Mission', isDefault: true })
    expect(addSystemPrompt).toHaveBeenCalledWith('char-1', {
      name: 'Mission',
      content: 'Stay focused, {{char}}.',
      isDefault: true,
    })
  })

  it('returns 400 for invalid prompt payloads', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)
    mockGetRepositories.mockReturnValue({
      characters: {
        findById: jest.fn(),
        addSystemPrompt: jest.fn(),
      },
    } as any)

    const request = new Request('http://test.local/api/characters/char-1/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '',
        content: '',
      }),
    })

    const response = await POST(request, buildContext())
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(Array.isArray(body.error)).toBe(true)
  })
})
