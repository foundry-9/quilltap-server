/**
 * Unit tests for the Carina memory-extraction job handler.
 *
 * The handler builds one extraction context (the answerer hydrated beside the
 * chat's cast), finds the carina message, and hands both to
 * `runCarinaExtraction`. The pipeline is mocked here except `carinaTranscript`,
 * the pure builder of the one-slice transcript that yields SELF-only memories
 * for the answerer, which is exercised directly.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/lib/memory/extraction', () => {
  const actualContext = jest.requireActual('@/lib/memory/extraction/context');
  const actualTurn = jest.requireActual('@/lib/memory/extraction/turn');
  return {
    ExtractionContextError: actualContext.ExtractionContextError,
    carinaTranscript: actualTurn.carinaTranscript,
    buildExtractionContext: jest.fn(),
    runCarinaExtraction: jest.fn(),
    runTurnExtraction: jest.fn(),
    runFoldCatchup: jest.fn(),
  };
});

jest.mock('@/lib/services/system-events.service', () => ({
  createMemoryExtractionEvent: jest.fn(),
}));

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { handleCarinaMemoryExtraction } from '../carina-memory-extraction';
import { getRepositories } from '@/lib/repositories/factory';
import {
  buildExtractionContext,
  carinaTranscript,
  ExtractionContextError,
  runCarinaExtraction,
  type ExtractionContext,
} from '@/lib/memory/extraction';
import type { BackgroundJob, MessageEvent } from '@/lib/schemas/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_PROFILE = { id: 'conn-1', provider: 'anthropic', modelName: 'claude-3-haiku' };
const MOCK_ANSWERER = { id: 'char-1', name: 'Aria', pronouns: { subject: 'she' } };

const MOCK_CARINA_MESSAGE = {
  type: 'message',
  id: 'carina-msg-1',
  role: 'ASSISTANT',
  content: 'Paris is the capital of France.',
  systemSender: 'carina',
  systemKind: 'carina-response',
  createdAt: '2026-06-07T00:00:00.000Z',
  carinaMeta: { answererId: 'char-1', question: 'What is the capital of France?' },
} as unknown as MessageEvent;

const JOB = {
  id: 'job-1',
  userId: 'user-1',
  type: 'CARINA_MEMORY_EXTRACTION',
  payload: {
    chatId: 'chat-1',
    carinaMessageId: 'carina-msg-1',
    answererId: 'char-1',
    connectionProfileId: 'conn-1',
  },
} as unknown as BackgroundJob;

function makeCtx(overrides: { messages?: MessageEvent[]; cast?: Map<string, unknown> } = {}): ExtractionContext {
  const cast = overrides.cast ?? new Map([
    ['char-1', {
      characterId: 'char-1',
      participantId: null,
      name: 'Aria',
      pronouns: MOCK_ANSWERER.pronouns,
      isUser: false,
      present: false,
      character: MOCK_ANSWERER,
    }],
  ]);
  return {
    chat: { id: 'chat-1' },
    project: { id: null, description: null },
    route: { connectionProfile: MOCK_PROFILE },
    cast,
    userCharacter: null,
    messages: jest.fn(async () => overrides.messages ?? [MOCK_CARINA_MESSAGE]),
  } as unknown as ExtractionContext;
}

let repos: { connections: { findById: jest.Mock }; chats: { updateMessage: jest.Mock } };

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  repos = {
    connections: { findById: jest.fn().mockResolvedValue(MOCK_PROFILE) },
    chats: { updateMessage: jest.fn().mockResolvedValue(undefined) },
  };
  jest.mocked(getRepositories).mockReturnValue(repos as never);
  jest.mocked(buildExtractionContext).mockResolvedValue(makeCtx());
  jest.mocked(runCarinaExtraction).mockResolvedValue({
    pass: 'self-turn',
    calls: 1,
    timedOut: 0,
    failed: 0,
    admitted: [],
    createdIds: ['mem-1'],
    reinforcedIds: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    debugLogs: ['[Memory] created'],
    sourceMessageId: 'carina-msg-1',
    hadContributions: true,
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleCarinaMemoryExtraction', () => {
  it('hydrates the answerer into the one context and extracts from the carina message', async () => {
    await handleCarinaMemoryExtraction(JOB);

    expect(buildExtractionContext).toHaveBeenCalledTimes(1);
    expect(buildExtractionContext).toHaveBeenCalledWith('chat-1', 'user-1', {
      connectionProfile: MOCK_PROFILE,
      extraCharacterIds: ['char-1'],
    });
    expect(runCarinaExtraction).toHaveBeenCalledTimes(1);
    const [ctx, message, answererId] = jest.mocked(runCarinaExtraction).mock.calls[0];
    expect(ctx.chat.id).toBe('chat-1');
    expect(message).toBe(MOCK_CARINA_MESSAGE);
    expect(answererId).toBe('char-1');
  });

  it('keeps the debug lines on the carina message itself', async () => {
    await handleCarinaMemoryExtraction(JOB);
    expect(repos.chats.updateMessage).toHaveBeenCalledWith('chat-1', 'carina-msg-1', {
      debugMemoryLogs: ['[Memory] created'],
    });
  });

  it('skips when the carina message is missing', async () => {
    jest.mocked(buildExtractionContext).mockResolvedValue(makeCtx({ messages: [] }));
    await handleCarinaMemoryExtraction(JOB);
    expect(runCarinaExtraction).not.toHaveBeenCalled();
  });

  it('skips when the answerer character is gone', async () => {
    jest.mocked(buildExtractionContext).mockResolvedValue(makeCtx({ cast: new Map() }));
    await handleCarinaMemoryExtraction(JOB);
    expect(runCarinaExtraction).not.toHaveBeenCalled();
  });

  it('records nothing when the answer has no text', async () => {
    jest.mocked(runCarinaExtraction).mockResolvedValue(null);
    await handleCarinaMemoryExtraction(JOB);
    expect(repos.chats.updateMessage).not.toHaveBeenCalled();
  });

  it('returns quietly when the chat is gone', async () => {
    jest.mocked(buildExtractionContext).mockRejectedValue(new ExtractionContextError('no-chat', 'Chat not found: chat-1'));
    await expect(handleCarinaMemoryExtraction(JOB)).resolves.toBeUndefined();
    expect(runCarinaExtraction).not.toHaveBeenCalled();
  });

  it('throws when the connection profile is missing (so the job retries)', async () => {
    repos.connections.findById.mockResolvedValue(null);
    await expect(handleCarinaMemoryExtraction(JOB)).rejects.toThrow('Connection profile not found');
    expect(buildExtractionContext).not.toHaveBeenCalled();
  });
});

describe('carinaTranscript', () => {
  it('builds a one-slice SELF transcript from the question and answer', () => {
    const transcript = carinaTranscript(makeCtx(), MOCK_CARINA_MESSAGE, 'char-1');

    // The question opens the (synthetic) turn; no user character → the OTHER
    // pass has no subject, leaving SELF-only extraction for the answerer.
    expect(transcript).not.toBeNull();
    expect(transcript!.userMessage).toBe('What is the capital of France?');
    expect(transcript!.userCharacterId).toBeUndefined();
    expect(transcript!.characterSlices).toHaveLength(1);
    expect(transcript!.characterSlices[0]).toMatchObject({
      characterId: 'char-1',
      characterName: 'Aria',
      text: 'Paris is the capital of France.',
      contributingMessageIds: ['carina-msg-1'],
    });
    expect(transcript!.latestAssistantMessageId).toBe('carina-msg-1');
  });

  it('anchors derived memories to the carina message timestamp', () => {
    const transcript = carinaTranscript(makeCtx(), MOCK_CARINA_MESSAGE, 'char-1');
    expect(transcript!.turnTimestamp).toBe('2026-06-07T00:00:00.000Z');
    expect(transcript!.characterSlices[0].lastMessageCreatedAt).toBe('2026-06-07T00:00:00.000Z');
  });

  it('is null when the answer text is empty', () => {
    const blank = { ...MOCK_CARINA_MESSAGE, content: '   ' } as MessageEvent;
    expect(carinaTranscript(makeCtx(), blank, 'char-1')).toBeNull();
  });

  it('is null when the answerer is not in the cast', () => {
    expect(carinaTranscript(makeCtx({ cast: new Map() }), MOCK_CARINA_MESSAGE, 'char-1')).toBeNull();
  });

  it('still extracts when the question is absent (answer-only memory)', () => {
    const answerOnly = {
      ...MOCK_CARINA_MESSAGE,
      carinaMeta: { answererId: 'char-1', question: '' },
    } as unknown as MessageEvent;
    const transcript = carinaTranscript(makeCtx(), answerOnly, 'char-1');
    expect(transcript!.userMessage).toBeNull();
    expect(transcript!.characterSlices).toHaveLength(1);
  });
});
