import { handleInterCharacterMemory } from '@/lib/background-jobs/handlers/inter-character-memory';
import { getRepositories } from '@/lib/repositories/factory';
import { processInterCharacterMemory } from '@/lib/memory/memory-processor';

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
  processInterCharacterMemory: jest.fn(),
}));

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(() => ({ settings: { mode: 'OFF' } })),
}));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockProcessInterCharacterMemory = processInterCharacterMemory as jest.MockedFunction<
  typeof processInterCharacterMemory
>;

type MockRepositories = {
  connections: {
    findById: jest.Mock;
    findByUserId: jest.Mock;
  };
  chatSettings: {
    findByUserId: jest.Mock;
  };
  chats: {
    findById: jest.Mock;
  };
};

let repositories: MockRepositories;

beforeEach(() => {
  jest.clearAllMocks();

  repositories = {
    connections: {
      findById: jest.fn().mockResolvedValue({ id: 'profile-1' }),
      findByUserId: jest.fn().mockResolvedValue([{ id: 'profile-1' }]),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue({
        cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true },
        memoryExtractionLimits: { enabled: false, maxPerHour: 20, softStartFraction: 0.7, softFloor: 0.7 },
      }),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({ id: 'chat-1', isDangerousChat: false }),
    },
  };

  mockGetRepositories.mockReturnValue(repositories as any);
  mockProcessInterCharacterMemory.mockResolvedValue({
    success: true,
    memoryCreated: false,
    memoryReinforced: false,
    memoryIds: [],
    reinforcedMemoryIds: [],
  });
});

describe('handleInterCharacterMemory', () => {
  const buildJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    userId: 'user-7',
    type: 'INTER_CHARACTER_MEMORY',
    status: 'PROCESSING',
    payload: {
      chatId: 'chat-1',
      observerCharacterId: 'char-observer',
      observerCharacterName: 'Alice',
      observerCharacterPronouns: null,
      observerMessage: 'Hello Bob, how was your trip?',
      subjectCharacterId: 'char-subject',
      subjectCharacterName: 'Bob',
      subjectCharacterPronouns: null,
      subjectMessage: 'Exhausting — I barely slept.',
      sourceMessageId: 'msg-1',
      connectionProfileId: 'profile-1',
      ...overrides,
    },
  });

  it('delegates to processInterCharacterMemory with the built context', async () => {
    await handleInterCharacterMemory(buildJob() as any);

    expect(mockProcessInterCharacterMemory).toHaveBeenCalledTimes(1);
    expect(mockProcessInterCharacterMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        observerCharacterId: 'char-observer',
        observerCharacterName: 'Alice',
        subjectCharacterId: 'char-subject',
        subjectCharacterName: 'Bob',
        chatId: 'chat-1',
        userId: 'user-7',
        connectionProfile: { id: 'profile-1' },
        cheapLLMSettings: expect.objectContaining({ strategy: 'PROVIDER_CHEAPEST' }),
        memoryExtractionLimits: expect.objectContaining({ enabled: false, maxPerHour: 20 }),
      })
    );
  });

  it('throws when the connection profile is missing', async () => {
    repositories.connections.findById.mockResolvedValue(null);

    await expect(handleInterCharacterMemory(buildJob() as any)).rejects.toThrow(
      /Connection profile not found/
    );
  });

  it('throws when chat settings are missing', async () => {
    repositories.chatSettings.findByUserId.mockResolvedValue(null);

    await expect(handleInterCharacterMemory(buildJob() as any)).rejects.toThrow(
      /Chat settings not found/
    );
  });

  it('passes isDangerousChat through to the processor context', async () => {
    repositories.chats.findById.mockResolvedValue({ id: 'chat-1', isDangerousChat: true });

    await handleInterCharacterMemory(buildJob() as any);

    expect(mockProcessInterCharacterMemory).toHaveBeenCalledWith(
      expect.objectContaining({ isDangerousChat: true })
    );
  });

  it('does not throw when the processor reports a failure — it logs and returns', async () => {
    mockProcessInterCharacterMemory.mockResolvedValue({
      success: false,
      memoryCreated: false,
      memoryReinforced: false,
      memoryIds: [],
      reinforcedMemoryIds: [],
      error: 'something went wrong',
    });

    await expect(handleInterCharacterMemory(buildJob() as any)).resolves.toBeUndefined();
  });
});
