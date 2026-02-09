import { runScheduledDangerScan } from '@/lib/background-jobs/scheduled-danger-scan';
import { getRepositories } from '@/lib/repositories/factory';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { enqueueChatDangerClassification, enqueueContextSummary } from '@/lib/background-jobs/queue-service';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueChatDangerClassification: jest.fn(),
  enqueueContextSummary: jest.fn(),
}));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockResolveDangerousContentSettings = resolveDangerousContentSettings as jest.MockedFunction<typeof resolveDangerousContentSettings>;
const mockEnqueueDangerClassification = enqueueChatDangerClassification as jest.MockedFunction<typeof enqueueChatDangerClassification>;
const mockEnqueueContextSummary = enqueueContextSummary as jest.MockedFunction<typeof enqueueContextSummary>;

const buildChat = (overrides: Record<string, unknown> = {}) => ({
  id: 'chat-1',
  userId: 'user-1',
  participants: [
    {
      id: 'p1',
      type: 'CHARACTER',
      characterId: 'char-1',
      controlledBy: 'llm',
      connectionProfileId: 'profile-1',
    },
  ],
  title: 'Test Chat',
  contextSummary: null,
  messageCount: 10,
  isDangerousChat: null,
  dangerScore: null,
  dangerCategories: [],
  dangerClassifiedAt: null,
  dangerClassifiedAtMessageCount: null,
  ...overrides,
});

let repositories: any;

beforeEach(() => {
  jest.clearAllMocks();

  repositories = {
    chatSettings: {
      findAll: jest.fn().mockResolvedValue([
        {
          userId: 'user-1',
          dangerousContentSettings: { mode: 'DETECT_ONLY' },
        },
      ]),
    },
    chats: {
      findByUserId: jest.fn().mockResolvedValue([]),
    },
    connections: {
      findByUserId: jest.fn().mockResolvedValue([
        { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4o-mini' },
      ]),
    },
  };

  mockGetRepositories.mockReturnValue(repositories);

  mockResolveDangerousContentSettings.mockReturnValue({
    settings: {
      mode: 'DETECT_ONLY',
      threshold: 0.7,
      scanTextChat: true,
      scanImagePrompts: true,
      scanImageGeneration: false,
      displayMode: 'SHOW',
      showWarningBadges: true,
    },
    source: 'global',
  });

  mockEnqueueDangerClassification.mockResolvedValue({
    jobId: 'job-1',
    isNew: true,
  });
  mockEnqueueContextSummary.mockResolvedValue('job-2');
});

describe('runScheduledDangerScan', () => {
  it('skips users with danger mode OFF', async () => {
    mockResolveDangerousContentSettings.mockReturnValue({
      settings: {
        mode: 'OFF',
        threshold: 0.7,
        scanTextChat: true,
        scanImagePrompts: true,
        scanImageGeneration: false,
        displayMode: 'SHOW',
        showWarningBadges: true,
      },
      source: 'default',
    });

    const result = await runScheduledDangerScan();

    expect(repositories.chats.findByUserId).not.toHaveBeenCalled();
    expect(mockEnqueueDangerClassification).not.toHaveBeenCalled();
    expect(result.chatsEnqueued).toBe(0);
  });

  it('enqueues classification for chats with context summary', async () => {
    repositories.chats.findByUserId.mockResolvedValue([
      buildChat({ id: 'chat-with-summary', contextSummary: 'A conversation about cats.' }),
    ]);

    await runScheduledDangerScan();

    expect(mockEnqueueDangerClassification).toHaveBeenCalledWith(
      'user-1',
      { chatId: 'chat-with-summary', connectionProfileId: 'profile-1' },
      { priority: -2 }
    );
  });

  it('enqueues context summary for long chats without summary (messageCount > 50)', async () => {
    repositories.chats.findByUserId.mockResolvedValue([
      buildChat({ id: 'chat-long', messageCount: 100 }),
    ]);

    await runScheduledDangerScan();

    expect(mockEnqueueContextSummary).toHaveBeenCalledWith(
      'user-1',
      { chatId: 'chat-long', connectionProfileId: 'profile-1', forceRegenerate: false },
      { priority: -2 }
    );
    expect(mockEnqueueDangerClassification).not.toHaveBeenCalled();
  });

  it('enqueues classification for short chats without summary (messageCount <= 50)', async () => {
    repositories.chats.findByUserId.mockResolvedValue([
      buildChat({ id: 'chat-short', messageCount: 20 }),
    ]);

    await runScheduledDangerScan();

    expect(mockEnqueueDangerClassification).toHaveBeenCalledWith(
      'user-1',
      { chatId: 'chat-short', connectionProfileId: 'profile-1' },
      { priority: -2 }
    );
    expect(mockEnqueueContextSummary).not.toHaveBeenCalled();
  });

  it('skips already-classified chats', async () => {
    repositories.chats.findByUserId.mockResolvedValue([
      buildChat({ id: 'chat-safe', isDangerousChat: false }),
      buildChat({ id: 'chat-dangerous', isDangerousChat: true }),
    ]);

    const result = await runScheduledDangerScan();

    expect(mockEnqueueDangerClassification).not.toHaveBeenCalled();
    expect(mockEnqueueContextSummary).not.toHaveBeenCalled();
    expect(result.chatsEnqueued).toBe(0);
  });

  it('skips chats without available connection profile', async () => {
    repositories.chats.findByUserId.mockResolvedValue([
      buildChat({
        id: 'chat-no-profile',
        participants: [
          { id: 'p1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'user', connectionProfileId: null },
        ],
      }),
    ]);
    repositories.connections.findByUserId.mockResolvedValue([]);

    const result = await runScheduledDangerScan();

    expect(mockEnqueueDangerClassification).not.toHaveBeenCalled();
    expect(result.chatsEnqueued).toBe(0);
  });

  it('handles enqueue errors gracefully', async () => {
    repositories.chats.findByUserId.mockResolvedValue([
      buildChat({ id: 'chat-error', contextSummary: 'Some content' }),
    ]);
    mockEnqueueDangerClassification.mockRejectedValue(new Error('Queue full'));

    // Should NOT throw
    const result = await runScheduledDangerScan();

    expect(result.chatsEnqueued).toBe(0);
  });

  it('uses priority -2 for all batch jobs', async () => {
    repositories.chats.findByUserId.mockResolvedValue([
      buildChat({ id: 'chat-1', contextSummary: 'Summary text' }),
      buildChat({ id: 'chat-2', messageCount: 200 }),
      buildChat({ id: 'chat-3', messageCount: 5 }),
    ]);

    await runScheduledDangerScan();

    // Chat with summary → danger classification at priority -2
    expect(mockEnqueueDangerClassification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatId: 'chat-1' }),
      { priority: -2 }
    );
    // Long chat without summary → context summary at priority -2
    expect(mockEnqueueContextSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatId: 'chat-2' }),
      { priority: -2 }
    );
    // Short chat without summary → danger classification at priority -2
    expect(mockEnqueueDangerClassification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatId: 'chat-3' }),
      { priority: -2 }
    );
  });

  it('handles database errors without throwing', async () => {
    repositories.chatSettings.findAll.mockRejectedValue(new Error('Database error'));

    await expect(runScheduledDangerScan()).rejects.toThrow('Database error');
  });
});
