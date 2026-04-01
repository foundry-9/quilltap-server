/**
 * Tests for deprecated /api/chats/[id]/impersonate endpoint
 * This route has been deprecated and returns 410 Gone.
 * The functionality has moved to /api/v1/chats/[id]?action=impersonate or action=stop-impersonate
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { NextRequest } from 'next/server'

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(function() { return this }),
  },
}))

// Declare route handlers
let POST: typeof import('@/app/api/chats/[id]/impersonate/route').POST

/**
 * Helper to create a mock NextRequest with optional JSON body
 */
const createRequest = (body?: object): NextRequest =>
  ({
    json: async () => body ?? {},
  }) as unknown as NextRequest

/**
 * Helper to create mock params promise
 */
const createParams = (id: string): Promise<{ id: string }> =>
  Promise.resolve({ id })

describe('Impersonation API Route - Deprecated', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/chats/[id]/impersonate/route')
      POST = routeModule.POST
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('POST /api/chats/:id/impersonate', () => {
    it('should return 410 Gone for POST requests', async () => {
      const request = createRequest({ participantId: 'some-id' })
      const response = await POST(request, { params: createParams('chat-123') })
      const body = await response.json()

      expect(response.status).toBe(410)
      expect(body.error).toBe('Endpoint removed')
      expect(body.details.newEndpoint).toBeDefined()
      expect(body.details.newEndpoint).toBe('/api/v1/chats/[id]')
    })
  })
})
