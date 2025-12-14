import { handleMemoryExtraction } from '@/lib/background-jobs/handlers/memory-extraction';
import { getRepositories } from '@/lib/repositories/factory';
import { processMessageForMemory } from '@/lib/memory/memory-processor';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/memory/memory-processor', () => ({
  processMessageForMemory: jest.fn(),
}));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockProcessMessageForMemory = processMessageForMemory as jest.MockedFunction<typeof processMessageForMemory>;

type MockRepositories = {
  connections: {
    findById: jest.Mock;
    findByUserId: jest.Mock;
  };
  users: {
    getChatSettings: jest.Mock;
  };
  chats: {
    updateMessage: jest.Mock;
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
    users: {
      getChatSettings: jest.fn().mockResolvedValue({ cheapLLMSettings: { providerId: 'cheap' } }),
    },
    chats: {
      updateMessage: jest.fn().mockResolvedValue(undefined),
    },
  };

  mockGetRepositories.mockReturnValue(repositories as any);
  mockProcessMessageForMemory.mockResolvedValue({ success: true, memoryCreated: false });
});

describe('handleMemoryExtraction', () => {
  const buildJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    userId: 'user-7',
    payload: {
      chatId: 'chat-1',
      characterId: 'char-1',
      characterName: 'Echo',
      userMessage: 'Hello',
      assistantMessage: 'Greetings',
      sourceMessageId: 'msg-1',
      connectionProfileId: 'profile-1',
      ...overrides,
    },
  });

  it('builds the extraction context and stores debug logs', async () => {
    mockProcessMessageForMemory.mockResolvedValue({
      success: true,
      memoryCreated: true,
      memoryId: 'mem-9',
      debugLogs: ['log entry'],
    });

    await handleMemoryExtraction(buildJob() as any);

    expect(mockProcessMessageForMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        characterName: 'Echo',
        chatId: 'chat-1',
        userMessage: 'Hello',
        assistantMessage: 'Greetings',
        userId: 'user-7',
        connectionProfile: { id: 'profile-1' },
        cheapLLMSettings: { providerId: 'cheap' },
        availableProfiles: [{ id: 'profile-1' }],
      })
    );

    expect(repositories.chats.updateMessage).toHaveBeenCalledWith('chat-1', 'msg-1', {
      debugMemoryLogs: ['log entry'],
    });
  });

  it('throws when required data is missing', async () => {
    repositories.connections.findById.mockResolvedValue(null);

    await expect(handleMemoryExtraction(buildJob() as any)).rejects.toThrow(/Connection profile not found/);

    repositories.connections.findById.mockResolvedValue({ id: 'profile-1' });
    repositories.users.getChatSettings.mockResolvedValue(null);

    await expect(handleMemoryExtraction(buildJob() as any)).rejects.toThrow(/Chat settings not found/);
  });

  it('skips storing debug logs when the source message is unavailable', async () => {
    mockProcessMessageForMemory.mockResolvedValue({
      success: true,
      debugLogs: ['log entry'],
    });

    const jobWithoutMessage = buildJob({ sourceMessageId: undefined });

    await handleMemoryExtraction(jobWithoutMessage as any);

    expect(repositories.chats.updateMessage).not.toHaveBeenCalled();
  });
});
