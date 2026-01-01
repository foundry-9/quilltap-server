/**
 * Unit tests for Character Controlled-By API Route
 * Tests: PATCH /api/characters/:id/controlled-by
 *
 * Tests the controlled-by toggle endpoint for switching
 * character control between 'user' and 'llm'.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { NextRequest } from 'next/server'

// Mock dependencies before imports
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}))

jest.mock('@/lib/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => mockLogger),
  }
  return { logger: mockLogger }
})

// Get mocked modules using requireMock
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}
const sessionMock = jest.requireMock('@/lib/auth/session') as {
  getServerSession: jest.Mock
}
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: {
    info: jest.Mock
    debug: jest.Mock
    warn: jest.Mock
    error: jest.Mock
  }
}

const mockGetRepositories = repositoriesMock.getRepositories
const mockGetServerSession = sessionMock.getServerSession
const mockLogger = loggerMock.logger

// Declare route handlers
let PATCH: typeof import('@/app/api/characters/[id]/controlled-by/route').PATCH

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

// Mock session data
const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2024-12-31T00:00:00.000Z',
}

// Mock character data
const mockCharacterLlmControlled = {
  id: 'char-1',
  userId: 'user-123',
  name: 'Alice',
  controlledBy: 'llm',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockCharacterUserControlled = {
  id: 'char-2',
  userId: 'user-123',
  name: 'Bob',
  controlledBy: 'user',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

describe('Character Controlled-By API Route', () => {
  let mockCharactersRepo: {
    findById: jest.Mock
    setControlledBy: jest.Mock
  }
  let mockUsersRepo: {
    findById: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repositories
    mockCharactersRepo = {
      findById: jest.fn(),
      setControlledBy: jest.fn(),
    }
    mockUsersRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-123',
        email: 'test@example.com',
        name: 'Test User',
      }),
    }

    mockGetRepositories.mockReturnValue({
      characters: mockCharactersRepo,
      users: mockUsersRepo,
    } as any)

    // Default session mock
    mockGetServerSession.mockResolvedValue(mockSession)

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/characters/[id]/controlled-by/route')
      PATCH = routeModule.PATCH
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // PATCH /api/characters/:id/controlled-by Tests
  // ============================================================================
  describe('PATCH /api/characters/:id/controlled-by', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('char-1') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })

      it('should return 401 when session has no user id', async () => {
        mockGetServerSession.mockResolvedValue({ user: {}, expires: '2024-12-31' })

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('char-1') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Character Not Found', () => {
      it('should return 404 when character does not exist', async () => {
        mockCharactersRepo.findById.mockResolvedValue(null)

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('nonexistent') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Character not found')
      })

      it('should return 404 when character belongs to different user', async () => {
        mockCharactersRepo.findById.mockResolvedValue({
          ...mockCharacterLlmControlled,
          userId: 'other-user-456',
        })

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('char-1') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Character not found')
      })
    })

    describe('Successful Toggle', () => {
      it('should toggle from llm to user', async () => {
        mockCharactersRepo.findById.mockResolvedValue(mockCharacterLlmControlled)
        mockCharactersRepo.setControlledBy.mockResolvedValue({
          ...mockCharacterLlmControlled,
          controlledBy: 'user',
        })

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('char-1') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.character.controlledBy).toBe('user')
        expect(mockCharactersRepo.setControlledBy).toHaveBeenCalledWith('char-1', 'user')
      })

      it('should toggle from user to llm', async () => {
        mockCharactersRepo.findById.mockResolvedValue(mockCharacterUserControlled)
        mockCharactersRepo.setControlledBy.mockResolvedValue({
          ...mockCharacterUserControlled,
          controlledBy: 'llm',
        })

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('char-2') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.character.controlledBy).toBe('llm')
        expect(mockCharactersRepo.setControlledBy).toHaveBeenCalledWith('char-2', 'llm')
      })

      it('should log info on successful toggle', async () => {
        mockCharactersRepo.findById.mockResolvedValue(mockCharacterLlmControlled)
        mockCharactersRepo.setControlledBy.mockResolvedValue({
          ...mockCharacterLlmControlled,
          controlledBy: 'user',
        })

        const request = createRequest()
        await PATCH(request, { params: createParams('char-1') })

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Character controlledBy toggled',
          expect.objectContaining({
            characterId: 'char-1',
            controlledBy: 'user',
          })
        )
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockCharactersRepo.findById.mockRejectedValue(new Error('Database error'))

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('char-1') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to toggle controlled-by')
      })

      it('should log error on failure', async () => {
        const testError = new Error('Database connection lost')
        mockCharactersRepo.findById.mockRejectedValue(testError)

        const request = createRequest()
        await PATCH(request, { params: createParams('char-1') })

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error toggling character controlledBy',
          expect.objectContaining({
            context: 'PATCH /api/characters/[id]/controlled-by',
          }),
          testError
        )
      })

      it('should return 500 when setControlledBy fails', async () => {
        mockCharactersRepo.findById.mockResolvedValue(mockCharacterLlmControlled)
        mockCharactersRepo.setControlledBy.mockRejectedValue(new Error('Update failed'))

        const request = createRequest()
        const response = await PATCH(request, { params: createParams('char-1') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to toggle controlled-by')
      })
    })
  })
})
