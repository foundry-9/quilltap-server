/**
 * Tests for the MEMORY_EXTRACTION job handler.
 *
 * The handler is one unit of work for `lib/memory/extraction/`: it looks up
 * the payload's connection profile, builds the extraction context once, and
 * runs the pass the payload names (`runTurnExtraction` for a turn,
 * `runFoldCatchup` for a fold catch-up). What it does with the result — debug
 * lines onto the turn's message, a cost event, a retryable failure when a pass
 * was lost to a timeout, a follow-up catch-up job — is asserted here; the
 * passes themselves are tested beside `lib/memory/extraction/`.
 */

import { handleMemoryExtraction } from '@/lib/background-jobs/handlers/memory-extraction';
import { getRepositories } from '@/lib/repositories/factory';
import {
  buildExtractionContext,
  ExtractionContextError,
  runFoldCatchup,
  runTurnExtraction,
} from '@/lib/memory/extraction';
import { CheapLLMTaskLostError } from '@/lib/memory/cheap-llm-tasks';
import { createMemoryExtractionEvent } from '@/lib/services/system-events.service';
import { estimateMessageCost } from '@/lib/services/cost-estimation.service';
import { enqueueMemoryExtraction } from '@/lib/background-jobs/queue-service';

jest.mock('@/lib/logger', () => {
  const childLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    logger: {
      ...childLogger,
      child: jest.fn(() => childLogger),
    },
  };
});

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/memory/extraction', () => {
  const actual = jest.requireActual('@/lib/memory/extraction/context');
  return {
    ExtractionContextError: actual.ExtractionContextError,
    buildExtractionContext: jest.fn(),
    runTurnExtraction: jest.fn(),
    runFoldCatchup: jest.fn(),
  };
});

jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  CheapLLMTaskLostError: class CheapLLMTaskLostError extends Error {
    constructor(public readonly taskType: string, detail: string) {
      super(`${taskType}: ${detail}`);
      this.name = 'CheapLLMTaskLostError';
    }
  },
}));

jest.mock('@/lib/services/system-events.service', () => ({
  createMemoryExtractionEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/services/cost-estimation.service', () => ({
  estimateMessageCost: jest.fn().mockResolvedValue({ cost: 0.01, source: 'estimate' }),
}));

jest.mock('@/lib/background-jobs/queue-service', () => ({
  ...jest.requireActual('@/lib/background-jobs/queue-service'),
  enqueueMemoryExtraction: jest.fn().mockResolvedValue('job-next'),
}));

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockBuildContext = buildExtractionContext as jest.Mock;
const mockRunTurn = runTurnExtraction as jest.Mock;
const mockRunFoldCatchup = runFoldCatchup as jest.Mock;

const PROFILE = { id: 'profile-1', provider: 'OPENAI', modelName: 'gpt-test' };

type MockRepositories = {
  connections: { findById: jest.Mock };
  chats: { updateMessage: jest.Mock };
};

let repositories: MockRepositories;

const ctx = {
  chat: { id: 'chat-1' },
  route: { connectionProfile: PROFILE },
  project: { id: null, description: null },
};

function passResult(overrides: Record<string, unknown> = {}) {
  return {
    pass: 'self-turn',
    calls: 1,
    timedOut: 0,
    failed: 0,
    admitted: [],
    createdIds: [],
    reinforcedIds: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    debugLogs: [],
    sourceMessageId: 'assistant-msg-1',
    hadContributions: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  repositories = {
    connections: { findById: jest.fn().mockResolvedValue(PROFILE) },
    chats: { updateMessage: jest.fn().mockResolvedValue(undefined) },
  };

  mockGetRepositories.mockReturnValue(repositories as any);
  mockBuildContext.mockResolvedValue(ctx);
  mockRunTurn.mockResolvedValue(passResult());
});

