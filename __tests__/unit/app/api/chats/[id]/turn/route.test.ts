/**
 * Unit tests for Turn Management API Route
 * Tests: GET, POST, PATCH /api/chats/:id/turn
 *
 * Tests the turn management endpoints for multi-character chats:
 * - GET: Returns current turn state and next speaker
 * - POST: Performs turn actions (nudge, queue, dequeue)
 * - PATCH: Persists turn state to chat metadata
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { createMockRepositoryContainer, setupAuthMocks, type MockRepositoryContainer } from '@/__tests__/unit/lib/fixtures/mock-repositories';

// Create mock repos before jest.mock
const mockRepos = createMockRepositoryContainer();

// Mock dependencies before imports
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
  getUserRepositories: jest.fn(),
}));

jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/chat/turn-manager', () => ({
  selectNextSpeaker: jest.fn(),
  calculateTurnStateFromHistory: jest.fn(),
  nudgeParticipant: jest.fn(),
  addToQueue: jest.fn(),
  removeFromQueue: jest.fn(),
  getQueuePosition: jest.fn(),
  getActiveCharacterParticipants: jest.fn(),
  findUserParticipant: jest.fn(),
  isMultiCharacterChat: jest.fn(),
  getSelectionExplanation: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

// Get mocked modules using requireMock
const repositoriesMock = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock;
};
const sessionMock = jest.requireMock('@/lib/auth/session') as {
  getServerSession: jest.Mock;
};
const turnManagerMock = jest.requireMock('@/lib/chat/turn-manager') as {
  selectNextSpeaker: jest.Mock;
  calculateTurnStateFromHistory: jest.Mock;
  nudgeParticipant: jest.Mock;
  addToQueue: jest.Mock;
  removeFromQueue: jest.Mock;
  getQueuePosition: jest.Mock;
  getActiveCharacterParticipants: jest.Mock;
  findUserParticipant: jest.Mock;
  isMultiCharacterChat: jest.Mock;
  getSelectionExplanation: jest.Mock;
};
const loggerMock = jest.requireMock('@/lib/logger') as {
  logger: {
    info: jest.Mock;
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
};

const mockGetRepositories = repositoriesMock.getRepositories;
const mockGetServerSession = sessionMock.getServerSession;
const mockSelectNextSpeaker = turnManagerMock.selectNextSpeaker;
const mockCalculateTurnStateFromHistory = turnManagerMock.calculateTurnStateFromHistory;
const mockNudgeParticipant = turnManagerMock.nudgeParticipant;
const mockAddToQueue = turnManagerMock.addToQueue;
const mockRemoveFromQueue = turnManagerMock.removeFromQueue;
const mockGetQueuePosition = turnManagerMock.getQueuePosition;
const mockGetActiveCharacterParticipants = turnManagerMock.getActiveCharacterParticipants;
const mockFindUserParticipant = turnManagerMock.findUserParticipant;
const mockIsMultiCharacterChat = turnManagerMock.isMultiCharacterChat;
const mockGetSelectionExplanation = turnManagerMock.getSelectionExplanation;
const mockLogger = loggerMock.logger;

// Declare route handlers
let GET: typeof import('@/app/api/chats/[id]/turn/route').GET;
let POST: typeof import('@/app/api/chats/[id]/turn/route').POST;
let PATCH: typeof import('@/app/api/chats/[id]/turn/route').PATCH;

/**
 * Helper to create a mock NextRequest with optional JSON body
 */
const createRequest = (body?: object): NextRequest =>
  ({
    json: async () => body ?? {},
  }) as unknown as NextRequest;

/**
 * Helper to create mock params promise
 */
const createParams = (id: string): Promise<{ id: string }> =>
  Promise.resolve({ id });

// Mock session data
const mockSession = {
  user: {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
  },
  expires: '2024-12-31T00:00:00.000Z',
};

