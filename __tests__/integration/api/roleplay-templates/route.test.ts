import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/roleplay-templates/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories } from '@/lib/repositories/factory'

jest.mock('@/lib/auth/session')
jest.mock('@/lib/repositories/factory', () => ({
  __esModule: true,
  getRepositories: jest.fn(),
}))

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>
const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

const buildRequest = (method: string, body?: Record<string, unknown>) =>
  new Request('http://test.local/api/roleplay-templates', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest

describe('Roleplay Templates API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns templates sorted with built-ins first when authenticated', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    mockGetRepositories.mockReturnValue({
      users: {
        findById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
      },
      roleplayTemplates: {
        findAllForUser: jest.fn().mockResolvedValue([
          { id: 'user-2', name: 'Zany Format', isBuiltIn: false },
          { id: 'built-1', name: 'Classic', isBuiltIn: true },
          { id: 'built-2', name: 'Action', isBuiltIn: true },
        ]),
      },
    } as any)

    const response = await GET(buildRequest('GET'))
    expect(response.status).toBe(200)
    const templates = await response.json()
    expect(templates.map((t: any) => t.name)).toEqual(['Action', 'Classic', 'Zany Format'])
    expect(templates[0].isBuiltIn).toBe(true)
    expect(templates[templates.length - 1].isBuiltIn).toBe(false)
  })

  it('rejects duplicate template names on POST', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    mockGetRepositories.mockReturnValue({
      users: {
        findById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
      },
      roleplayTemplates: {
        findAllForUser: jest.fn(),
        findByName: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn(),
      },
    } as any)

    const response = await POST(buildRequest('POST', {
      name: 'Classic',
      systemPrompt: 'Use italics for actions.',
    }))

    expect(response.status).toBe(409)
    const payload = await response.json()
    expect(payload.error).toMatch(/already exists/i)
  })

  it('creates a template when payload is valid and unique', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'user-1' } } as any)

    const create = jest.fn().mockResolvedValue({
      id: 'rp-new',
      name: 'Heroic',
      systemPrompt: '*{{char}}* stands ready.',
      description: 'Adds bold cues',
      isBuiltIn: false,
    })

    mockGetRepositories.mockReturnValue({
      users: {
        findById: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@example.com' }),
      },
      roleplayTemplates: {
        findAllForUser: jest.fn(),
        findByName: jest.fn().mockResolvedValue(null),
        create,
      },
    } as any)

    const response = await POST(buildRequest('POST', {
      name: 'Heroic',
      description: 'Adds bold cues',
      systemPrompt: '*{{char}}* stands ready.',
    }))

    expect(response.status).toBe(201)
    const payload = await response.json()
    expect(payload).toMatchObject({ id: 'rp-new', name: 'Heroic' })
    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'Heroic',
      description: 'Adds bold cues',
      systemPrompt: '*{{char}}* stands ready.',
      isBuiltIn: false,
      tags: [],
    })
  })

  it('requires auth for GET requests', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(buildRequest('GET'))
    expect(response.status).toBe(401)
  })
})
