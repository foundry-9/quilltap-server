/**
 * Unit tests for Active Speaker API Route
 * Tests: GET, PUT /api/chats/:id/active-speaker
 *
 * Tests the active speaker endpoints for managing which character
 * the user is typing as when impersonating multiple characters.
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import { createMockRepositoryContainer, setupAuthMocks, type MockRepositoryContainer } from '@/__tests__/unit/lib/fixtures/mock-repositories'

// Create mock repos before jest.mock
const mockRepos = createMockRepositoryContainer()

// Mock dependencies before imports
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
  getUserRepositories: jest.fn(),
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
    child: jest.fn(function() { return this }),
  },
}))

// Get mocked modules using requireMock
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock
  getUserRepositories: jest.Mock
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
    child: jest.Mock
  }
}

const mockGetRepositories = repositoriesMock.getRepositories
const mockGetServerSession = sessionMock.getServerSession
const mockLogger = loggerMock.logger

// Declare route handlers
let GET: typeof import('@/app/api/chats/[id]/active-speaker/route').GET
let PUT: typeof import('@/app/api/chats/[id]/active-speaker/route').PUT

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

// Mock participants
const mockParticipants = [
  {
    id: participantId1,
    type: 'CHARACTER',
    characterId: 'char-1',
    personaId: null,
    isActive: true,
    connectionProfileId: 'profile-1',
    controlledBy: 'user',
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
    type: 'PERSONA',
    characterId: null,
    personaId: 'persona-1',
    isActive: true,
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
  impersonatingParticipantIds: [participantId1, participantId2],
  activeTypingParticipantId: participantId1,
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

describe('Active Speaker API Route', () => {
  let mockChatsRepo: {
    findById: jest.Mock
    setActiveTypingParticipant: jest.Mock
  }
  let mockCharactersRepo: {
    findById: jest.Mock
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock repositories
    mockChatsRepo = {
      findById: jest.fn(),
      setActiveTypingParticipant: jest.fn(),
    }
    mockCharactersRepo = {
      findById: jest.fn(),
    }

    // Override specific repos in the mock container for this test
    mockRepos.chats = { ...mockRepos.chats, ...mockChatsRepo } as any
    mockRepos.characters = { ...mockRepos.characters, ...mockCharactersRepo } as any

    // Setup auth mocks (sets up session and user in repos)
    setupAuthMocks(mockGetServerSession, mockRepos)

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/chats/[id]/active-speaker/route')
      GET = routeModule.GET
      PUT = routeModule.PUT
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ============================================================================
  // GET /api/chats/:id/active-speaker Tests
  // ============================================================================
  describe('GET /api/chats/:id/active-speaker', () => {
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
      it('should return active speaker with participant details', async () => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter1)

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.chatId).toBe('chat-123')
        expect(body.activeTypingParticipantId).toBe(participantId1)
        expect(body.activeParticipant).toBeDefined()
        expect(body.activeParticipant.id).toBe(participantId1)
        expect(body.activeParticipant.characterName).toBe('Alice')
        expect(body.impersonatingParticipantIds).toEqual([participantId1, participantId2])
      })

      it('should return null activeParticipant when no active speaker', async () => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          activeTypingParticipantId: null,
        })

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.activeTypingParticipantId).toBeNull()
        expect(body.activeParticipant).toBeNull()
      })

      it('should handle unknown character name gracefully', async () => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
        mockCharactersRepo.findById.mockResolvedValue(null) // Character not found

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.activeParticipant.characterName).toBe('Unknown')
      })

      it('should handle participant not found in list', async () => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          activeTypingParticipantId: 'nonexistent-participant',
        })

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.activeParticipant).toBeNull()
      })
    })

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.findById.mockRejectedValue(new Error('Database error'))

        const request = createRequest()
        const response = await GET(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to get active speaker')
      })

      it('should log error on failure', async () => {
        const testError = new Error('Database connection lost')
        mockChatsRepo.findById.mockRejectedValue(testError)

        const request = createRequest()
        await GET(request, { params: createParams('chat-123') })

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[Active Speaker API] Error getting active speaker:',
          {},
          testError
        )
      })
    })
  })

  // ============================================================================
  // PUT /api/chats/:id/active-speaker Tests
  // ============================================================================
  describe('PUT /api/chats/:id/active-speaker', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null)

        const request = createRequest({ participantId: participantId1 })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(401)
        expect(body.error).toBe('Unauthorized')
      })
    })

    describe('Chat Not Found', () => {
      it('should return 404 when chat does not exist', async () => {
        mockChatsRepo.findById.mockResolvedValue(null)

        const request = createRequest({ participantId: participantId1 })
        const response = await PUT(request, { params: createParams('nonexistent') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Chat not found')
      })
    })

    describe('Validation', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
      })

      it('should return 400 for invalid participantId format', async () => {
        const request = createRequest({ participantId: 'not-a-uuid' })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Validation error')
        expect(body.details).toBeDefined()
      })

      it('should return 404 when participant not found', async () => {
        const request = createRequest({
          participantId: '550e8400-e29b-41d4-a716-446655449999', // Valid UUID, not in chat
        })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(404)
        expect(body.error).toBe('Participant not found')
      })

      it('should return 400 when participant is not being impersonated', async () => {
        // participantId3 is not in impersonatingParticipantIds
        const chatWithLimitedImpersonation = {
          ...mockChat,
          impersonatingParticipantIds: [participantId1], // Only participant1 is impersonated
        }
        mockChatsRepo.findById.mockResolvedValue(chatWithLimitedImpersonation)

        const request = createRequest({ participantId: participantId2 })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error).toBe('Participant is not being impersonated')
      })
    })

    describe('Successful Active Speaker Set', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
        mockChatsRepo.setActiveTypingParticipant.mockResolvedValue({
          ...mockChat,
          activeTypingParticipantId: participantId2,
        })
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter2)
      })

      it('should set active speaker successfully', async () => {
        const request = createRequest({ participantId: participantId2 })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.activeTypingParticipantId).toBe(participantId2)
        expect(body.characterName).toBe('Bob')
      })

      it('should call setActiveTypingParticipant on repository', async () => {
        const request = createRequest({ participantId: participantId2 })
        await PUT(request, { params: createParams('chat-123') })

        expect(mockChatsRepo.setActiveTypingParticipant).toHaveBeenCalledWith('chat-123', participantId2)
      })

      it('should log info on successful set', async () => {
        const request = createRequest({ participantId: participantId2 })
        await PUT(request, { params: createParams('chat-123') })

        expect(mockLogger.info).toHaveBeenCalledWith(
          '[Active Speaker API] Active speaker set',
          expect.objectContaining({
            chatId: 'chat-123',
            participantId: participantId2,
            characterName: 'Bob',
          })
        )
      })

      it('should handle participant without character gracefully', async () => {
        // Participant without characterId (like a persona)
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          participants: [
            ...mockParticipants,
            {
              id: '550e8400-e29b-41d4-a716-446655440003',
              type: 'PERSONA',
              characterId: null,
              personaId: 'persona-2',
              isActive: true,
            },
          ],
          impersonatingParticipantIds: [participantId1, participantId2, '550e8400-e29b-41d4-a716-446655440003'],
        })
        mockChatsRepo.setActiveTypingParticipant.mockResolvedValue({
          ...mockChat,
          activeTypingParticipantId: '550e8400-e29b-41d4-a716-446655440003',
        })

        const request = createRequest({ participantId: '550e8400-e29b-41d4-a716-446655440003' })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.characterName).toBe('Unknown')
      })
    })

    describe('Error Handling', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat)
      })

      it('should return 500 when setActiveTypingParticipant fails', async () => {
        mockChatsRepo.setActiveTypingParticipant.mockResolvedValue(null)

        const request = createRequest({ participantId: participantId1 })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to set active speaker')
      })

      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.setActiveTypingParticipant.mockRejectedValue(new Error('Database error'))

        const request = createRequest({ participantId: participantId1 })
        const response = await PUT(request, { params: createParams('chat-123') })
        const body = await response.json()

        expect(response.status).toBe(500)
        expect(body.error).toBe('Failed to set active speaker')
      })

      it('should log error on failure', async () => {
        const testError = new Error('Update failed')
        mockChatsRepo.setActiveTypingParticipant.mockRejectedValue(testError)

        const request = createRequest({ participantId: participantId1 })
        await PUT(request, { params: createParams('chat-123') })

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[Active Speaker API] Error setting active speaker:',
          {},
          testError
        )
      })
    })
  })
})
