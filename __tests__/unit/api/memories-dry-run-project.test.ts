/**
 * @jest-environment node
 */
/**
 * extract-memories-dry-run: the preview hands the extractor the chat's project
 * id, the project's description and the chat's running summary, exactly as the
 * live per-turn and Carina handlers do, so it previews the same prompt (bug 230).
 */

import { NextRequest } from 'next/server';
import { handleExtractMemoriesDryRun } from '@/app/api/v1/chats/[id]/actions/memories';
import { processTurnForMemory } from '@/lib/memory/memory-processor';
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/background-jobs', () => ({
  enqueueMemoryExtractionBatch: jest.fn(),
  ensureProcessorRunning: jest.fn(),
}));
jest.mock('@/lib/memory/memory-processor', () => ({ processTurnForMemory: jest.fn() }));
jest.mock('@/lib/services/chat-message/turn-transcript', () => ({
  buildTurnTranscript: jest.fn(() => ({ characterSlices: [{ characterId: 'char-1' }] })),
  resolveUserCharacterParticipant: jest.fn(() => null),
}));
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveConciergeSettings: jest.fn(() => ({ failoverAllowed: false, routeDirect: false })),
}));
jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(() => false),
}));
jest.mock('@/lib/instance-settings', () => ({
  getMemoryExtractionLimits: jest.fn(async () => ({ enabled: false })),
}));

const mockProcess = processTurnForMemory as jest.Mock;
const mockGetRepos = getRepositories as jest.Mock;

function buildCtx(project: Record<string, unknown> | null) {
  const projectsFindById = jest.fn(async () => project);
  const repos = {
    chatSettings: {
      findByUserId: jest.fn(async () => ({ cheapLLMSettings: { defaultCheapProfileId: 'prof-1' } })),
    },
    connections: {
      findById: jest.fn(async () => ({ id: 'prof-1', userId: 'u1', provider: 'OPENAI', modelName: 'm' })),
      findByUserId: jest.fn(async () => []),
    },
    chats: {
      getMessages: jest.fn(async () => [
        { id: 'msg-1', type: 'message', role: 'USER', content: 'Hello', createdAt: '2026-10-12T10:00:00.000Z' },
      ]),
    },
    characters: { findById: jest.fn(async () => ({ id: 'char-1', name: 'Ada' })) },
    projects: { findById: projectsFindById },
  };
  // loadExtractionProjectDescription reads through the factory.
  mockGetRepos.mockReturnValue(repos);
  return { ctx: { user: { id: 'u1' }, repos } as never, projectsFindById };
}

async function drain(response: Response): Promise<void> {
  const reader = response.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProcess.mockResolvedValue({ extractedCandidates: [], debugLogs: [], sourceMessageId: 'msg-1' });
});

describe('handleExtractMemoriesDryRun — project context (bug 230)', () => {
  const req = new NextRequest('http://localhost/api/v1/chats/chat-1?action=extract-memories-dry-run');

  it('passes the project id, its description and the chat summary', async () => {
    const { ctx, projectsFindById } = buildCtx({ id: 'proj-1', description: 'A heist in Edwardian London' });
    const chat = {
      id: 'chat-1',
      projectId: 'proj-1',
      contextSummary: 'They found the map.',
      participants: [{ type: 'CHARACTER', characterId: 'char-1' }],
    };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    await drain(response);

    expect(projectsFindById).toHaveBeenCalledWith('proj-1');
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: true,
        projectId: 'proj-1',
        projectDescription: 'A heist in Edwardian London',
        chatContextSummary: 'They found the map.',
      }),
    );
  });

  it('passes nulls for a chat outside any project', async () => {
    const { ctx, projectsFindById } = buildCtx(null);
    const chat = { id: 'chat-1', participants: [{ type: 'CHARACTER', characterId: 'char-1' }] };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    await drain(response);

    expect(projectsFindById).not.toHaveBeenCalled();
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null, projectDescription: null, chatContextSummary: null }),
    );
  });
});
