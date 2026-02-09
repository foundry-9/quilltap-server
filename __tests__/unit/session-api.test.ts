/**
 * Unit tests for session API route
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/session/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositoriesSafe } from '@/lib/repositories/factory'

const mockGetServerSession = jest.mocked(getServerSession)
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe)

describe('GET /api/v1/session', () => {
  const mockUser = {
    id: 'user-123',
    email: 'user@example.com',
    username: 'testUser',
  }

  const mockSession = {
    user: { id: 'user-123', email: 'user@example.com' },
    expires: '2099-01-01T00:00:00.000Z',
  }

  const mockRepos = {
    users: {
      findById: jest.fn().mockResolvedValue(mockUser),
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue(mockSession as any)
    mockGetRepositoriesSafe.mockResolvedValue(mockRepos as any)
  })

  it('returns session user data when available', async () => {
    const request = new NextRequest('http://localhost:3000/api/v1/session')
    const res = await GET(request)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.user).toEqual({ id: 'user-123', email: 'user@example.com' })
    expect(data.expires).toBe('2099-01-01T00:00:00.000Z')
  })

  it('returns 500 when session is missing', async () => {
    mockGetServerSession.mockResolvedValue(null as any)

    const request = new NextRequest('http://localhost:3000/api/v1/session')
    const res = await GET(request)
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.error).toBe('Internal server error')
  })
})
