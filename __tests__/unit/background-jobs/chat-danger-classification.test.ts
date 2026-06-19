import { handleChatDangerClassification } from '@/lib/background-jobs/handlers/chat-danger-classification';
import { getRepositories } from '@/lib/repositories/factory';
import { classifyContent } from '@/lib/services/dangerous-content/gatekeeper.service';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { getCheapLLMProvider } from '@/lib/llm/cheap-llm';
import { createSystemEvent } from '@/lib/services/system-events.service';

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

jest.mock('@/lib/services/dangerous-content/gatekeeper.service', () => ({
  classifyContent: jest.fn(),
}));

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}));

jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
}));

jest.mock('@/lib/services/system-events.service', () => ({
  createSystemEvent: jest.fn(),
}));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockClassifyContent = classifyContent as jest.MockedFunction<typeof classifyContent>;
const mockResolveDangerousContentSettings = resolveDangerousContentSettings as jest.MockedFunction<typeof resolveDangerousContentSettings>;
const mockGetCheapLLMProvider = getCheapLLMProvider as jest.MockedFunction<typeof getCheapLLMProvider>;
const mockCreateSystemEvent = createSystemEvent as jest.MockedFunction<typeof createSystemEvent>;

type MockRepositories = {
  chats: {
    findById: jest.Mock;
    getMessages: jest.Mock;
    update: jest.Mock;
  };
  chatSettings: {
    findByUserId: jest.Mock;
  };
  connections: {
    findById: jest.Mock;
    findByUserId: jest.Mock;
  };
};

let repositories: MockRepositories;

const buildJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userId: 'user-1',
  type: 'CHAT_DANGER_CLASSIFICATION' as const,
  status: 'PROCESSING' as const,
  payload: {
    chatId: 'chat-1',
    connectionProfileId: 'profile-1',
    ...overrides,
  },
  priority: -1,
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  scheduledAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const baseChatMetadata = {
  id: 'chat-1',
  userId: 'user-1',
  participants: [{ id: 'p1', type: 'CHARACTER', characterId: 'char-1', controlledBy: 'llm', connectionProfileId: 'profile-1' }],
  title: 'Test Chat',
  contextSummary: 'A conversation about cats and dogs.',
  messageCount: 10,
  isDangerousChat: null,
  dangerScore: null,
  dangerCategories: [],
  dangerClassifiedAt: null,
  dangerClassifiedAtMessageCount: null,
};