// Mock chat data
const mockParticipants = [
  {
    id: 'participant-1',
    type: 'CHARACTER',
    characterId: 'char-1',
    personaId: null,
    isActive: true,
    connectionProfileId: 'profile-1',
  },
  {
    id: 'participant-2',
    type: 'CHARACTER',
    characterId: 'char-2',
    personaId: null,
    isActive: true,
    connectionProfileId: 'profile-2',
  },
  {
    id: 'participant-3',
    type: 'PERSONA',
    characterId: null,
    personaId: 'persona-1',
    isActive: true,
    connectionProfileId: null,
  },
];

const mockChat = {
  id: 'chat-123',
  userId: 'user-123',
  title: 'Test Chat',
  participants: mockParticipants,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockCharacter1 = {
  id: 'char-1',
  name: 'Alice',
  userId: 'user-123',
  talkativeness: 0.7,
};

const mockCharacter2 = {
  id: 'char-2',
  name: 'Bob',
  userId: 'user-123',
  talkativeness: 0.5,
};

const mockTurnState = {
  spokenSinceUserTurn: [],
  currentTurnParticipantId: null,
  queue: [],
  lastSpeakerId: null,
};

const mockTurnSelectionResult = {
  nextSpeakerId: 'participant-1',
  reason: 'weighted_selection' as const,
  cycleComplete: false,
};

describe('Turn API Route', () => {
  let mockChatsRepo: {
    findById: jest.Mock;
    getMessages: jest.Mock;
    update: jest.Mock;
  };
  let mockCharactersRepo: {
    findById: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup auth mocks
    setupAuthMocks(mockGetServerSession as jest.Mock, mockRepos);

    // Setup mock repositories
    mockChatsRepo = {
      findById: jest.fn(),
      getMessages: jest.fn(),
      update: jest.fn(),
    };
    mockCharactersRepo = {
      findById: jest.fn(),
    };

    // Update the mock repos with specific test repo instances
    mockRepos.chats = mockChatsRepo as any;
    mockRepos.characters = mockCharactersRepo as any;

    // Default session mock (additional to setupAuthMocks)
    mockGetServerSession.mockResolvedValue(mockSession);

    // Default turn manager mocks
    mockCalculateTurnStateFromHistory.mockReturnValue(mockTurnState);
    mockSelectNextSpeaker.mockReturnValue(mockTurnSelectionResult);
    mockGetActiveCharacterParticipants.mockReturnValue(
      mockParticipants.filter(p => p.type === 'CHARACTER')
    );
    mockFindUserParticipant.mockReturnValue(mockParticipants[2]);
    mockIsMultiCharacterChat.mockReturnValue(true);
    mockGetSelectionExplanation.mockReturnValue('Selected by weighted random based on talkativeness');
    mockGetQueuePosition.mockReturnValue(0);

    // Fresh import of route handlers for each test
    jest.isolateModules(() => {
      const routeModule = require('@/app/api/chats/[id]/turn/route');
      GET = routeModule.GET;
      POST = routeModule.POST;
      PATCH = routeModule.PATCH;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // GET /api/chats/:id/turn Tests
  // ============================================================================
  describe('GET /api/chats/:id/turn', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null);

        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe('Unauthorized');
      });

      it('should return 401 when session has no user id', async () => {
        mockGetServerSession.mockResolvedValue({ user: {}, expires: '2024-12-31' });

        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe('Unauthorized');
      });
    });

    describe('Chat Not Found', () => {
      it('should return 404 when chat does not exist', async () => {
        mockChatsRepo.findById.mockResolvedValue(null);

        const request = createRequest();
        const response = await GET(request, { params: createParams('nonexistent-chat') });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('Chat not found');
      });

      it('should return 404 when chat belongs to different user', async () => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          userId: 'other-user-456',
        });

        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('Chat not found');
      });
    });

    describe('Successful Turn State Retrieval', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat);
        mockChatsRepo.getMessages.mockResolvedValue([]);
        mockCharactersRepo.findById
          .mockResolvedValueOnce(mockCharacter1)
          .mockResolvedValueOnce(mockCharacter2);
      });

      it('should return turn state with next speaker', async () => {
        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.chatId).toBe('chat-123');
        expect(body.turn.nextSpeakerId).toBe('participant-1');
        expect(body.turn.reason).toBe('weighted_selection');
      });

      it('should return isMultiCharacter flag', async () => {
        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.isMultiCharacter).toBe(true);
        expect(mockIsMultiCharacterChat).toHaveBeenCalledWith(mockParticipants);
      });

      it('should return participant info with queue positions', async () => {
        mockGetQueuePosition.mockReturnValue(0);

        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.participants).toBeDefined();
        expect(Array.isArray(body.participants)).toBe(true);
      });

      it('should return state information', async () => {
        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.state).toBeDefined();
        expect(body.state.spokenSinceUserTurn).toEqual([]);
        expect(body.state.queue).toEqual([]);
      });

      it('should indicate user turn when nextSpeakerId is null', async () => {
        mockSelectNextSpeaker.mockReturnValue({
          nextSpeakerId: null,
          reason: 'user_turn',
          cycleComplete: true,
        });

        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.turn.isUsersTurn).toBe(true);
        expect(body.turn.nextSpeakerId).toBeNull();
      });

      it('should log debug information', async () => {
        const request = createRequest();
        await GET(request, { params: createParams('chat-123') });

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[Turn API] Getting turn state',
          expect.objectContaining({
            chatId: 'chat-123',
          })
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.findById.mockRejectedValue(new Error('Database error'));

        const request = createRequest();
        const response = await GET(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toBe('Failed to get turn state');
      });

      it('should log error on failure', async () => {
        const testError = new Error('Database connection lost');
        mockChatsRepo.findById.mockRejectedValue(testError);

        const request = createRequest();
        await GET(request, { params: createParams('chat-123') });

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[Turn API] Error getting turn state:',
          {},
          testError
        );
      });
    });
  });

  // ============================================================================
  // POST /api/chats/:id/turn Tests
  // ============================================================================
  describe('POST /api/chats/:id/turn', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null);

        const request = createRequest({
          action: 'nudge',
          participantId: 'participant-1',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe('Unauthorized');
      });
    });

    describe('Chat Not Found', () => {
      it('should return 404 when chat does not exist', async () => {
        mockChatsRepo.findById.mockResolvedValue(null);

        const request = createRequest({
          action: 'nudge',
          participantId: 'participant-1',
        });
        const response = await POST(request, { params: createParams('nonexistent') });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('Chat not found');
      });
    });

    describe('Validation', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat);
      });

      it('should return 400 for invalid action', async () => {
        const request = createRequest({
          action: 'invalid_action',
          participantId: 'participant-1',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Validation error');
        expect(body.details).toBeDefined();
      });

      it('should return 400 for missing participantId', async () => {
        const request = createRequest({
          action: 'nudge',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Validation error');
      });

      it('should return 400 for invalid participantId format', async () => {
        const request = createRequest({
          action: 'nudge',
          participantId: 'not-a-uuid',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Validation error');
      });

      it('should return 404 when participant not found', async () => {
        const request = createRequest({
          action: 'nudge',
          participantId: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID, but not in chat
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('Participant not found');
      });

      it('should return 400 when participant is not active', async () => {
        const chatWithInactiveParticipant = {
          ...mockChat,
          participants: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              type: 'CHARACTER',
              characterId: 'char-1',
              personaId: null,
              isActive: false,
              connectionProfileId: 'profile-1',
            },
          ],
        };
        mockChatsRepo.findById.mockResolvedValue(chatWithInactiveParticipant);

        const request = createRequest({
          action: 'nudge',
          participantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Participant is not active');
      });
    });

    describe('Nudge Action', () => {
      beforeEach(() => {
        const chatWithUuidParticipants = {
          ...mockChat,
          participants: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              type: 'CHARACTER',
              characterId: 'char-1',
              personaId: null,
              isActive: true,
              connectionProfileId: 'profile-1',
            },
            ...mockParticipants.slice(1),
          ],
        };
        mockChatsRepo.findById.mockResolvedValue(chatWithUuidParticipants);
        mockChatsRepo.getMessages.mockResolvedValue([]);
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter1);
        mockNudgeParticipant.mockReturnValue({
          ...mockTurnState,
          queue: ['550e8400-e29b-41d4-a716-446655440000'],
        });
      });

      it('should nudge participant successfully', async () => {
        const request = createRequest({
          action: 'nudge',
          participantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.action).toBe('nudge');
        expect(mockNudgeParticipant).toHaveBeenCalled();
      });

      it('should return updated turn info after nudge', async () => {
        const request = createRequest({
          action: 'nudge',
          participantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.turn).toBeDefined();
        expect(body.state).toBeDefined();
        expect(body.participant).toBeDefined();
      });
    });

    describe('Queue Action', () => {
      beforeEach(() => {
        const chatWithUuidParticipants = {
          ...mockChat,
          participants: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              type: 'CHARACTER',
              characterId: 'char-1',
              personaId: null,
              isActive: true,
              connectionProfileId: 'profile-1',
            },
            ...mockParticipants.slice(1),
          ],
        };
        mockChatsRepo.findById.mockResolvedValue(chatWithUuidParticipants);
        mockChatsRepo.getMessages.mockResolvedValue([]);
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter1);
        mockAddToQueue.mockReturnValue({
          ...mockTurnState,
          queue: ['550e8400-e29b-41d4-a716-446655440000'],
        });
      });

      it('should queue participant successfully', async () => {
        const request = createRequest({
          action: 'queue',
          participantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.action).toBe('queue');
        expect(mockAddToQueue).toHaveBeenCalled();
      });
    });

    describe('Dequeue Action', () => {
      beforeEach(() => {
        const chatWithUuidParticipants = {
          ...mockChat,
          participants: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              type: 'CHARACTER',
              characterId: 'char-1',
              personaId: null,
              isActive: true,
              connectionProfileId: 'profile-1',
            },
            ...mockParticipants.slice(1),
          ],
        };
        mockChatsRepo.findById.mockResolvedValue(chatWithUuidParticipants);
        mockChatsRepo.getMessages.mockResolvedValue([]);
        mockCharactersRepo.findById.mockResolvedValue(mockCharacter1);
        mockRemoveFromQueue.mockReturnValue(mockTurnState);
      });

      it('should dequeue participant successfully', async () => {
        const request = createRequest({
          action: 'dequeue',
          participantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.action).toBe('dequeue');
        expect(mockRemoveFromQueue).toHaveBeenCalled();
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.findById.mockRejectedValue(new Error('Database error'));

        const request = createRequest({
          action: 'nudge',
          participantId: 'participant-1',
        });
        const response = await POST(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toBe('Failed to process turn action');
      });

      it('should log error on failure', async () => {
        const testError = new Error('Unexpected error');
        mockChatsRepo.findById.mockRejectedValue(testError);

        const request = createRequest({
          action: 'nudge',
          participantId: 'participant-1',
        });
        await POST(request, { params: createParams('chat-123') });

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[Turn API] Error processing turn action:',
          {},
          testError
        );
      });
    });
  });

  // ============================================================================
  // PATCH /api/chats/:id/turn Tests
  // ============================================================================
  describe('PATCH /api/chats/:id/turn', () => {
    describe('Authentication', () => {
      it('should return 401 when no session exists', async () => {
        mockGetServerSession.mockResolvedValue(null);

        const request = createRequest({
          lastTurnParticipantId: 'participant-1',
        });
        const response = await PATCH(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(401);
        expect(body.error).toBe('Unauthorized');
      });
    });

    describe('Chat Not Found', () => {
      it('should return 404 when chat does not exist', async () => {
        mockChatsRepo.findById.mockResolvedValue(null);

        const request = createRequest({
          lastTurnParticipantId: null,
        });
        const response = await PATCH(request, { params: createParams('nonexistent') });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('Chat not found');
      });

      it('should return 404 when chat belongs to different user', async () => {
        mockChatsRepo.findById.mockResolvedValue({
          ...mockChat,
          userId: 'other-user-456',
        });

        const request = createRequest({
          lastTurnParticipantId: null,
        });
        const response = await PATCH(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('Chat not found');
      });
    });

    describe('Validation', () => {
      beforeEach(() => {
        mockChatsRepo.findById.mockResolvedValue(mockChat);
      });

      it('should return 400 for invalid lastTurnParticipantId format', async () => {
        const request = createRequest({
          lastTurnParticipantId: 'not-a-uuid',
        });
        const response = await PATCH(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Validation error');
      });

      it('should return 404 when participant not found', async () => {
        const request = createRequest({
          lastTurnParticipantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        const response = await PATCH(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(404);
        expect(body.error).toBe('Participant not found');
      });
    });

    describe('Successful Persist', () => {
      beforeEach(() => {
        const chatWithUuidParticipants = {
          ...mockChat,
          participants: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              type: 'CHARACTER',
              characterId: 'char-1',
              personaId: null,
              isActive: true,
              connectionProfileId: 'profile-1',
            },
            ...mockParticipants.slice(1),
          ],
        };
        mockChatsRepo.findById.mockResolvedValue(chatWithUuidParticipants);
        mockChatsRepo.update.mockResolvedValue(chatWithUuidParticipants);
      });

      it('should persist turn state with valid participant ID', async () => {
        const request = createRequest({
          lastTurnParticipantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        const response = await PATCH(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.lastTurnParticipantId).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(mockChatsRepo.update).toHaveBeenCalledWith('chat-123', {
          lastTurnParticipantId: '550e8400-e29b-41d4-a716-446655440000',
        });
      });

      it('should persist turn state with null (user turn)', async () => {
        mockChatsRepo.findById.mockResolvedValue(mockChat);

        const request = createRequest({
          lastTurnParticipantId: null,
        });
        const response = await PATCH(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.lastTurnParticipantId).toBeNull();
        expect(mockChatsRepo.update).toHaveBeenCalledWith('chat-123', {
          lastTurnParticipantId: null,
        });
      });

      it('should log debug information on persist', async () => {
        const request = createRequest({
          lastTurnParticipantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        await PATCH(request, { params: createParams('chat-123') });

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[Turn API] Persisting turn state',
          expect.objectContaining({
            chatId: 'chat-123',
            lastTurnParticipantId: '550e8400-e29b-41d4-a716-446655440000',
          })
        );
      });
    });

    describe('Inactive Participant Handling', () => {
      it('should log when persisting inactive participant turn', async () => {
        const chatWithInactiveParticipant = {
          ...mockChat,
          participants: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              type: 'CHARACTER',
              characterId: 'char-1',
              personaId: null,
              isActive: false,
              connectionProfileId: 'profile-1',
            },
            ...mockParticipants.slice(1),
          ],
        };
        mockChatsRepo.findById.mockResolvedValue(chatWithInactiveParticipant);
        mockChatsRepo.update.mockResolvedValue(chatWithInactiveParticipant);

        const request = createRequest({
          lastTurnParticipantId: '550e8400-e29b-41d4-a716-446655440000',
        });
        await PATCH(request, { params: createParams('chat-123') });

        expect(mockLogger.debug).toHaveBeenCalledWith(
          '[Turn API] Participant inactive, setting to user turn',
          expect.objectContaining({
            participantId: '550e8400-e29b-41d4-a716-446655440000',
          })
        );
      });
    });

    describe('Error Handling', () => {
      it('should return 500 on unexpected error', async () => {
        mockChatsRepo.findById.mockRejectedValue(new Error('Database error'));

        const request = createRequest({
          lastTurnParticipantId: null,
        });
        const response = await PATCH(request, { params: createParams('chat-123') });
        const body = await response.json();

        expect(response.status).toBe(500);
        expect(body.error).toBe('Failed to persist turn state');
      });

      it('should log error on failure', async () => {
        const testError = new Error('Update failed');
        mockChatsRepo.findById.mockResolvedValue(mockChat);
        mockChatsRepo.update.mockRejectedValue(testError);

        const request = createRequest({
          lastTurnParticipantId: null,
        });
        await PATCH(request, { params: createParams('chat-123') });

        expect(mockLogger.error).toHaveBeenCalledWith(
          '[Turn API] Error persisting turn state:',
          {},
          testError
        );
      });
    });
  });
});
