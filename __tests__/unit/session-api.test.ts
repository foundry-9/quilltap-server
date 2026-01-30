/**
 * Unit tests for session API route
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { GET } from '@/app/api/v1/session/route'
import { getServerSession } from '@/lib/auth/session'

const mockGetServerSession = jest.mocked(getServerSession)

describe('GET /api/v1/session', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns session user data when available', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123', email: 'user@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    } as any)

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.user).toEqual({ id: 'user-123', email: 'user@example.com' })
    expect(data.expires).toBe('2099-01-01T00:00:00.000Z')
  })

  it('returns 500 when session is missing', async () => {
    mockGetServerSession.mockResolvedValue(null as any)

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.error).toBe('Failed to get session')
  })
})
