/**
 * Unit tests for Default Partner API Route
 * Tests: GET, PUT /api/characters/:id/default-partner
 *
 * Tests the default partner endpoints for characters.
 * The default partner is a user-controlled character that serves as the
 * default conversation partner ({{user}} template) for a character.
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

jest.mock('@/lib/api/middleware', () => ({
  createAuthenticatedParamsHandler: jest.fn((handler) => {
    return async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
      const session = await require('@/lib/auth/session').getServerSession()
      if (!session?.user?.id) {
        const { NextResponse } = require('next/server')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const repos = require('@/lib/repositories/factory').getRepositories()
      const params = await context.params
      return handler(req, { user: session.user, repos }, params)
    }
  }),
  checkOwnership: jest.fn((entity, userId) => {
    return entity && entity.userId === userId
  }),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

// Get mocked modules using requireMock
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
}
const sessionMock = jest.requireMock('@/lib/auth/session') as {
  getServerSession: jest.Mock
}
const middlewareMock = jest.requireMock('@/lib/api/middleware') as {
  createAuthenticatedParamsHandler: jest.Mock
  checkOwnership: jest.Mock
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
const mockCheckOwnership = middlewareMock.checkOwnership
const mockLogger = loggerMock.logger

// Declare route handlers
let GET: typeof import('@/app/api/characters/[id]/default-partner/route').GET
let PUT: typeof import('@/app/api/characters/[id]/default-partner/route').PUT

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

// Mock session data
const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2024-12-31T00:00:00.000Z',
}

// Mock character IDs (valid UUIDs)
const characterId = '550e8400-e29b-41d4-a716-446655440000'
const partnerId = '550e8400-e29b-41d4-a716-446655440001'
const llmCharacterId = '550e8400-e29b-41d4-a716-446655440002'

// Mock characters
const mockCharacter = {
  id: characterId,
  userId: 'user-123',
  name: 'Alice',
  defaultPartnerId: null,
  controlledBy: 'llm',
}

const mockPartnerCharacter = {
  id: partnerId,
  userId: 'user-123',
  name: 'User Avatar',
  controlledBy: 'user',
}

const mockLLMControlledCharacter = {
  id: llmCharacterId,
  userId: 'user-123',
  name: 'Bob',
  controlledBy: 'llm',
}

describe('Default Partner API Route', () => {
  let mockCharactersRepo: {
    findById: jest.Mock
    update: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repository
    mockCharactersRepo = {
      findById: jest.fn(),
      update: jest.fn(),
    }

    mockGetRepositories.mockReturnValue({
      characters: mockCharactersRepo,
    } as any)

    // Default session mock
    mockGetServerSession.mockResolvedValue(mockSession)

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/characters/[id]/default-partner/route')
      GET = routeModule.GET
      PUT = routeModule.PUT
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // GET /api/characters/:id/default-partner Tests
  // ============================================================================
  describe('GET /api/characters/:id/default-partner', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest()
        const response = await GET(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Character Not Found', () => {
      it('should return 404 when character does not exist', async () => {
        mockCharactersRepo.findById.mockResolvedValue(null)

        const request = createRequest()
        const response = await GET(request, { params: createParams('nonexistent') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Character not found')
      })

      it('should return 404 when character belongs to different user', async () => {
        mockCharactersRepo.findById.mockResolvedValue({
          ...mockCharacter,
          userId: 'other-user-456',
        })

        const request = createRequest()
        const response = await GET(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Character not found')
      })
    })

    describe('Successful Retrieval', () => {
      it('should return null partnerId when no default partner set', async () => {
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter)

        const request = createRequest()
        const response = await GET(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.partnerId).toBeNull()
      })

      it('should return partnerId when default partner is set', async () => {
        mockCharactersRepo.findById.mockResolvedValue({
          ...mockCharacter,
          defaultPartnerId: partnerId,
        })

        const request = createRequest()
        const response = await GET(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.partnerId).toBe(partnerId)
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockCharactersRepo.findById.mockRejectedValue(new Error('Database error'))

        const request = createRequest()
        const response = await GET(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to fetch default partner')
      })
    })
  })

  // ============================================================================
  // PUT /api/characters/:id/default-partner Tests
  // ============================================================================
  describe('PUT /api/characters/:id/default-partner', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest({ partnerId })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Validation', () => {
      beforeEach(() => {
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter)
      })

      it('should return 400 for invalid partnerId format', async () => {
        const request = createRequest({ partnerId: 'not-a-uuid' })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Validation error')
      })

      it('should return 404 when partner character does not exist', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter) // First call for main character
          .mockResolvedValueOnce(null) // Second call for partner

        const request = createRequest({ partnerId: '550e8400-e29b-41d4-a716-446655449999' })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Partner character not found')
      })

      it('should return 404 when partner belongs to different user', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter)
          .mockResolvedValueOnce({
            ...mockPartnerCharacter,
            userId: 'other-user-456',
          })

        const request = createRequest({ partnerId })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Partner character not found')
      })

      it('should return 400 when partner is not user-controlled', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter)
          .mockResolvedValueOnce(mockLLMControlledCharacter)

        const request = createRequest({ partnerId: llmCharacterId })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Partner must be a user-controlled character')
      })

      it('should return 400 when character is set as its own partner', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce({ ...mockCharacter, controlledBy: 'user' })
          .mockResolvedValueOnce({ ...mockCharacter, controlledBy: 'user' })

        const request = createRequest({ partnerId: characterId })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Character cannot be its own partner')
      })
    })

    describe('Successful Update', () => {
      beforeEach(() => {
        mockCharactersRepo.update.mockResolvedValue({
          ...mockCharacter,
          defaultPartnerId: partnerId,
        })
      })

      it('should set default partner successfully', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter)
          .mockResolvedValueOnce(mockPartnerCharacter)

        const request = createRequest({ partnerId })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.partnerId).toBe(partnerId)
      })

      it('should call update on repository', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter)
          .mockResolvedValueOnce(mockPartnerCharacter)

        const request = createRequest({ partnerId })
        await PUT(request, { params: createParams(characterId) })

        expect(mockCharactersRepo.update).toHaveBeenCalledWith(characterId, {
          defaultPartnerId: partnerId,
        })
      })

      it('should log info on successful update', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter)
          .mockResolvedValueOnce(mockPartnerCharacter)

        const request = createRequest({ partnerId })
        await PUT(request, { params: createParams(characterId) })

        expect(mockLogger.info).toHaveBeenCalledWith(
          'Default partner updated',
          expect.objectContaining({
            characterId,
            partnerId,
          })
        )
      })

      it('should clear default partner when partnerId is null', async () => {
        mockCharactersRepo.findById.mockResolvedValue({
          ...mockCharacter,
          defaultPartnerId: partnerId,
        })
        mockCharactersRepo.update.mockResolvedValue({
          ...mockCharacter,
          defaultPartnerId: null,
        })

        const request = createRequest({ partnerId: null })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.partnerId).toBeNull()
        expect(mockCharactersRepo.update).toHaveBeenCalledWith(characterId, {
          defaultPartnerId: null,
        })
      })
    })

    describe('Error Handling', () => {
      beforeEach(() => {
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter)
      })

      it('should return 500 on update error', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter)
          .mockResolvedValueOnce(mockPartnerCharacter)
        mockCharactersRepo.update.mockRejectedValue(new Error('Database error'))

        const request = createRequest({ partnerId })
        const response = await PUT(request, { params: createParams(characterId) })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to update default partner')
      })

      it('should log error on failure', async () => {
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter)
          .mockResolvedValueOnce(mockPartnerCharacter)
        const testError = new Error('Update failed')
        mockCharactersRepo.update.mockRejectedValue(testError)

        const request = createRequest({ partnerId })
        await PUT(request, { params: createParams(characterId) })

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Error updating default partner',
          expect.objectContaining({
            context: 'PUT /api/characters/:id/default-partner',
          }),
          testError
        )
      })
    })
  })
})
