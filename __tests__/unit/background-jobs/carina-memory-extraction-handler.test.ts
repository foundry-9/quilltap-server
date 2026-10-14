/**
 * CARINA_MEMORY_EXTRACTION handler, end to end against mocked repositories:
 * the job builds a real extraction context, so the chat's project and running
 * summary reach a Carina answer exactly as they do an ordinary turn, and a
 * Carina-formed memory in a project chat carries the project id (bug 222).
 *
 * Only the model call (`executeCheapLLMTask`) and admission's write
 * (`admitCandidate`) are stubbed; the assertions read the candidate handed to
 * admission and the prompt handed to the model.
 */

import { handleCarinaMemoryExtraction } from '@/lib/background-jobs/handlers/carina-memory-extraction';
import { getRepositories } from '@/lib/repositories/factory';
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution';
import { admitCandidate } from '@/lib/memory/admission';
import { resolveMemorySettings } from '@/lib/memory/settings';
import type { MemoryCandidate } from '@/lib/memory/candidate';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  ...jest.requireActual('@/lib/memory/cheap-llm-tasks/core-execution'),
  executeCheapLLMTask: jest.fn(),
}));
jest.mock('@/lib/memory/admission', () => ({
  ...jest.requireActual('@/lib/memory/admission'),
  admitCandidate: jest.fn(),
}));
jest.mock('@/lib/memory/settings', () => ({ resolveMemorySettings: jest.fn() }));
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }));
jest.mock('@/lib/chat/speaker-names', () => ({
  ...jest.requireActual('@/lib/chat/speaker-names'),
  resolveSpeakerNames: jest.fn(async () => new Map()),
}));
jest.mock('@/lib/memory/cheap-llm-tasks/canon', () => ({
  loadCanonForSelfWithCommonplace: jest.fn(async () => ({ source: 'none' })),
  loadCanonForObserverAboutSubject: jest.fn(async () => ({ source: 'none' })),
  renderSelfCanonBlock: jest.fn(() => 'SELF CANON'),
  renderOtherCanonBlock: jest.fn(() => 'OTHER CANON'),
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

const mockRepos = getRepositories as jest.Mock;

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

function admitted(): MemoryCandidate[] {
  return jest.mocked(admitCandidate).mock.calls.map(c => c[0]);
}

function promptText(): string {
  const messages = jest.mocked(executeCheapLLMTask).mock.calls[0][1] as Array<{ content: string }>;
  return messages.map(m => m.content).join('\n');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveMemorySettings).mockResolvedValue({
    extraction: {
      limits: { enabled: false, maxPerHour: 20, softStartFraction: 0.7, softFloor: 0.7 },
      mode: { otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 },
    },
  } as never);
  jest.mocked(executeCheapLLMTask).mockImplementation((async (
    _sel: unknown, _msgs: unknown, _user: unknown, parse: (raw: string) => unknown,
  ) => ({
    success: true,
    result: parse(JSON.stringify([{ content: 'Told them the vault opens at midnight.', summary: 'Vault at midnight', importance: 0.6 }])),
  })) as never);
  jest.mocked(admitCandidate).mockImplementation((async () => ({
    action: { kind: 'insert' },
    memory: { id: 'mem-1' },
    novelDetails: [],
    linkedIds: [],
    trace: { thresholds: {}, assessments: [], embeddingAttempts: 1, orphansIgnored: 0, searchedK: 5, notes: [] },
  })) as never);
});

describe('handleCarinaMemoryExtraction — project and summary (bug 222)', () => {
  it('admits the memory with the chat project id and sends its description and the chat summary', async () => {
    const lookup = primeRepos(
      { id: 'chat-1', projectId: 'proj-1', contextSummary: 'They found the map.', participants: [], chatType: 'salon' },
      { id: 'proj-1', description: 'A heist in Edwardian London' },
    );

    await handleCarinaMemoryExtraction(job as never);

    expect(lookup).toHaveBeenCalledWith('proj-1');
    expect(admitted()).toHaveLength(1);
    expect(admitted()[0].provenance).toMatchObject({ projectId: 'proj-1', pass: 'carina', chatId: 'chat-1' });
    expect(promptText()).toContain('PROJECT: A heist in Edwardian London');
    expect(promptText()).toContain('STORY SO FAR: They found the map.');
  });

  it('carries a null project for a chat outside any project', async () => {
    const lookup = primeRepos({ id: 'chat-1', participants: [], chatType: 'salon' }, null);
    await handleCarinaMemoryExtraction(job as never);

    expect(lookup).not.toHaveBeenCalled();
    expect(admitted()[0].provenance.projectId).toBeNull();
    expect(promptText()).not.toContain('PROJECT:');
    expect(promptText()).not.toContain('STORY SO FAR:');
  });

  it('keeps the project id and drops only the description when the project store is unreadable', async () => {
    const lookup = primeRepos({ id: 'chat-1', projectId: 'proj-x', participants: [], chatType: 'salon' }, null);
    lookup.mockRejectedValue(new Error('project store unreadable'));

    await handleCarinaMemoryExtraction(job as never);

    expect(admitted()[0].provenance.projectId).toBe('proj-x');
    expect(promptText()).not.toContain('PROJECT:');
  });
});
