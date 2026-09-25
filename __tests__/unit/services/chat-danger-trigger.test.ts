import { triggerChatDangerClassification } from '@/lib/services/chat-message/memory-trigger.service';
import { enqueueChatDangerClassification } from '@/lib/background-jobs/queue-service';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/memory', () => ({
  processMessageForMemoryAsync: jest.fn(),
  processInterCharacterMemoryAsync: jest.fn(),
}));

jest.mock('@/lib/chat/context-summary', () => ({
  checkAndGenerateSummaryIfNeeded: jest.fn(),
}));

jest.mock('@/lib/services/system-events.service', () => ({
  createMemoryExtractionEvent: jest.fn(),
}));

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueChatDangerClassification: jest.fn(),
}));

const mockEnqueue = enqueueChatDangerClassification as jest.MockedFunction<typeof enqueueChatDangerClassification>;

// The real Concierge resolver runs: the summary classifier is on duty when the
// Concierge is enabled, the chat is Moderated, and the operator opted in.
const summaryClassifierOn = {
  conciergeSettings: {
    enabled: true,
    preScreen: {
      enabled: false,
      threshold: 0.7,
      scanTextChat: true,
      scanImagePrompts: true,
      scanImageGeneration: false,
      summaryClassification: true,
    },
  },
};

const buildRepos = (chatOverrides: Record<string, unknown> = {}, chatSettings: unknown = summaryClassifierOn) => ({
  chatSettings: {
    findByUserId: jest.fn().mockResolvedValue(chatSettings),
  },
  chats: {
    findById: jest.fn().mockResolvedValue({
      id: 'chat-1',
      contextSummary: 'A conversation about cats.',
      messageCount: 10,
      isDangerousChat: null,
      dangerClassifiedAt: null,
      dangerClassifiedAtMessageCount: null,
      ...chatOverrides,
    }),
  },
  connections: {
    findByUserId: jest.fn().mockResolvedValue([]),
  },
});

const baseOptions = {
  chatId: 'chat-1',
  userId: 'user-1',
  connectionProfile: { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-4o-mini' } as any,
  chatSettings: { cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true } },
};

beforeEach(() => {
  jest.clearAllMocks();

  mockEnqueue.mockResolvedValue({ jobId: 'job-1', isNew: true });
});

describe('triggerChatDangerClassification', () => {
  it('enqueues classification job when conditions are met', async () => {
    const repos = buildRepos();
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).toHaveBeenCalledWith('user-1', {
      chatId: 'chat-1',
      connectionProfileId: 'profile-1',
    });
  });

  it('skips when the operator has not opted into the summary classifier', async () => {
    const repos = buildRepos({}, {
      conciergeSettings: { ...summaryClassifierOn.conciergeSettings, preScreen: { ...summaryClassifierOn.conciergeSettings.preScreen, summaryClassification: false } },
    });
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips when the Concierge is off duty', async () => {
    const repos = buildRepos({}, {
      conciergeSettings: { ...summaryClassifierOn.conciergeSettings, enabled: false },
    });
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips when no Concierge settings are stored (summary classifier off by default)', async () => {
    const repos = buildRepos({}, null);
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips when chat not found', async () => {
    const repos = buildRepos();
    repos.chats.findById.mockResolvedValue(null);
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips when already classified as dangerous (sticky)', async () => {
    const repos = buildRepos({ isDangerousChat: true });
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['locked' as const, 'operator'],
    ['unmoderated' as const, 'operator'],
  ])('skips without enqueueing when the chat is off the Moderated desk (%s / set by %s)', async (conciergeMode, conciergeModeSetBy) => {
    // Only a Moderated chat keeps the classifier on duty, and the handler
    // discards the job at its own guard — so the trigger must never enqueue
    // one. The label underneath is `false`: the chat was scanned and found
    // safe before the operator spoke, so no other guard would catch this.
    const repos = buildRepos({ conciergeMode, conciergeModeSetBy, isDangerousChat: false });
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
    // Bails before any setting lookup at all.
    expect(repos.chatSettings.findByUserId).not.toHaveBeenCalled();
  });

  it('skips when already classified at current message count', async () => {
    const repos = buildRepos({
      dangerClassifiedAt: '2026-01-01T00:00:00Z',
      dangerClassifiedAtMessageCount: 10,
      messageCount: 10,
    });
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('re-checks when message count has changed', async () => {
    const repos = buildRepos({
      dangerClassifiedAt: '2026-01-01T00:00:00Z',
      dangerClassifiedAtMessageCount: 8,
      messageCount: 10,
    });
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('skips when no context summary', async () => {
    const repos = buildRepos({ contextSummary: null });
    await triggerChatDangerClassification(repos as any, baseOptions);

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('handles errors gracefully', async () => {
    const repos = buildRepos();
    repos.chatSettings.findByUserId.mockRejectedValue(new Error('DB error'));

    // Should not throw
    await triggerChatDangerClassification(repos as any, baseOptions);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
