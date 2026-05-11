import { handleContextSummary } from '@/lib/background-jobs/handlers/context-summary';
import { getRepositories } from '@/lib/repositories/factory';
import { generateContextSummary } from '@/lib/chat/context-summary';
import { enqueueChatDangerClassification } from '@/lib/background-jobs/queue-service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

// The handler delegates summary generation to generateContextSummary in
// @/lib/chat/context-summary (rewritten in 8957382f). Mock the delegate
// directly — this test is about the danger-classification chaining that
// runs *after* the delegate succeeds, not about summary generation itself.
jest.mock('@/lib/chat/context-summary', () => ({
  generateContextSummary: jest.fn(),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueChatDangerClassification: jest.fn(),
}));

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockGenerateContextSummary = generateContextSummary as jest.MockedFunction<typeof generateContextSummary>;
const mockEnqueueDangerClassification = enqueueChatDangerClassification as jest.MockedFunction<typeof enqueueChatDangerClassification>;
const mockResolveDangerousContentSettings = resolveDangerousContentSettings as jest.MockedFunction<typeof resolveDangerousContentSettings>;

const buildJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'CONTEXT_SUMMARY' as const,
  status: 'PROCESSING' as const,
  payload: {
    chatId: 'chat-1',
    connectionProfileId: 'profile-1',
    forceRegenerate: false,
    ...overrides,
  },
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

beforeEach(() => {
  jest.clearAllMocks();

  const repositories = {
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        contextSummary: '',
        lastRenameCheckInterchange: 0,
      }),
      getMessages: jest.fn().mockResolvedValue([
        { type: 'message', role: 'user', content: 'Hello' },
        { type: 'message', role: 'assistant', content: 'Hi there' },
      ]),
      update: jest.fn().mockResolvedValue(undefined),
    },
    chatSettings: {
      findByUserId: jest.fn().mockResolvedValue({
        cheapLLMSettings: {
          strategy: 'PROVIDER_CHEAPEST',
          fallbackToLocal: true,
        },
        dangerousContentSettings: {
          mode: 'DETECT_ONLY',
        },
      }),
    },
    connections: {
      findById: jest.fn().mockResolvedValue({
        id: 'profile-1',
        provider: 'OPENAI',
        modelName: 'gpt-4o-mini',
      }),
      findByUserId: jest.fn().mockResolvedValue([{
        id: 'profile-1',
        provider: 'OPENAI',
        modelName: 'gpt-4o-mini',
      }]),
    },
  };

  mockGetRepositories.mockReturnValue(repositories as any);

  mockGenerateContextSummary.mockResolvedValue({
    success: true,
    wasGenerated: true,
    summary: 'Updated summary text',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  });

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
    jobId: 'chained-job-1',
    isNew: true,
  });
});

describe('Context Summary → Danger Classification Chaining', () => {
  it('chains danger classification after successful summary update', async () => {
    await handleContextSummary(buildJob());

    expect(mockEnqueueDangerClassification).toHaveBeenCalledWith(
      'user-1',
      { chatId: 'chat-1', connectionProfileId: 'profile-1' },
      { priority: -2 }
    );
  });

  it('does not chain if danger mode is OFF', async () => {
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

    await handleContextSummary(buildJob());

    expect(mockEnqueueDangerClassification).not.toHaveBeenCalled();
  });

  it('does not fail summary job if chaining throws', async () => {
    mockEnqueueDangerClassification.mockRejectedValue(new Error('Queue error'));

    // Should NOT throw
    await handleContextSummary(buildJob());

    // Summary generation should still have completed
    expect(mockGenerateContextSummary).toHaveBeenCalled();
  });

  it('uses priority -2 for chained jobs', async () => {
    await handleContextSummary(buildJob());

    expect(mockEnqueueDangerClassification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { priority: -2 }
    );
  });
});
