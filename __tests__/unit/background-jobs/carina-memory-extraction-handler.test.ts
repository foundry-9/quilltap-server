/**
 * CARINA_MEMORY_EXTRACTION handler: the chat's project and running summary
 * ride into processTurnForMemory exactly as they do for an ordinary turn, so
 * a Carina-formed memory in a project chat carries the project id (bug 222).
 */

import { handleCarinaMemoryExtraction } from '@/lib/background-jobs/handlers/carina-memory-extraction';
import { getRepositories } from '@/lib/repositories/factory';
import { processTurnForMemory } from '@/lib/memory/memory-processor';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/memory/memory-processor', () => ({ processTurnForMemory: jest.fn() }));
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  CheapLLMTaskLostError: class CheapLLMTaskLostError extends Error {},
}));
jest.mock('@/lib/services/system-events.service', () => ({
  createMemoryExtractionEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn().mockResolvedValue({ cost: 0, source: 'estimate' }),
}));
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveConciergeSettings: jest.fn(() => ({ failoverAllowed: false, routeDirect: false, source: 'off-duty' })),
}));
jest.mock('@/lib/instance-settings', () => ({
  getMemoryExtractionLimits: jest.fn(async () => ({ enabled: false })),
}));

const mockRepos = getRepositories as jest.Mock;
const mockProcess = processTurnForMemory as jest.Mock;

const carinaMessage = {
  id: 'carina-1',
  type: 'message',
  role: 'ASSISTANT',
  systemSender: 'carina',
  content: 'The vault opens at midnight.',
  carinaMeta: { question: 'When does the vault open?' },
  createdAt: '2026-10-12T10:00:00.000Z',
};

function primeRepos(chat: Record<string, unknown>, project: Record<string, unknown> | null) {
  const projectsFindById = jest.fn(async () => project);
  mockRepos.mockReturnValue({
    connections: {
      findById: jest.fn(async () => ({ id: 'prof-1', provider: 'OPENAI', modelName: 'm' })),
      findByUserId: jest.fn(async () => []),
    },
    chatSettings: { findByUserId: jest.fn(async () => ({ cheapLLMSettings: {} })) },
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => [carinaMessage]),
      updateMessage: jest.fn(async () => undefined),
    },
    characters: { findById: jest.fn(async () => ({ id: 'char-ans', name: 'Ada', pronouns: null })) },
    projects: { findById: projectsFindById },
  });
  return projectsFindById;
}

const job = {
  id: 'job-1',
  userId: 'u1',
  payload: { chatId: 'chat-1', answererId: 'char-ans', carinaMessageId: 'carina-1', connectionProfileId: 'prof-1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProcess.mockResolvedValue({
    success: true,
    memoriesCreatedCount: 1,
    memoriesReinforcedCount: 0,
    debugLogs: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    passesLostToTimeout: 0,
  });
});

describe('handleCarinaMemoryExtraction — project and summary (bug 222)', () => {
  it('passes the chat project id, its description and the chat summary', async () => {
    const lookup = primeRepos(
      { id: 'chat-1', projectId: 'proj-1', contextSummary: 'They found the map.', participants: [], chatType: 'salon' },
      { id: 'proj-1', description: 'A heist in Edwardian London' },
    );

    await handleCarinaMemoryExtraction(job as never);

    expect(lookup).toHaveBeenCalledWith('proj-1');
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        projectDescription: 'A heist in Edwardian London',
        chatContextSummary: 'They found the map.',
      }),
    );
  });

  it('passes nulls for a chat outside any project and degrades on a broken project store', async () => {
    primeRepos({ id: 'chat-1', participants: [], chatType: 'salon' }, null);
    await handleCarinaMemoryExtraction(job as never);
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, projectDescription: null, chatContextSummary: null }),
    );

    mockProcess.mockClear();
    const lookup = primeRepos({ id: 'chat-1', projectId: 'proj-x', participants: [], chatType: 'salon' }, null);
    lookup.mockRejectedValue(new Error('project store unreadable'));
    await handleCarinaMemoryExtraction(job as never);
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-x', projectDescription: null }),
    );
  });
});
