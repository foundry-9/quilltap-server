/**
 * Unit tests for Impersonation API Route
 * Tests: GET, POST, DELETE /api/chats/:id/impersonate
 *
 * Tests the impersonation endpoints for multi-character chats:
 * - GET: Returns current impersonation state
 * - POST: Start impersonating a participant
 * - DELETE: Stop impersonating a participant
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
let GET: typeof import('@/app/api/chats/[id]/impersonate/route').GET
let POST: typeof import('@/app/api/chats/[id]/impersonate/route').POST
let DELETE: typeof import('@/app/api/chats/[id]/impersonate/route').DELETE

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

// Mock participant IDs (valid UUIDs)
const participantId1 = '550e8400-e29b-41d4-a716-446655440000'
const participantId2 = '550e8400-e29b-41d4-a716-446655440001'
const participantId3 = '550e8400-e29b-41d4-a716-446655440002'
const connectionProfileId = '550e8400-e29b-41d4-a716-446655440010'

// Mock participants
const mockParticipants = [
  {
    id: participantId1,
    type: 'CHARACTER',
    characterId: 'char-1',
    personaId: null,
    isActive: true,
    connectionProfileId: 'profile-1',
    controlledBy: 'llm',
  },
  {
    id: participantId2,
    type: 'CHARACTER',
    characterId: 'char-2',
    personaId: null,
    isActive: true,
    connectionProfileId: 'profile-2',
    controlledBy: 'llm',
  },
  {
    id: participantId3,
    type: 'CHARACTER',
    characterId: 'char-3',
    personaId: null,
    isActive: false, // Inactive participant
    connectionProfileId: null,
    controlledBy: 'user',
  },
]

// Mock chat data
const mockChat = {
  id: 'chat-123',
  userId: 'user-123',
  title: 'Test Chat',
  participants: mockParticipants,
  impersonatingParticipantIds: [],
  activeTypingParticipantId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const mockCharacter1 = {
  id: 'char-1',
  name: 'Alice',
  userId: 'user-123',
}

const mockCharacter2 = {
  id: 'char-2',
  name: 'Bob',
  userId: 'user-123',
}

const mockConnectionProfile = {
  id: connectionProfileId,
  userId: 'user-123',
  name: 'Test Profile',
}

describe('Impersonation API Route', () => {
  let mockChatsRepo: {
    findById: jest.Mock
    addImpersonation: jest.Mock
    removeImpersonation: jest.Mock
    updateParticipant: jest.Mock
  }
  let mockCharactersRepo: {
    findById: jest.Mock
  }
  let mockConnectionsRepo: {
    findById: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repositories
    mockChatsRepo = {
      findById: jest.fn(),
      addImpersonation: jest.fn(),
      removeImpersonation: jest.fn(),
      updateParticipant: jest.fn(),
    }
    mockCharactersRepo = {
      findById: jest.fn(),
    }
    mockConnectionsRepo = {
      findById: jest.fn(),
    }

    mockGetRepositories.mockReturnValue({
      chats: mockChatsRepo,
      characters: mockCharactersRepo,
      connections: mockConnectionsRepo,
    } as any)

    // Default session mock
    mockGetServerSession.mockResolvedValue(mockSession)

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/chats/[id]/impersonate/route')
      GET = routeModule.GET
      POST = routeModule.POST
      DELETE = routeModule.DELETE
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // GET /api/chats/:id/impersonate Tests
  // ============================================================================
  describe('GET /api/chats/:id/impersonate', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })

      it('should return 401 when session has no user id', async () => {
        mockGetServerSession.mockResolvedValue({ user: {}, expires: '2024-12-31' })

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Chat Not Found', () => {
      it('should return 404 when chat does not exist', async () => {
        mockChatsRepo.findById.mockResolvedValue(null)

        const request = createRequest()
        const response = await GET(request, { params: createParams('nonexistent') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Chat not found')
      })

      it('should return 404 when chat belongs to different user', async () => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          userId: 'other-user-456',
        })

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Chat not found')
      })
    })

    describe('Successful Retrieval', () => {
      it('should return empty impersonation state', async () => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.chatId).toBe('chat-123')
        expect(body.impersonatingParticipantIds).toEqual([])
        expect(body.activeTypingParticipantId).toBeNull()
        expect(body.impersonatedParticipants).toEqual([])
      })

      it('should return impersonation state with active impersonations', async () => {
        const chatWithImpersonation = {
          ...mockChat,
          impersonatingParticipantIds: [participantId1],
          activeTypingParticipantId: participantId1,
        }
        mockChatsRepo.findById.mockResolvedValue(chatWithImpersonation)

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.impersonatingParticipantIds).toEqual([participantId1])
        expect(body.activeTypingParticipantId).toBe(participantId1)
        expect(body.impersonatedParticipants).toHaveLength(1)
        expect(body.impersonatedParticipants[0].id).toBe(participantId1)
      })

      it('should filter out non-existent participants from impersonated list', async () => {
        const chatWithBadRef = {
          ...mockChat,
          impersonatingParticipantIds: ['nonexistent-participant-id'],
        }
        mockChatsRepo.findById.mockResolvedValue(chatWithBadRef)

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.impersonatedParticipants).toEqual([])
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.findById.mockRejectedValue(new Error('Database error'))

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to get impersonation state')
      })
    })
  })

  // ============================================================================
  // POST /api/chats/:id/impersonate Tests
  // ============================================================================
  describe('POST /api/chats/:id/impersonate', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest({ participantId: participantId1 })
        const response = await POST(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Validation', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
      })

      it('should return 400 for invalid participantId format', async () => {
        const request = createRequest({ participantId: 'not-a-uuid' })
        const response = await POST(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Validation error')
      })

      it('should return 404 when participant not found', async () => {
        const request = createRequest({
          participantId: '550e8400-e29b-41d4-a716-446655449999', // Valid UUID but not in chat
        })
        const response = await POST(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Participant not found')
      })

      it('should return 400 when participant is not active', async () => {
        const request = createRequest({
          participantId: participantId3, // This participant is inactive
        })
        const response = await POST(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Participant is not active')
      })
    })

    describe('Successful Impersonation Start', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
        mockChatsRepo.addImpersonation.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [participantId1],
          activeTypingParticipantId: participantId1,
        })
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter1)
      })

      it('should start impersonation successfully', async () => {
        const request = createRequest({ participantId: participantId1 })
        const response = await POST(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.participantId).toBe(participantId1)
        expect(body.characterName).toBe('Alice')
        expect(body.impersonatingParticipantIds).toContain(participantId1)
      })

      it('should call addImpersonation on repository', async () => {
        const request = createRequest({ participantId: participantId1 })
        await POST(request, { params: createParams('chat-123') })

        expect(mockChatsRepo.addImpersonation).toHaveBeenCalledWith('chat-123', participantId1)
      })

      it('should log info on successful impersonation', async () => {
        const request = createRequest({ participantId: participantId1 })
        await POST(request, { params: createParams('chat-123') })

        expect(mockLogger.info).toHaveBeenCalledWith(
          '[Impersonate API] Impersonation started',
          expect.objectContaining({
            chatId: 'chat-123',
            participantId: participantId1,
          })
        )
      })
    })

    describe('Error Handling', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
      })

      it('should return 500 when addImpersonation fails', async () => {
        mockChatsRepo.addImpersonation.mockResolvedValue(null)

        const request = createRequest({ participantId: participantId1 })
        const response = await POST(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to start impersonation')
      })

      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.addImpersonation.mockRejectedValue(new Error('Database error'))

        const request = createRequest({ participantId: participantId1 })
        const response = await POST(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to start impersonation')
      })
    })
  })

  // ============================================================================
  // DELETE /api/chats/:id/impersonate Tests
  // ============================================================================
  describe('DELETE /api/chats/:id/impersonate', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest({ participantId: participantId1 })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Validation', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [participantId1],
        })
      })

      it('should return 400 for invalid participantId format', async () => {
        const request = createRequest({ participantId: 'not-a-uuid' })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Validation error')
      })

      it('should return 404 when participant not found', async () => {
        const request = createRequest({
          participantId: '550e8400-e29b-41d4-a716-446655449999',
        })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Participant not found')
      })
    })

    describe('Successful Impersonation Stop', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [participantId1],
          activeTypingParticipantId: participantId1,
        })
        mockChatsRepo.removeImpersonation.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [],
          activeTypingParticipantId: null,
        })
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter1)
      })

      it('should stop impersonation successfully', async () => {
        const request = createRequest({ participantId: participantId1 })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.participantId).toBe(participantId1)
        expect(body.characterName).toBe('Alice')
        expect(body.impersonatingParticipantIds).toEqual([])
      })

      it('should call removeImpersonation on repository', async () => {
        const request = createRequest({ participantId: participantId1 })
        await DELETE(request, { params: createParams('chat-123') })

        expect(mockChatsRepo.removeImpersonation).toHaveBeenCalledWith('chat-123', participantId1)
      })
    })

    describe('Stop Impersonation with New Connection Profile', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [participantId1],
        })
        mockChatsRepo.removeImpersonation.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [],
        })
        mockChatsRepo.updateParticipant.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [],
        })
        mockConnectionsRepo.findById.mockResolvedValue(mockConnectionProfile)
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter1)
      })

      it('should assign new connection profile when provided', async () => {
        const request = createRequest({
          participantId: participantId1,
          newConnectionProfileId: connectionProfileId,
        })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.newConnectionProfileId).toBe(connectionProfileId)
        expect(mockChatsRepo.updateParticipant).toHaveBeenCalledWith(
          'chat-123',
          participantId1,
          expect.objectContaining({
            connectionProfileId: connectionProfileId,
            controlledBy: 'llm',
          })
        )
      })

      it('should return 404 when connection profile not found', async () => {
        mockConnectionsRepo.findById.mockResolvedValue(null)

        const request = createRequest({
          participantId: participantId1,
          newConnectionProfileId: '550e8400-e29b-41d4-a716-446655449999',
        })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Connection profile not found')
      })

      it('should return 404 when connection profile belongs to different user', async () => {
        mockConnectionsRepo.findById.mockResolvedValue({
          ...mockConnectionProfile,
          userId: 'other-user',
        })

        const request = createRequest({
          participantId: participantId1,
          newConnectionProfileId: connectionProfileId,
        })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Connection profile not found')
      })
    })

    describe('Error Handling', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          impersonatingParticipantIds: [participantId1],
        })
      })

      it('should return 500 when removeImpersonation fails', async () => {
        mockChatsRepo.removeImpersonation.mockResolvedValue(null)

        const request = createRequest({ participantId: participantId1 })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to stop impersonation')
      })

      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.removeImpersonation.mockRejectedValue(new Error('Database error'))

        const request = createRequest({ participantId: participantId1 })
        const response = await DELETE(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to stop impersonation')
      })
    })
  })
})