describe('handleMemoryExtraction (per-turn)', () => {
  const buildJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    userId: 'user-7',
    payload: {
      chatId: 'chat-1',
      turnOpenerMessageId: 'user-msg-1',
      connectionProfileId: 'profile-1',
      ...overrides,
    },
  });

  it('builds one extraction context on the payload profile and runs the turn it locates', async () => {
    await handleMemoryExtraction(buildJob({ extractionAnchorMessageId: 'assistant-msg-1' }) as any);

    expect(repositories.connections.findById).toHaveBeenCalledWith('profile-1');
    expect(mockBuildContext).toHaveBeenCalledTimes(1);
    expect(mockBuildContext).toHaveBeenCalledWith('chat-1', 'user-7', { connectionProfile: PROFILE, backfill: false });
    expect(mockRunTurn).toHaveBeenCalledTimes(1);
    expect(mockRunTurn).toHaveBeenCalledWith(ctx, {
      turnOpenerMessageId: 'user-msg-1',
      extractionAnchorMessageId: 'assistant-msg-1',
    });
    expect(mockRunFoldCatchup).not.toHaveBeenCalled();
  });

  it('defaults a missing anchor to null', async () => {
    await handleMemoryExtraction(buildJob() as any);
    expect(mockRunTurn).toHaveBeenCalledWith(ctx, {
      turnOpenerMessageId: 'user-msg-1',
      extractionAnchorMessageId: null,
    });
  });

  it('persists debug logs onto the latest assistant message of the turn', async () => {
    mockRunTurn.mockResolvedValue(passResult({
      createdIds: ['mem-9'],
      debugLogs: ['log entry'],
    }));

    await handleMemoryExtraction(buildJob() as any);

    expect(repositories.chats.updateMessage).toHaveBeenCalledWith('chat-1', 'assistant-msg-1', {
      debugMemoryLogs: ['log entry'],
    });
  });

  it('books the cheap-LLM tokens against the unit of work profile', async () => {
    mockRunTurn.mockResolvedValue(passResult({
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    }));

    await handleMemoryExtraction(buildJob() as any);

    expect(estimateMessageCost).toHaveBeenCalledWith('OPENAI', 'gpt-test', 100, 50, 'user-7');
    expect(createMemoryExtractionEvent).toHaveBeenCalledWith(
      'chat-1',
      { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      'OPENAI',
      'gpt-test',
      0.01,
    );
  });

  it('emits no cost event when no tokens were spent', async () => {
    await handleMemoryExtraction(buildJob() as any);
    expect(createMemoryExtractionEvent).not.toHaveBeenCalled();
  });

  it('fails the job for a retry when a pass was lost to a timeout (bug 107)', async () => {
    mockRunTurn.mockResolvedValue(passResult({ timedOut: 1, debugLogs: ['lost'] }));

    await expect(handleMemoryExtraction(buildJob() as any)).rejects.toBeInstanceOf(CheapLLMTaskLostError);
    // Nothing is reported as a clean finish over the hole.
    expect(repositories.chats.updateMessage).not.toHaveBeenCalled();
  });

  it('throws when the connection profile is missing', async () => {
    repositories.connections.findById.mockResolvedValue(null);
    await expect(handleMemoryExtraction(buildJob() as any)).rejects.toThrow(/Connection profile not found/);
    expect(mockBuildContext).not.toHaveBeenCalled();
  });

  it('returns silently when the chat has been deleted between enqueue and execution', async () => {
    mockBuildContext.mockRejectedValue(new ExtractionContextError('no-chat', 'Chat not found: chat-1'));
    await expect(handleMemoryExtraction(buildJob() as any)).resolves.toBeUndefined();
    expect(mockRunTurn).not.toHaveBeenCalled();
  });

  it('rethrows any other context failure', async () => {
    mockBuildContext.mockRejectedValue(new Error('database unavailable'));
    await expect(handleMemoryExtraction(buildJob() as any)).rejects.toThrow('database unavailable');
  });

  it('records nothing when the turn has no character contributions', async () => {
    mockRunTurn.mockResolvedValue(passResult({
      hadContributions: false,
      debugLogs: ['[Memory] Turn has no character contributions — nothing to extract'],
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
    }));
    await handleMemoryExtraction(buildJob() as any);
    expect(repositories.chats.updateMessage).not.toHaveBeenCalled();
    expect(createMemoryExtractionEvent).not.toHaveBeenCalled();
  });
});

