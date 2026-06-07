/**
 * Unit tests for Carina's core service: `runCarinaQuery`.
 *
 * jest.setup.ts already globally mocks:
 *   - `@/lib/repositories/factory` (getRepositories)
 *   - `@/lib/database/manager`
 *   - LLM providers (openai, @anthropic-ai/sdk)
 *   - file-storage bridges
 *
 * We configure per-test via jest.mocked(...) in beforeEach — no re-mocking.
 * Additional module-level mocks below follow the repo convention:
 * BARE factory functions with jest.mocked wiring in beforeEach.
 *
 * NOTE: `postCarinaResponse` is mocked here (writer.ts). Testing that the
 * REAL writer sets systemSender:'carina' on the message is out of scope for
 * this suite — we assert only the arguments passed to the mock.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { runCarinaQuery } from '../carina.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/chat/context/system-prompt-builder', () => ({
  buildIdentityStack: jest.fn(),
}));

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  buildTools: jest.fn(),
  streamMessage: jest.fn(),
}));

jest.mock('@/lib/services/chat-message/tool-execution.service', () => ({
  detectToolCallsInResponse: jest.fn(),
  processToolCalls: jest.fn(),
  createToolContext: jest.fn(),
}));

jest.mock('@/lib/plugins/provider-registry', () => ({
  supportsCapability: jest.fn(),
}));

jest.mock('../writer', () => ({
  postCarinaResponse: jest.fn(),
}));

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: jest.fn(),
}));

jest.mock('@/lib/chat/context/memory-injector', () => ({
  formatMemoriesForContext: jest.fn(),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueCarinaMemoryExtraction: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { buildIdentityStack } from '@/lib/chat/context/system-prompt-builder';
import {
  buildTools,
  streamMessage,
} from '@/lib/services/chat-message/streaming.service';
import {
  detectToolCallsInResponse,
  processToolCalls,
  createToolContext,
} from '@/lib/services/chat-message/tool-execution.service';
import { supportsCapability } from '@/lib/plugins/provider-registry';
import { postCarinaResponse } from '../writer';
import { searchMemoriesSemantic } from '@/lib/memory/memory-service';
import { formatMemoriesForContext } from '@/lib/chat/context/memory-injector';
import { enqueueCarinaMemoryExtraction } from '@/lib/background-jobs/queue-service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CHARACTER = {
  id: 'char-1',
  name: 'Aria',
  canBeCarina: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  scenarios: [],
  defaultScenarioId: null,
  defaultSystemPromptId: null,
  defaultConnectionProfileId: null,
  defaultHelpToolsEnabled: false,
};

const MOCK_CONNECTION_PROFILE = {
  id: 'conn-1',
  provider: 'anthropic',
  apiKeyId: 'key-1',
  parameters: {},
  model: 'claude-3-haiku',
};

const MOCK_API_KEY = {
  id: 'key-1',
  key_value: 'sk-test-key',
};

const MOCK_CHAT = {
  id: 'chat-1',
  participants: [{ id: 'part-1', type: 'CHARACTER', characterId: 'char-1' }],
  imageProfileId: null,
  projectId: null,
  disabledTools: [],
  disabledToolGroups: [],
};

const BASE_OPTS = {
  userId: 'user-1',
  chatId: 'chat-1',
  characterName: 'Aria',
  question: 'What is the capital of France?',
  whisper: false,
  askerParticipantId: null,
};

/** Helper: build a minimal mock repos object. */
function makeMockRepos(overrides: Record<string, unknown> = {}) {
  return {
    characters: {
      findByUserId: jest.fn().mockResolvedValue([MOCK_CHARACTER]),
    },
    connections: {
      findById: jest.fn().mockResolvedValue(MOCK_CONNECTION_PROFILE),
      findDefault: jest.fn().mockResolvedValue(MOCK_CONNECTION_PROFILE),
      findByUserId: jest.fn().mockResolvedValue([MOCK_CONNECTION_PROFILE]),
      findApiKeyById: jest.fn().mockResolvedValue(MOCK_API_KEY),
    },
    chats: {
      findById: jest.fn().mockResolvedValue(MOCK_CHAT),
      getMessages: jest.fn().mockResolvedValue([]),
      addMessage: jest.fn().mockResolvedValue(undefined),
    },
    imageProfiles: {
      findById: jest.fn().mockResolvedValue(null),
    },
    projectDocMountLinks: {
      findByProjectId: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

/** Default streamMessage async generator: yields a content chunk then done. */
async function* defaultStream() {
  yield { content: 'Paris.' };
  yield { done: true, rawResponse: { finishReason: 'stop' } };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  jest.mocked(getRepositories).mockReturnValue(makeMockRepos() as never);

  jest.mocked(buildIdentityStack).mockReturnValue('Identity stack text');

  jest.mocked(buildTools).mockResolvedValue({
    tools: [{ function: { name: 'web_search' } }],
    modelSupportsNativeTools: true,
    useNativeWebSearch: false,
  } as never);

  jest.mocked(streamMessage).mockImplementation(async function* () {
    yield { content: 'Paris.' };
    yield { done: true, rawResponse: { finishReason: 'stop' } };
  } as never);

  jest.mocked(detectToolCallsInResponse).mockReturnValue([]);
  jest.mocked(processToolCalls).mockResolvedValue({ toolMessages: [] } as never);
  jest.mocked(createToolContext).mockReturnValue({} as never);
  jest.mocked(supportsCapability).mockReturnValue(true);

  // By default no memories are recalled, so the system prompt is unchanged and
  // the existing assertions hold. Specific tests override these.
  jest.mocked(searchMemoriesSemantic).mockResolvedValue([]);
  jest.mocked(formatMemoriesForContext).mockReturnValue({
    content: '',
    tokenCount: 0,
    memoriesUsed: 0,
    debugMemories: [],
  } as never);
  jest.mocked(enqueueCarinaMemoryExtraction).mockResolvedValue('job-mem-1' as never);
  // postCarinaResponse returns the posted MessageEvent (the service reads
  // `.id` for messageId and splices the whole message into context upstream).
  jest.mocked(postCarinaResponse).mockResolvedValue({
    id: 'msg-123',
    type: 'message',
    role: 'ASSISTANT',
    content: 'Paris.',
    systemSender: 'carina',
    systemKind: 'carina-response',
    createdAt: '2026-06-07T00:00:00.000Z',
  } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runCarinaQuery', () => {
  // ── 1. Happy path (public) ────────────────────────────────────────────────

  describe('happy path (public answer)', () => {
    it('returns ok:true with answer text and calls postCarinaResponse correctly', async () => {
      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({
        ok: true,
        answer: 'Paris.',
        messageId: 'msg-123',
        answererId: 'char-1',
        answererName: 'Aria',
      });

      expect(postCarinaResponse).toHaveBeenCalledTimes(1);
      const writerCall = jest.mocked(postCarinaResponse).mock.calls[0][0];
      expect(writerCall.whisper).toBe(false);
      expect(writerCall.answererId).toBe('char-1');
      expect(writerCall.question).toBe('What is the capital of France?');
      expect(writerCall.chatId).toBe('chat-1');

      // The posted message is returned so the orchestrator can splice it into
      // the same-turn context (the public same-cycle relay fix).
      expect(result.ok && result.message?.id).toBe('msg-123');
      expect(result.ok && result.message?.systemSender).toBe('carina');
    });

    it('resolves answerer case-insensitively (lower-case query)', async () => {
      const result = await runCarinaQuery({ ...BASE_OPTS, characterName: 'aria' });
      expect(result).toMatchObject({ ok: true, answererName: 'Aria' });
    });

    it('resolves answerer case-insensitively (mixed-case query)', async () => {
      const result = await runCarinaQuery({ ...BASE_OPTS, characterName: 'ARIA' });
      expect(result).toMatchObject({ ok: true, answererName: 'Aria' });
    });
  });

  // ── 2. Whisper path ───────────────────────────────────────────────────────

  describe('whisper path', () => {
    it('passes whisper:true and askerParticipantId to postCarinaResponse', async () => {
      const result = await runCarinaQuery({
        ...BASE_OPTS,
        whisper: true,
        askerParticipantId: 'p1',
      });

      expect(result).toMatchObject({ ok: true });
      const writerCall = jest.mocked(postCarinaResponse).mock.calls[0][0];
      expect(writerCall.whisper).toBe(true);
      expect(writerCall.askerParticipantId).toBe('p1');
    });

    it('passes whisper:true with null askerParticipantId when not provided', async () => {
      const result = await runCarinaQuery({
        ...BASE_OPTS,
        whisper: true,
        askerParticipantId: null,
      });

      expect(result).toMatchObject({ ok: true });
      const writerCall = jest.mocked(postCarinaResponse).mock.calls[0][0];
      expect(writerCall.whisper).toBe(true);
      expect(writerCall.askerParticipantId).toBeNull();
    });
  });

  // ── 3. Not found ──────────────────────────────────────────────────────────

  describe('not found', () => {
    it('returns not-found when no character matches the name', async () => {
      jest.mocked(getRepositories).mockReturnValue(
        makeMockRepos({
          characters: { findByUserId: jest.fn().mockResolvedValue([]) },
        }) as never,
      );

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'not-found', characterName: 'Aria' } });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });

    it('returns not-found when character exists but canBeCarina is false', async () => {
      jest.mocked(getRepositories).mockReturnValue(
        makeMockRepos({
          characters: {
            findByUserId: jest.fn().mockResolvedValue([
              { ...MOCK_CHARACTER, canBeCarina: false },
            ]),
          },
        }) as never,
      );

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'not-found' } });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });

    it('returns not-found when character exists but canBeCarina is null', async () => {
      jest.mocked(getRepositories).mockReturnValue(
        makeMockRepos({
          characters: {
            findByUserId: jest.fn().mockResolvedValue([
              { ...MOCK_CHARACTER, canBeCarina: null },
            ]),
          },
        }) as never,
      );

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'not-found' } });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });

    it('returns not-found when name matches but is a different character', async () => {
      jest.mocked(getRepositories).mockReturnValue(
        makeMockRepos({
          characters: {
            findByUserId: jest.fn().mockResolvedValue([
              { ...MOCK_CHARACTER, name: 'Beatrix' },
            ]),
          },
        }) as never,
      );

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'not-found' } });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });
  });

  // ── 4. Connection-profile chain ───────────────────────────────────────────

  describe('connection profile resolution chain', () => {
    it('(a) uses defaultConnectionProfileId when present', async () => {
      const charWithDefault = { ...MOCK_CHARACTER, defaultConnectionProfileId: 'conn-1' };
      const repos = makeMockRepos({
        characters: { findByUserId: jest.fn().mockResolvedValue([charWithDefault]) },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      await runCarinaQuery(BASE_OPTS);

      expect(repos.connections.findById).toHaveBeenCalledWith('conn-1');
      // findDefault should NOT be called because findById succeeded
      expect(repos.connections.findDefault).not.toHaveBeenCalled();
    });

    it('(a) falls through to findDefault when defaultConnectionProfileId is missing', async () => {
      // MOCK_CHARACTER has no defaultConnectionProfileId
      const repos = makeMockRepos();
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      await runCarinaQuery(BASE_OPTS);

      expect(repos.connections.findById).not.toHaveBeenCalled();
      expect(repos.connections.findDefault).toHaveBeenCalledWith('user-1');
    });

    it('(a) falls through when defaultConnectionProfileId resolves to null', async () => {
      const charWithDefault = { ...MOCK_CHARACTER, defaultConnectionProfileId: 'conn-dead' };
      const repos = makeMockRepos({
        characters: { findByUserId: jest.fn().mockResolvedValue([charWithDefault]) },
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findDefault: jest.fn().mockResolvedValue(MOCK_CONNECTION_PROFILE),
          findByUserId: jest.fn().mockResolvedValue([]),
          findApiKeyById: jest.fn().mockResolvedValue(MOCK_API_KEY),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: true });
      expect(repos.connections.findDefault).toHaveBeenCalledWith('user-1');
    });

    it('(b) falls through to findByUserId when findDefault returns null', async () => {
      const webSearchProfile = { ...MOCK_CONNECTION_PROFILE, id: 'conn-web' };
      const repos = makeMockRepos({
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findDefault: jest.fn().mockResolvedValue(null),
          findByUserId: jest.fn().mockResolvedValue([webSearchProfile]),
          findApiKeyById: jest.fn().mockResolvedValue(MOCK_API_KEY),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);
      jest.mocked(supportsCapability).mockReturnValue(true);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: true });
      expect(repos.connections.findByUserId).toHaveBeenCalledWith('user-1');
      expect(supportsCapability).toHaveBeenCalledWith(webSearchProfile.provider, 'webSearch');
    });

    it('(c) returns no-profile when all fallbacks return null/empty', async () => {
      const repos = makeMockRepos({
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findDefault: jest.fn().mockResolvedValue(null),
          findByUserId: jest.fn().mockResolvedValue([]),
          findApiKeyById: jest.fn().mockResolvedValue(null),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'no-profile' } });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });

    it('(c) returns no-profile when findByUserId profiles exist but none support webSearch', async () => {
      const noWebSearchProfile = { ...MOCK_CONNECTION_PROFILE, id: 'conn-no-ws' };
      const repos = makeMockRepos({
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findDefault: jest.fn().mockResolvedValue(null),
          findByUserId: jest.fn().mockResolvedValue([noWebSearchProfile]),
          findApiKeyById: jest.fn().mockResolvedValue(null),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);
      jest.mocked(supportsCapability).mockReturnValue(false);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'no-profile' } });
    });
  });

  // ── 5. Tool access + ask_carina stripped ──────────────────────────────────

  describe('tool loop and ask_carina stripping', () => {
    it('strips ask_carina from tools passed to streamMessage', async () => {
      jest.mocked(buildTools).mockResolvedValue({
        tools: [
          { function: { name: 'ask_carina' } },
          { function: { name: 'web_search' } },
        ],
        modelSupportsNativeTools: true,
        useNativeWebSearch: false,
      } as never);

      // First call has a tool response; second call returns the final answer
      const FAKE_RAW = { finishReason: 'tool_calls' };
      jest.mocked(streamMessage)
        .mockImplementationOnce(async function* () {
          yield { content: '' };
          yield { done: true, rawResponse: FAKE_RAW };
        } as never)
        .mockImplementationOnce(async function* () {
          yield { content: 'Paris.' };
          yield { done: true, rawResponse: { finishReason: 'stop' } };
        } as never);

      jest.mocked(detectToolCallsInResponse)
        .mockReturnValueOnce([{ name: 'web_search', arguments: {}, callId: 'call-1' }])
        .mockReturnValueOnce([]);

      jest.mocked(processToolCalls).mockResolvedValue({
        toolMessages: [{ toolName: 'web_search', content: 'Paris is the capital.', callId: 'call-1' }],
      } as never);

      await runCarinaQuery(BASE_OPTS);

      // Both streamMessage calls should have been made
      expect(streamMessage).toHaveBeenCalledTimes(2);

      // Neither call should have tools containing ask_carina
      for (const call of jest.mocked(streamMessage).mock.calls) {
        const passedTools: Array<{ function?: { name?: string }; name?: string }> =
          (call[0] as { tools?: Array<{ function?: { name?: string }; name?: string }> }).tools ?? [];
        const hasAskCarina = passedTools.some(
          (t) => t.function?.name === 'ask_carina' || t.name === 'ask_carina',
        );
        expect(hasAskCarina).toBe(false);
      }
    });

    it('runs tool loop up to MAX_TOOL_ITERATIONS without infinite looping', async () => {
      const FAKE_RAW = { finishReason: 'tool_calls' };
      // Always return a tool call — the loop should cap at 5 iterations
      jest.mocked(streamMessage).mockImplementation(async function* () {
        yield { content: 'partial' };
        yield { done: true, rawResponse: FAKE_RAW };
      } as never);

      jest.mocked(detectToolCallsInResponse).mockReturnValue([
        { name: 'web_search', arguments: {}, callId: 'call-x' },
      ]);
      jest.mocked(processToolCalls).mockResolvedValue({
        toolMessages: [{ toolName: 'web_search', content: 'result', callId: 'call-x' }],
      } as never);

      const result = await runCarinaQuery(BASE_OPTS);

      // 1 initial call + 5 tool-loop calls = 6 total; result is empty → llm-failed
      // (because accumulated answer from 'partial' is non-empty after trim — actually
      // the loop replaces answer each iteration; last iteration also yields 'partial')
      // The service should return ok:true with answer 'partial' after hitting MAX_TOOL_ITERATIONS
      // because after MAX_TOOL_ITERATIONS iterations the while loop exits with rawResponse set
      // but detectToolCallsInResponse would have been called 5+1=6 times... let's just check
      // that streamMessage was called more than once (loop ran) and postCarinaResponse was called.
      expect(streamMessage).toHaveBeenCalledTimes(6); // 1 initial + 5 loop iterations
      // The answer from the last stream iteration is 'partial', which is non-empty
      expect(result).toMatchObject({ ok: true, answer: 'partial' });
    });
  });

  // ── 6. Empty answer → llm-failed ─────────────────────────────────────────

  describe('empty answer', () => {
    it('returns llm-failed when streamMessage yields no content', async () => {
      jest.mocked(streamMessage).mockImplementation(async function* () {
        yield { done: true, rawResponse: { finishReason: 'stop' } };
      } as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'llm-failed', detail: 'empty response' },
      });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });

    it('returns llm-failed when streamMessage yields only whitespace content', async () => {
      jest.mocked(streamMessage).mockImplementation(async function* () {
        yield { content: '   \n  ' };
        yield { done: true, rawResponse: { finishReason: 'stop' } };
      } as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'llm-failed' } });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });
  });

  // ── 7. streamMessage throws → llm-failed ─────────────────────────────────

  describe('streamMessage throws', () => {
    it('returns llm-failed (never throws) when streamMessage throws', async () => {
      jest.mocked(streamMessage).mockImplementation(async function* () {
        throw new Error('Connection reset');
      } as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'llm-failed' },
      });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });

    it('returns llm-failed (never throws) when streamMessage rejects during iteration', async () => {
      jest.mocked(streamMessage).mockImplementation(async function* () {
        yield { content: 'partial' };
        throw new Error('Stream interrupted');
      } as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'llm-failed' },
      });
    });
  });

  // ── 8. postCarinaResponse args (memory-suppression + systemSender note) ───

  describe('postCarinaResponse arguments (memory-suppression tag)', () => {
    /**
     * NOTE: The `systemSender:'carina'` tag that suppresses memory extraction
     * is set inside the REAL postCarinaResponse (writer.ts), not in this service.
     * Since the writer is mocked here, we cannot assert systemSender directly.
     * Instead we verify the args passed to the writer that determine routing:
     * answererId, question, participantId, chatId.
     *
     * A separate test of the real writer (writer.test.ts) would cover systemSender
     * and carinaMeta construction.
     */
    it('passes the correct answererId, question, participantId, and chatId to postCarinaResponse', async () => {
      await runCarinaQuery(BASE_OPTS);

      expect(postCarinaResponse).toHaveBeenCalledTimes(1);
      const args = jest.mocked(postCarinaResponse).mock.calls[0][0];

      expect(args.answererId).toBe('char-1');
      expect(args.question).toBe('What is the capital of France?');
      expect(args.participantId).toBe('part-1'); // answerer's participant id from chat
      expect(args.chatId).toBe('chat-1');
    });

    it('passes participantId as null when answerer is not a participant in the chat', async () => {
      const chatWithoutAnswerer = {
        ...MOCK_CHAT,
        participants: [{ id: 'part-99', type: 'CHARACTER', characterId: 'char-999' }],
      };
      const repos = makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue(chatWithoutAnswerer),
          getMessages: jest.fn().mockResolvedValue([]),
          addMessage: jest.fn().mockResolvedValue(undefined),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      await runCarinaQuery(BASE_OPTS);

      const args = jest.mocked(postCarinaResponse).mock.calls[0][0];
      expect(args.participantId).toBeNull();
    });
  });

  // ── Additional edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns llm-failed when chat is not found', async () => {
      const repos = makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue(null),
          getMessages: jest.fn().mockResolvedValue([]),
          addMessage: jest.fn().mockResolvedValue(undefined),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: false, error: { kind: 'llm-failed', detail: 'chat not found' } });
      expect(postCarinaResponse).not.toHaveBeenCalled();
    });

    it('returns llm-failed when postCarinaResponse returns null (persist failure)', async () => {
      jest.mocked(postCarinaResponse).mockResolvedValue(null);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'llm-failed', detail: 'failed to persist answer' },
      });
    });

    it('picks first canBeCarina:true character by createdAt when multiple match', async () => {
      const older = { ...MOCK_CHARACTER, id: 'char-old', createdAt: '2023-01-01T00:00:00.000Z' };
      const newer = { ...MOCK_CHARACTER, id: 'char-new', createdAt: '2024-01-01T00:00:00.000Z' };
      const repos = makeMockRepos({
        characters: { findByUserId: jest.fn().mockResolvedValue([newer, older]) },
        chats: {
          findById: jest.fn().mockResolvedValue({
            ...MOCK_CHAT,
            participants: [
              { id: 'part-old', type: 'CHARACTER', characterId: 'char-old' },
              { id: 'part-new', type: 'CHARACTER', characterId: 'char-new' },
            ],
          }),
          getMessages: jest.fn().mockResolvedValue([]),
          addMessage: jest.fn().mockResolvedValue(undefined),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: true, answererId: 'char-old' });
    });

    it('does not call findApiKeyById when connection profile has no apiKeyId', async () => {
      const profileNoKey = { ...MOCK_CONNECTION_PROFILE, apiKeyId: null };
      const repos = makeMockRepos({
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findDefault: jest.fn().mockResolvedValue(profileNoKey),
          findByUserId: jest.fn().mockResolvedValue([]),
          findApiKeyById: jest.fn().mockResolvedValue(null),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      const result = await runCarinaQuery(BASE_OPTS);

      expect(result).toMatchObject({ ok: true });
      expect(repos.connections.findApiKeyById).not.toHaveBeenCalled();
    });

    it('loads prior carina exchanges from chat messages for continuity', async () => {
      const priorCarinaMsg = {
        id: 'prev-msg',
        type: 'message',
        systemSender: 'carina',
        systemKind: 'carina-response',
        content: 'Lyon is the second city.',
        carinaMeta: { answererId: 'char-1', question: 'What is the second city?' },
      };
      const repos = makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue(MOCK_CHAT),
          getMessages: jest.fn().mockResolvedValue([priorCarinaMsg]),
          addMessage: jest.fn().mockResolvedValue(undefined),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      await runCarinaQuery(BASE_OPTS);

      // The prior exchange should appear in the messages array passed to streamMessage
      const messagesArg: Array<{ role: string; content: string }> =
        (jest.mocked(streamMessage).mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
      const userExchange = messagesArg.find((m) => m.content === 'What is the second city?');
      const assistantExchange = messagesArg.find((m) => m.content === 'Lyon is the second city.');
      expect(userExchange).toBeDefined();
      expect(assistantExchange).toBeDefined();
    });

    it('ignores carina messages for OTHER answerers when loading prior exchanges', async () => {
      const priorForOtherChar = {
        id: 'prev-msg',
        type: 'message',
        systemSender: 'carina',
        systemKind: 'carina-response',
        content: 'Other answer.',
        carinaMeta: { answererId: 'char-OTHER', question: 'Some question?' },
      };
      const repos = makeMockRepos({
        chats: {
          findById: jest.fn().mockResolvedValue(MOCK_CHAT),
          getMessages: jest.fn().mockResolvedValue([priorForOtherChar]),
          addMessage: jest.fn().mockResolvedValue(undefined),
        },
      });
      jest.mocked(getRepositories).mockReturnValue(repos as never);

      await runCarinaQuery(BASE_OPTS);

      const messagesArg: Array<{ role: string; content: string }> =
        (jest.mocked(streamMessage).mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
      const otherExchange = messagesArg.find((m) => m.content === 'Other answer.');
      expect(otherExchange).toBeUndefined();
    });

    it('includes the Reference Query instruction in the system prompt', async () => {
      await runCarinaQuery(BASE_OPTS);

      const messagesArg: Array<{ role: string; content: string }> =
        (jest.mocked(streamMessage).mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
      const sysMessage = messagesArg.find((m) => m.role === 'system');
      expect(sysMessage?.content).toContain('Reference Query');
    });
  });

  // ── Memory recall into the call (Commonplace Book whisper) ────────────────
  describe('memory recall', () => {
    function withRecalledMemories() {
      jest.mocked(searchMemoriesSemantic).mockResolvedValue([
        { memory: { id: 'm1' }, score: 0.9, usedEmbedding: true },
      ] as never);
      jest.mocked(formatMemoriesForContext).mockReturnValue({
        content: '## Relevant Memories\n- [today] Aria prefers terse answers.',
        tokenCount: 20,
        memoriesUsed: 1,
        debugMemories: [],
      } as never);
    }

    it('recalls the answerer\'s memories against the question (default embedding profile)', async () => {
      withRecalledMemories();
      await runCarinaQuery(BASE_OPTS);

      expect(searchMemoriesSemantic).toHaveBeenCalledTimes(1);
      const [characterId, query, opts] = jest.mocked(searchMemoriesSemantic).mock.calls[0];
      expect(characterId).toBe('char-1');
      expect(query).toBe('What is the capital of France?');
      expect(opts).toMatchObject({ userId: 'user-1', embeddingProfileId: undefined });
    });

    it('injects the recalled memories into the system prompt', async () => {
      withRecalledMemories();
      await runCarinaQuery(BASE_OPTS);

      const messagesArg: Array<{ role: string; content: string }> =
        (jest.mocked(streamMessage).mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
      const sysMessage = messagesArg.find((m) => m.role === 'system');
      expect(sysMessage?.content).toContain('You remember the following entries');
      expect(sysMessage?.content).toContain('Aria prefers terse answers.');
    });

    it('omits the recall section when nothing relevant is found', async () => {
      // Defaults already return [] / empty content.
      await runCarinaQuery(BASE_OPTS);

      const messagesArg: Array<{ role: string; content: string }> =
        (jest.mocked(streamMessage).mock.calls[0][0] as { messages: Array<{ role: string; content: string }> }).messages;
      const sysMessage = messagesArg.find((m) => m.role === 'system');
      expect(sysMessage?.content).not.toContain('You remember the following entries');
    });

    it('answers anyway when memory recall throws', async () => {
      jest.mocked(searchMemoriesSemantic).mockRejectedValue(new Error('vector store down'));
      const result = await runCarinaQuery(BASE_OPTS);
      expect(result).toMatchObject({ ok: true, answer: 'Paris.' });
    });
  });

  // ── Memory formation (CARINA_MEMORY_EXTRACTION enqueue) ───────────────────
  describe('memory formation', () => {
    it('enqueues a Carina memory-extraction job after a successful public answer', async () => {
      await runCarinaQuery(BASE_OPTS);

      expect(enqueueCarinaMemoryExtraction).toHaveBeenCalledTimes(1);
      const [userId, payload] = jest.mocked(enqueueCarinaMemoryExtraction).mock.calls[0];
      expect(userId).toBe('user-1');
      expect(payload).toEqual({
        chatId: 'chat-1',
        carinaMessageId: 'msg-123',
        answererId: 'char-1',
        connectionProfileId: 'conn-1',
      });
    });

    it('enqueues extraction for whispered answers too', async () => {
      await runCarinaQuery({ ...BASE_OPTS, whisper: true, askerParticipantId: 'p1' });
      expect(enqueueCarinaMemoryExtraction).toHaveBeenCalledTimes(1);
    });

    it('does not enqueue extraction when the answer fails to persist', async () => {
      jest.mocked(postCarinaResponse).mockResolvedValue(null as never);
      await runCarinaQuery(BASE_OPTS);
      expect(enqueueCarinaMemoryExtraction).not.toHaveBeenCalled();
    });

    it('still returns the answer when the extraction enqueue throws', async () => {
      jest.mocked(enqueueCarinaMemoryExtraction).mockRejectedValue(new Error('queue down'));
      const result = await runCarinaQuery(BASE_OPTS);
      expect(result).toMatchObject({ ok: true, answer: 'Paris.', messageId: 'msg-123' });
    });
  });
});
