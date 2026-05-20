/**
 * Tests for the per-turn MEMORY_EXTRACTION job handler.
 *
 * The handler reads (chatId, turnOpenerMessageId) from the payload, rebuilds
 * the TurnTranscript from chat state, and delegates to processTurnForMemory.
 */

import { handleMemoryExtraction } from '@/lib/background-jobs/handlers/memory-extraction';
import { getRepositories } from '@/lib/repositories/factory';
import { processTurnForMemory } from '@/lib/memory/memory-processor';

jest.mock('@/lib/logger', () => {
  const childLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    logger: {
      ...childLogger,
      child: jest.fn(() => childLogger),
    },
  };
});

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/memory/memory-processor', () => ({
  processTurnForMemory: jest.fn(),
}));

jest.mock('@/lib/services/system-events.service', () => ({
  createMemoryExtractionEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn().mockResolvedValue({ cost: 0, source: 'estimate' }),
}));

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(() => ({ settings: { mode: 'OFF' } })),
}));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockProcessTurnForMemory = processTurnForMemory as jest.MockedFunction<typeof processTurnForMemory>;

type MockRepositories = {
  connections: { findById: jest.Mock; findByUserId: jest.Mock };
  chatSettings: { findByUserId: jest.Mock };
  characters: { findById: jest.Mock };
  chats: {
    updateMessage: jest.Mock;
    findById: jest.Mock;
    getMessages: jest.Mock;
  };
};

let repositories: MockRepositories;

const userMessage = {
  id: 'user-msg-1',
  type: 'message' as const,
  role: 'USER' as const,
  content: 'Hello',
  attachments: [],
  createdAt: '2026-04-30T00:00:00.000Z',
};

const assistantMessage = {
  id: 'assistant-msg-1',
  type: 'message' as const,
  role: 'ASSISTANT' as const,
  content: 'Greetings',
  attachments: [],
  participantId: 'participant-1',
  createdAt: '2026-04-30T00:00:01.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();

  repositories = {
    connections: {
      findById: jest.fn().mockResolvedValue({ id: 'profile-1' }),
      findByUserId: jest.fn().mockResolvedValue([{ id: 'profile-1' }]),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue({ cheapLLMSettings: { providerId: 'cheap' } }),
    },
    characters: {
      findById: jest.fn().mockResolvedValue({
        id: 'char-1',
        name: 'Echo',
        pronouns: null,
      }),
    },
    chats: {
      updateMessage: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        isDangerousChat: false,
        participants: [{
          id: 'participant-1',
          type: 'CHARACTER',
          characterId: 'char-1',
          controlledBy: 'llm',
          isActive: true,
          status: 'active',
          hasHistoryAccess: true,
          displayOrder: 0,
        }],
      }),
      getMessages: jest.fn().mockResolvedValue([userMessage, assistantMessage]),
    },
  };

  mockGetRepositories.mockReturnValue(repositories as any);
  mockProcessTurnForMemory.mockResolvedValue({
    success: true,
    memoriesCreatedCount: 0,
    memoriesReinforcedCount: 0,
    createdMemoryIds: [],
    reinforcedMemoryIds: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    sourceMessageId: 'assistant-msg-1',
    debugLogs: [],
  });
});

describe('handleMemoryExtraction (per-turn)', () => {
  const buildJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    userId: 'user-7',
    payload: {
      chatId: 'chat-1',
      turnOpenerMessageId: 'user-msg-1',
      connectionProfileId: 'profile-1',
      ...overrides,
    },
  });

  it('builds a transcript from chat state and delegates to processTurnForMemory', async () => {
    await handleMemoryExtraction(buildJob() as any);

    expect(mockProcessTurnForMemory).toHaveBeenCalledTimes(1);
    const call = mockProcessTurnForMemory.mock.calls[0][0];
    expect(call.chatId).toBe('chat-1');
    expect(call.userId).toBe('user-7');
    expect(call.transcript.turnOpenerMessageId).toBe('user-msg-1');
    expect(call.transcript.userMessage).toBe('Hello');
    expect(call.transcript.characterSlices).toHaveLength(1);
    expect(call.transcript.characterSlices[0].characterId).toBe('char-1');
    expect(call.transcript.characterSlices[0].text).toBe('Greetings');
  });

  it('persists debug logs onto the latest assistant message of the turn', async () => {
    mockProcessTurnForMemory.mockResolvedValue({
      success: true,
      memoriesCreatedCount: 1,
      memoriesReinforcedCount: 0,
      createdMemoryIds: ['mem-9'],
      reinforcedMemoryIds: [],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      sourceMessageId: 'assistant-msg-1',
      debugLogs: ['log entry'],
    });

    await handleMemoryExtraction(buildJob() as any);

    expect(repositories.chats.updateMessage).toHaveBeenCalledWith('chat-1', 'assistant-msg-1', {
      debugMemoryLogs: ['log entry'],
    });
  });

  it('throws when the connection profile is missing', async () => {
    repositories.connections.findById.mockResolvedValue(null);
    await expect(handleMemoryExtraction(buildJob() as any)).rejects.toThrow(/Connection profile not found/);
  });

  it('throws when chat settings are missing', async () => {
    repositories.chatSettings.findByUserId.mockResolvedValue(null);
    await expect(handleMemoryExtraction(buildJob() as any)).rejects.toThrow(/Chat settings not found/);
  });

  it('returns silently when the chat has been deleted between enqueue and execution', async () => {
    repositories.chats.findById.mockResolvedValue(null);
    await expect(handleMemoryExtraction(buildJob() as any)).resolves.toBeUndefined();
    expect(mockProcessTurnForMemory).not.toHaveBeenCalled();
  });

  it('skips processing when the resulting transcript has no character contributions', async () => {
    repositories.chats.getMessages.mockResolvedValue([userMessage]);
    await handleMemoryExtraction(buildJob() as any);
    expect(mockProcessTurnForMemory).not.toHaveBeenCalled();
  });
});
