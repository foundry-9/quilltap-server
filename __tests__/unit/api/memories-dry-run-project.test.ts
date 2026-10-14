/**
 * @jest-environment node
 */
/**
 * extract-memories-dry-run: the preview runs the live pipeline's own
 * extraction context in dry-run mode, so the extractor sees the chat's project
 * description and running summary and its candidates carry the project id,
 * exactly as the live per-turn and Carina handlers do (bug 230).
 *
 * End to end against mocked repositories: only the model call
 * (`executeCheapLLMTask`) and admission (`admitCandidate`) are stubbed. Also
 * pins the profile resolution (a seat's profile first, then the cheap
 * profile) and the NDJSON stream (`candidate` events carry `decision` /
 * `extractionPass`; both fold passes report a `fold` event).
 */

import { NextRequest } from 'next/server';
import { handleExtractMemoriesDryRun } from '@/app/api/v1/chats/[id]/actions/memories';
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
jest.mock('@/lib/background-jobs', () => ({
  enqueueMemoryExtractionBatch: jest.fn(),
  ensureProcessorRunning: jest.fn(),
}));
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
  resolveSpeakerNames: jest.fn(async () => new Map([['p-1', 'Ada']])),
}));
jest.mock('@/lib/memory/cheap-llm-tasks/canon', () => ({
  loadCanonForSelfWithCommonplace: jest.fn(async () => ({ source: 'none' })),
  loadCanonForObserverAboutSubject: jest.fn(async () => ({ source: 'none' })),
  renderSelfCanonBlock: jest.fn(() => 'SELF CANON'),
  renderOtherCanonBlock: jest.fn(() => 'OTHER CANON'),
}));
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveConciergeSettings: jest.fn(() => ({ failoverAllowed: false, routeDirect: false, source: 'off-duty' })),
}));

const mockGetRepos = getRepositories as jest.Mock;

const SEAT = {
  id: 'p-1',
  type: 'CHARACTER',
  characterId: 'char-1',
  controlledBy: 'llm',
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  displayOrder: 0,
};

const MESSAGES = [
  { id: 'msg-1', type: 'message', role: 'USER', content: 'Where is the map?', createdAt: '2026-10-12T10:00:00.000Z' },
  { id: 'msg-2', type: 'message', role: 'ASSISTANT', content: 'Sewn into my coat lining.', participantId: 'p-1', createdAt: '2026-10-12T10:00:05.000Z' },
];

function profile(id: string) {
  return { id, userId: 'u1', provider: 'OPENAI', modelName: 'm' };
}

function buildCtx(project: Record<string, unknown> | null) {
  const projectsFindById = jest.fn(async () => project);
  const repos = {
    chatSettings: {
      findByUserId: jest.fn(async () => ({ cheapLLMSettings: { defaultCheapProfileId: 'prof-cheap' } })),
    },
    connections: {
      findById: jest.fn(async (id: string) => profile(id)),
      findByUserId: jest.fn(async () => []),
    },
    chats: {
      findById: jest.fn(),
      getMessages: jest.fn(async () => MESSAGES),
    },
    characters: { findById: jest.fn(async () => ({ id: 'char-1', name: 'Ada', pronouns: null })) },
    projects: { findById: projectsFindById },
  };
  // The extraction context reads through the factory; the action's own
  // profile lookup reads through the request context. Same repositories.
  mockGetRepos.mockReturnValue(repos);
  return { ctx: { user: { id: 'u1' }, repos } as never, repos, projectsFindById };
}

async function readEvents(response: Response): Promise<Array<Record<string, any>>> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(e => e.type !== 'ping');
}

function selfPromptText(): string {
  const call = jest.mocked(executeCheapLLMTask).mock.calls.find(c => c[4] === 'memory-extraction-self');
  expect(call).toBeDefined();
  return (call![1] as Array<{ content: string }>).map(m => m.content).join('\n');
}

function admitted(): Array<{ candidate: MemoryCandidate; opts: Record<string, unknown> }> {
  return jest.mocked(admitCandidate).mock.calls.map(c => ({ candidate: c[0], opts: c[2] as Record<string, unknown> }));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(resolveMemorySettings).mockResolvedValue({
    extraction: {
      limits: { enabled: false, maxPerHour: 20, softStartFraction: 0.7, softFloor: 0.7 },
      mode: { otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 },
    },
  } as never);
  // The SELF pass returns one memory; the fold passes return nothing.
  jest.mocked(executeCheapLLMTask).mockImplementation((async (
    _sel: unknown, _msgs: unknown, _user: unknown, parse: (raw: string) => unknown, taskType: string,
  ) => ({
    success: true,
    result: parse(JSON.stringify(
      taskType === 'memory-extraction-self'
        ? [{ content: 'Keeps the map sewn into a coat lining.', summary: 'Map in coat lining', importance: 0.7 }]
        : [],
    )),
  })) as never);
  jest.mocked(admitCandidate).mockImplementation((async () => ({
    action: { kind: 'insert' },
    memory: null,
    novelDetails: [],
    linkedIds: [],
    trace: { thresholds: {}, assessments: [], embeddingAttempts: 1, orphansIgnored: 0, searchedK: 5, notes: [] },
  })) as never);
});