beforeEach(() => {
  jest.clearAllMocks();

  repositories = {
    chats: {
      findById: jest.fn().mockResolvedValue({ ...baseChatMetadata }),
      getMessages: jest.fn().mockResolvedValue([]),
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
          threshold: 0.7,
          scanTextChat: true,
          scanImagePrompts: true,
          scanImageGeneration: false,
          displayMode: 'SHOW',
          showWarningBadges: true,
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

  mockGetCheapLLMProvider.mockReturnValue({
    provider: 'OPENAI',
    modelName: 'gpt-4o-mini',
    connectionProfileId: 'profile-1',
    isLocal: false,
  });

  mockCreateSystemEvent.mockResolvedValue(null);
});

describe('handleChatDangerClassification', () => {
  it('classifies chat as dangerous and updates fields', async () => {
    mockClassifyContent.mockResolvedValue({
      isDangerous: true,
      score: 0.85,
      categories: [
        { category: 'nsfw', score: 0.85, label: 'Sexual content' },
      ],
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });

    await handleChatDangerClassification(buildJob());

    expect(repositories.chats.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      isDangerousChat: true,
      dangerScore: 0.85,
      dangerCategories: ['nsfw'],
      dangerClassifiedAtMessageCount: 10,
    }));
    expect(mockCreateSystemEvent).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      systemEventType: 'DANGER_CLASSIFICATION',
    }));
  });

  it('classifies chat as safe and updates fields', async () => {
    mockClassifyContent.mockResolvedValue({
      isDangerous: false,
      score: 0.1,
      categories: [],
      usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
    });

    await handleChatDangerClassification(buildJob());

    expect(repositories.chats.update).toHaveBeenCalledWith('chat-1', expect.objectContaining({
      isDangerousChat: false,
      dangerScore: 0.1,
      dangerCategories: [],
      dangerClassifiedAtMessageCount: 10,
    }));
  });

  it('skips if chat not found', async () => {
    repositories.chats.findById.mockResolvedValue(null);

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(repositories.chats.update).not.toHaveBeenCalled();
  });

  it.each(['help', 'brahma'])('never classifies or announces on %s chats (moderation-exempt backstop)', async (chatType) => {
    repositories.chats.findById.mockResolvedValue({
      ...baseChatMetadata,
      chatType,
    });

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(repositories.chats.update).not.toHaveBeenCalled();
    expect(mockCreateSystemEvent).not.toHaveBeenCalled();
  });

  it('skips if chat already classified as dangerous (sticky)', async () => {
    repositories.chats.findById.mockResolvedValue({
      ...baseChatMetadata,
      isDangerousChat: true,
      dangerScore: 0.9,
    });

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(repositories.chats.update).not.toHaveBeenCalled();
  });

  it('skips if chat already classified as safe and no new messages (sticky)', async () => {
    repositories.chats.findById.mockResolvedValue({
      ...baseChatMetadata,
      isDangerousChat: false,
      dangerScore: 0.1,
      dangerClassifiedAt: '2026-01-01T00:00:00Z',
      dangerClassifiedAtMessageCount: 10,
      messageCount: 10,
    });

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(repositories.chats.update).not.toHaveBeenCalled();
  });

  it('re-classifies safe chat when new messages have been added', async () => {
    repositories.chats.findById.mockResolvedValue({
      ...baseChatMetadata,
      isDangerousChat: false,
      dangerScore: 0.1,
      dangerClassifiedAt: '2026-01-01T00:00:00Z',
      dangerClassifiedAtMessageCount: 8,
      messageCount: 10,
    });

    mockClassifyContent.mockResolvedValue({
      isDangerous: false,
      score: 0.15,
      categories: [],
      usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
    });

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).toHaveBeenCalled();
    expect(repositories.chats.update).toHaveBeenCalled();
  });

  it('uses concatenated messages when no context summary', async () => {
    repositories.chats.findById.mockResolvedValue({
      ...baseChatMetadata,
      contextSummary: null,
    });

    repositories.chats.getMessages.mockResolvedValue([
      { type: 'message', role: 'user', content: 'Hello there' },
      { type: 'message', role: 'assistant', content: 'Hi! How are you?' },
      { type: 'system_event', role: 'system', content: 'System event' }, // should be filtered
    ]);

    mockClassifyContent.mockResolvedValue({
      isDangerous: false,
      score: 0.1,
      categories: [],
      usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
    });

    await handleChatDangerClassification(buildJob());

    // Should have called classifyContent with concatenated messages
    expect(mockClassifyContent).toHaveBeenCalledWith(
      expect.stringContaining('USER: Hello there'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(mockClassifyContent).toHaveBeenCalledWith(
      expect.stringContaining('ASSISTANT: Hi! How are you?'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(repositories.chats.update).toHaveBeenCalled();
  });

  it('excludes SYSTEM, TOOL, and Staff (systemSender) content from the no-summary fallback', async () => {
    repositories.chats.findById.mockResolvedValue({
      ...baseChatMetadata,
      contextSummary: null,
    });

    // A benign conversation, but with a persona prompt (SYSTEM), a tool result
    // (TOOL), and Staff announcements (systemSender) that mention sensitive
    // material. None of those should reach the classifier — only the
    // user/character speech should.
    repositories.chats.getMessages.mockResolvedValue([
      { type: 'message', role: 'SYSTEM', content: 'PERSONA: an assassin who builds explosives and poisons' },
      { type: 'message', role: 'user', content: 'What a lovely afternoon for tea' },
      { type: 'message', role: 'assistant', content: 'Indeed, shall I pour?' },
      { type: 'message', role: 'TOOL', content: 'TOOL_RESULT: weapon schematics and detonator wiring' },
      { type: 'message', role: 'assistant', content: 'The Concierge has flagged dangerous bomb-making content', systemSender: 'concierge' },
      { type: 'message', role: 'assistant', content: 'The Host notes a new participant joined', systemSender: 'host' },
    ]);

    mockClassifyContent.mockResolvedValue({
      isDangerous: false,
      score: 0.05,
      categories: [],
      usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
    });

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).toHaveBeenCalledTimes(1);
    const classificationInput = (mockClassifyContent.mock.calls[0] as unknown[])[0] as string;

    // Benign user/character speech is present.
    expect(classificationInput).toContain('USER: What a lovely afternoon for tea');
    expect(classificationInput).toContain('ASSISTANT: Indeed, shall I pour?');

    // The three excluded payloads must NOT leak into the classifier input —
    // this is the core of AC-3 (classification reflects conversation, not the
    // persona prompt / tool output / Staff chatter).
    expect(classificationInput).not.toContain('explosives and poisons');
    expect(classificationInput).not.toContain('weapon schematics');
    expect(classificationInput).not.toContain('bomb-making');
    expect(classificationInput).not.toContain('new participant joined');

    // And the chat is not flagged on the strength of the benign conversation.
    expect(repositories.chats.update).toHaveBeenCalled();
  });

  it('skips if no context summary AND no messages', async () => {
    repositories.chats.findById.mockResolvedValue({
      ...baseChatMetadata,
      contextSummary: null,
    });

    repositories.chats.getMessages.mockResolvedValue([]);

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(repositories.chats.update).not.toHaveBeenCalled();
  });

  it('skips if dangerous content mode is OFF', async () => {
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

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(repositories.chats.update).not.toHaveBeenCalled();
  });

  it('falls back to available profile when connection profile not found', async () => {
    repositories.connections.findById.mockResolvedValue(null);

    mockClassifyContent.mockResolvedValue({
      isDangerous: false,
      score: 0.1,
      categories: [],
      usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
    });

    await handleChatDangerClassification(buildJob());

    // Should still classify using the fallback profile from findByUserId
    expect(mockClassifyContent).toHaveBeenCalled();
    expect(repositories.chats.update).toHaveBeenCalled();
  });

  it('skips if connection profile not found and no available profiles', async () => {
    repositories.connections.findById.mockResolvedValue(null);
    repositories.connections.findByUserId.mockResolvedValue([]);

    await handleChatDangerClassification(buildJob());

    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(repositories.chats.update).not.toHaveBeenCalled();
  });

  it('does not create system event if no usage data', async () => {
    mockClassifyContent.mockResolvedValue({
      isDangerous: false,
      score: 0.0,
      categories: [],
    });

    await handleChatDangerClassification(buildJob());

    expect(repositories.chats.update).toHaveBeenCalled();
    expect(mockCreateSystemEvent).not.toHaveBeenCalled();
  });
});