describe('handleMemoryExtraction (fold catch-up)', () => {
  const foldJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-2',
    userId: 'user-7',
    payload: {
      chatId: 'chat-1',
      turnOpenerMessageId: null,
      extractionAnchorMessageId: null,
      connectionProfileId: 'profile-1',
      pass: 'episode-fold',
      ...overrides,
    },
  });

  const foldResult = (overrides: Record<string, unknown> = {}) => ({
    ...passResult({ pass: 'episode-fold' }),
    slices: 1,
    slicesDeferred: 0,
    cursorAdvancedTo: 'msg-60',
    ...overrides,
  });

  it('runs the named fold pass on the one context and enqueues nothing when the backlog is read', async () => {
    mockRunFoldCatchup.mockResolvedValue(foldResult());

    await handleMemoryExtraction(foldJob() as any);

    expect(mockBuildContext).toHaveBeenCalledTimes(1);
    expect(mockRunFoldCatchup).toHaveBeenCalledWith(ctx, 'episode-fold', { ignoreIdle: false });
    expect(mockRunTurn).not.toHaveBeenCalled();
    expect(enqueueMemoryExtraction).not.toHaveBeenCalled();
  });

  it('honours the legacy catch-up flags when no pass is named', async () => {
    mockRunFoldCatchup.mockResolvedValue(foldResult({ pass: 'other-fold' }));
    await handleMemoryExtraction(foldJob({ pass: undefined, foldOtherCatchup: true, foldOtherIgnoreIdle: true }) as any);
    expect(mockRunFoldCatchup).toHaveBeenCalledWith(ctx, 'other-fold', { ignoreIdle: true });
  });

  it('continues a long backlog in a follow-up job keyed on the advanced cursor', async () => {
    mockRunFoldCatchup.mockResolvedValue(foldResult({ slicesDeferred: 3, cursorAdvancedTo: 'msg-240' }));

    await handleMemoryExtraction(foldJob({ ignoreIdle: true }) as any);

    expect(enqueueMemoryExtraction).toHaveBeenCalledWith('user-7', {
      chatId: 'chat-1',
      turnOpenerMessageId: null,
      extractionAnchorMessageId: null,
      connectionProfileId: 'profile-1',
      pass: 'episode-fold',
      cursor: 'msg-240',
      ignoreIdle: true,
    });
  });

  it('enqueues no follow-up when the rate limit deferred the backlog (review of PR 94)', async () => {
    mockRunFoldCatchup.mockResolvedValue(
      foldResult({ slicesDeferred: 2, cursorAdvancedTo: 'msg-60', skippedReason: 'rate-limited', rateDeferred: true }),
    );
    await handleMemoryExtraction(foldJob() as any);
    expect(enqueueMemoryExtraction).not.toHaveBeenCalled();
  });

  it('carries backfill onto the follow-up job', async () => {
    mockRunFoldCatchup.mockResolvedValue(foldResult({ slicesDeferred: 3, cursorAdvancedTo: 'msg-240' }));
    await handleMemoryExtraction(foldJob({ backfill: true }) as any);
    expect(mockBuildContext).toHaveBeenCalledWith('chat-1', 'user-7', expect.objectContaining({ backfill: true }));
    expect(enqueueMemoryExtraction).toHaveBeenCalledWith('user-7', expect.objectContaining({ backfill: true, cursor: 'msg-240' }));
  });

  it('fails for a retry, without a follow-up, when a slice was lost to a timeout', async () => {
    mockRunFoldCatchup.mockResolvedValue(foldResult({ timedOut: 1, slicesDeferred: 2 }));
    await expect(handleMemoryExtraction(foldJob() as any)).rejects.toBeInstanceOf(CheapLLMTaskLostError);
    expect(enqueueMemoryExtraction).not.toHaveBeenCalled();
  });
});
