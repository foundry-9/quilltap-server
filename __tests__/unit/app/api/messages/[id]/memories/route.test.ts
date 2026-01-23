/**
 * Tests for deprecated /api/messages/[id]/memories endpoint
 * This route has been deprecated and returns 410 Gone.
 * The functionality has moved to /api/v1/memories with messageId query param
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
let GET: typeof import('@/app/api/messages/[id]/memories/route').GET

/**
 * Helper to create a mock NextRequest
 */
const createRequest = (): NextRequest =>
  ({
    json: async () => ({}),
  }) as unknown as NextRequest

/**
 * Helper to create mock params promise
 */
const createParams = (id: string): Promise<{ id: string }> =>
  Promise.resolve({ id })

describe('Message Memories API Route - Deprecated', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/messages/[id]/memories/route')
      GET = routeModule.GET
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('GET /api/messages/:id/memories', () => {
    it('should return 410 Gone for GET requests', async () => {
      const request = createRequest()
      const response = await GET(request, { params: createParams('msg-1') })
      const body = await response.json()

      expect(response.status).toBe(410)
      expect(body.error).toBe('Endpoint removed')
      expect(body.details.newEndpoint).toBeDefined()
      expect(body.details.newEndpoint).toBe('/api/v1/memories')
    })
  })
})