describe('handleExtractMemoriesDryRun — project context (bug 230)', () => {
  const req = new NextRequest('http://localhost/api/v1/chats/chat-1?action=extract-memories-dry-run');

  it('sends the project description and chat summary, and its candidates carry the project id', async () => {
    const { ctx, projectsFindById } = buildCtx({ id: 'proj-1', description: 'A heist in Edwardian London' });
    const chat = { id: 'chat-1', projectId: 'proj-1', contextSummary: 'They found the map.', participants: [SEAT] };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    await readEvents(response as unknown as Response);

    expect(projectsFindById).toHaveBeenCalledWith('proj-1');
    expect(selfPromptText()).toContain('PROJECT: A heist in Edwardian London');
    expect(selfPromptText()).toContain('STORY SO FAR: They found the map.');
    expect(admitted()).toHaveLength(1);
    expect(admitted()[0].candidate.provenance.projectId).toBe('proj-1');
    // A dry run decides and writes nothing.
    expect(admitted()[0].opts).toMatchObject({ dryRun: true });
  });

  it('sends no orienting lines and a null project for a chat outside any project', async () => {
    const { ctx, projectsFindById } = buildCtx(null);
    const chat = { id: 'chat-1', participants: [SEAT] };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    await readEvents(response as unknown as Response);

    expect(projectsFindById).not.toHaveBeenCalled();
    expect(selfPromptText()).not.toContain('PROJECT:');
    expect(selfPromptText()).not.toContain('STORY SO FAR:');
    expect(admitted()[0].candidate.provenance.projectId).toBeNull();
  });
});

describe('handleExtractMemoriesDryRun — profile and stream', () => {
  const req = new NextRequest('http://localhost/api/v1/chats/chat-1?action=extract-memories-dry-run&concurrency=2');

  it('runs on a seat profile first, without consulting the cheap profile', async () => {
    const { ctx, repos } = buildCtx(null);
    const chat = { id: 'chat-1', participants: [{ ...SEAT, connectionProfileId: 'prof-seat' }] };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    await readEvents(response as unknown as Response);

    expect(repos.connections.findById).toHaveBeenCalledWith('prof-seat');
    expect(repos.connections.findById).not.toHaveBeenCalledWith('prof-cheap');
  });

  it('falls back to the cheap profile when no seat names one', async () => {
    const { ctx, repos } = buildCtx(null);
    const chat = { id: 'chat-1', participants: [SEAT] };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    await readEvents(response as unknown as Response);

    expect(repos.connections.findById).toHaveBeenCalledWith('prof-cheap');
  });

  it('refuses when neither a seat nor the cheap settings name a profile', async () => {
    const { ctx, repos } = buildCtx(null);
    repos.chatSettings.findByUserId.mockResolvedValue({ cheapLLMSettings: {} } as never);
    const chat = { id: 'chat-1', participants: [SEAT] };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    expect(response.status).toBe(400);
    expect(executeCheapLLMTask).not.toHaveBeenCalled();
  });

  it('streams start, the candidate with its decision and pass, the turn, both folds and done', async () => {
    const { ctx } = buildCtx(null);
    const chat = { id: 'chat-1', participants: [SEAT] };

    const response = await handleExtractMemoriesDryRun(req, 'chat-1', chat as never, ctx);
    const events = await readEvents(response as unknown as Response);

    expect(events.map(e => e.type)).toEqual(['start', 'candidate', 'turn', 'fold', 'fold', 'done']);
    expect(events[0]).toMatchObject({ chatId: 'chat-1', turnCount: 1, concurrency: 2 });
    expect(events[1]).toMatchObject({
      turnIndex: 0,
      pass: 'SELF',
      extractionPass: 'self-turn',
      decision: 'insert',
      characterId: 'char-1',
      sourceMessageId: 'msg-2',
      summary: 'Map in coat lining',
    });
    expect(events[2]).toMatchObject({ index: 0, total: 1, sourceMessageId: 'msg-2', candidatesAdded: 1 });
    expect(events.filter(e => e.type === 'fold').map(e => e.pass)).toEqual(['other-fold', 'episode-fold']);
    expect(events[5]).toEqual({ type: 'done', totalCandidates: 1 });
  });
});
