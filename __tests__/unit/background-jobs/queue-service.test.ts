import {
  enqueueJob,
  enqueueMemoryExtraction,
  enqueueMemoryExtractionBatch,
  enqueueCharacterAvatarGeneration,
  enqueueDeduped,
  enqueueEmbeddingGenerate,
  enqueueSceneStateTracking,
  enqueueTitleUpdate,
  getJobStatus,
  getQueueStats,
  cancelJob,
  getPendingJobsForChat,
  cleanupFinishedJobs,
  releaseHeldAvatarRefreshes,
  cancelHeldAvatarRefreshes,
} from '@/lib/background-jobs/queue-service';
import { HELD_UNTIL_NEXT_TURN } from '@/lib/schemas/job.types';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureProcessorRunning } from '@/lib/background-jobs/processor';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    // The real logger exposes `child`; modules that build a scoped logger at
    // import time (the realtime bus, reached through the activity registry)
    // need it present on the mock too.
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

jest.mock('@/lib/background-jobs/processor', () => ({
  ensureProcessorRunning: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

type MockBackgroundJobRepo = {
  create: jest.Mock;
  createBatch: jest.Mock;
  findById: jest.Mock;
  getStats: jest.Mock;
  cancel: jest.Mock;
  findPendingForChat: jest.Mock;
  findAbsorbers: jest.Mock;
  update: jest.Mock;
  cleanupOldJobsByStatus: jest.Mock;
};

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockEnsureProcessorRunning = ensureProcessorRunning as jest.MockedFunction<typeof ensureProcessorRunning>;

let backgroundJobs: MockBackgroundJobRepo;
/** The queue `findAbsorbers` reads: filtered by type and status, as the repository does. */
let queued: Array<{ id: string; type: string; status: string; payload: Record<string, unknown>; scheduledAt?: string }>;

beforeEach(() => {
  jest.clearAllMocks();
  queued = [];

  backgroundJobs = {
    create: jest.fn().mockResolvedValue({ id: 'job-123' }),
    createBatch: jest.fn().mockResolvedValue(['job-1', 'job-2']),
    findById: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getStats: jest.fn().mockResolvedValue({ pending: 1, processing: 0, completed: 0, failed: 0, dead: 0, paused: 0 }),
    cancel: jest.fn().mockResolvedValue(true),
    findPendingForChat: jest.fn().mockResolvedValue([{ id: 'job-77' }]),
    findAbsorbers: jest.fn(async (type: string, statuses: string[]) =>
      queued.filter(j => j.type === type && statuses.includes(j.status))),
    update: jest.fn().mockResolvedValue({}),
    cleanupOldJobsByStatus: jest.fn().mockResolvedValue({ completed: 3, dead: 1 }),
  };

  mockGetRepositories.mockReturnValue({ backgroundJobs } as any);
});

describe('enqueueJob', () => {
  it('creates a job with default options and ensures the processor runs', async () => {
    const payload = { key: 'value' };

    const id = await enqueueJob('user-1', 'MEMORY_EXTRACTION', payload);

    expect(id).toBe('job-123');
    expect(backgroundJobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'MEMORY_EXTRACTION',
        payload,
        priority: 0,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
      })
    );
    expect(mockEnsureProcessorRunning).toHaveBeenCalledTimes(1);
  });

  it('applies enqueue options for priority, attempts, and scheduling', async () => {
    const scheduledAt = new Date('2024-01-01T10:00:00.000Z');

    await enqueueJob('user-2', 'CONTEXT_SUMMARY', {}, {
      priority: 5,
      maxAttempts: 8,
      scheduledAt,
    });

    expect(backgroundJobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        priority: 5,
        maxAttempts: 8,
        scheduledAt: scheduledAt.toISOString(),
      })
    );
  });
});

describe('enqueue helpers', () => {
  it('enqueues a per-turn memory extraction job and returns the job id', async () => {
    const payload = {
      chatId: 'chat-1',
      turnOpenerMessageId: 'user-msg-1',
      connectionProfileId: 'profile-1',
    };

    const result = await enqueueMemoryExtraction('user-42', payload);

    expect(result).toBe('job-123');
    expect(backgroundJobs.create).toHaveBeenCalledWith(expect.objectContaining({ payload }));
  });
});

describe('enqueueMemoryExtractionBatch', () => {
  const basePayload = {
    userId: 'user-1',
    chatId: 'chat-1',
    connectionProfileId: 'profile-1',
  };

  it('creates one MEMORY_EXTRACTION job per turn opener', async () => {
    const ids = await enqueueMemoryExtractionBatch(
      basePayload.userId,
      basePayload.chatId,
      basePayload.connectionProfileId,
      ['user-msg-1', 'user-msg-2'],
    );

    expect(ids).toEqual(['job-1', 'job-2']);
    expect(backgroundJobs.createBatch).toHaveBeenCalledTimes(1);
    const createdJobs = backgroundJobs.createBatch.mock.calls[0][0];
    expect(createdJobs).toHaveLength(2);
    expect(createdJobs[0]).toMatchObject({
      userId: basePayload.userId,
      type: 'MEMORY_EXTRACTION',
      payload: {
        chatId: basePayload.chatId,
        turnOpenerMessageId: 'user-msg-1',
        connectionProfileId: basePayload.connectionProfileId,
      },
    });
    expect(createdJobs[1]).toMatchObject({
      payload: {
        chatId: basePayload.chatId,
        turnOpenerMessageId: 'user-msg-2',
        connectionProfileId: basePayload.connectionProfileId,
      },
    });
    expect(mockEnsureProcessorRunning).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array and skips processor startup when there are no turn openers', async () => {
    const ids = await enqueueMemoryExtractionBatch(
      basePayload.userId,
      basePayload.chatId,
      basePayload.connectionProfileId,
      [],
    );

    expect(ids).toEqual([]);
    expect(backgroundJobs.createBatch).not.toHaveBeenCalled();
    expect(mockEnsureProcessorRunning).not.toHaveBeenCalled();
  });
});

describe('queue lookups and maintenance', () => {
  it('proxies to the repository for queue stats and job lookups', async () => {
    const stats = await getQueueStats('user-9');
    expect(backgroundJobs.getStats).toHaveBeenCalledWith('user-9');
    expect(stats).toEqual({ pending: 1, processing: 0, completed: 0, failed: 0, dead: 0, paused: 0 });

    await getJobStatus('job-10');
    expect(backgroundJobs.findById).toHaveBeenCalledWith('job-10');

    await getPendingJobsForChat('chat-99');
    expect(backgroundJobs.findPendingForChat).toHaveBeenCalledWith('chat-99');
  });

  it('cancels jobs through the repository', async () => {
    const success = await cancelJob('job-22');
    expect(success).toBe(true);
    expect(backgroundJobs.cancel).toHaveBeenCalledWith('job-22');
  });

  it('reaps finished jobs with per-status retention windows (7d completed, 30d dead)', async () => {
    const now = new Date('2024-02-01T00:00:00.000Z').getTime();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);

    const result = await cleanupFinishedJobs();

    expect(result).toEqual({ completed: 3, dead: 1 });
    expect(backgroundJobs.cleanupOldJobsByStatus).toHaveBeenCalledTimes(1);
    const [completedCutoff, deadCutoff]: [Date, Date] =
      backgroundJobs.cleanupOldJobsByStatus.mock.calls[0];
    // COMPLETED window = 7 days, DEAD window = 30 days.
    expect(completedCutoff.toISOString()).toBe('2024-01-25T00:00:00.000Z');
    expect(deadCutoff.toISOString()).toBe('2024-01-02T00:00:00.000Z');

    spy.mockRestore();
  });
});

describe('enqueueCharacterAvatarGeneration', () => {
  const payload = { chatId: 'chat-1', characterId: 'char-1' } as any;

  it('collapses onto a still-PENDING avatar job for the same character', async () => {
    queued = [{ id: 'avatar-pending', type: 'CHARACTER_AVATAR_GENERATION', status: 'PENDING', payload }];

    const result = await enqueueCharacterAvatarGeneration('user-1', payload);

    expect(result).toEqual({ jobId: 'avatar-pending', isNew: false });
    expect(backgroundJobs.create).not.toHaveBeenCalled();
  });

  it('enqueues a fresh job when the only avatar job is already PROCESSING', async () => {
    // A processing job has built its prompt; an outfit change after that must not be absorbed.
    queued = [{ id: 'avatar-running', type: 'CHARACTER_AVATAR_GENERATION', status: 'PROCESSING', payload }];

    const result = await enqueueCharacterAvatarGeneration('user-1', payload);

    expect(result.isNew).toBe(true);
    expect(result.jobId).toBe('job-123');
    expect(backgroundJobs.create).toHaveBeenCalledTimes(1);
  });

  it('holds an automatic refresh until the next turn', async () => {
    await enqueueCharacterAvatarGeneration('user-1', { ...payload, awaitingTurn: true });

    expect(backgroundJobs.create).toHaveBeenCalledWith(expect.objectContaining({
      scheduledAt: HELD_UNTIL_NEXT_TURN,
      payload: expect.objectContaining({ awaitingTurn: true }),
    }));
  });

  it('collapses later automatic refreshes onto the held job', async () => {
    const held = { ...payload, awaitingTurn: true };
    queued = [{ id: 'avatar-held', type: 'CHARACTER_AVATAR_GENERATION', status: 'PENDING', payload: held, scheduledAt: HELD_UNTIL_NEXT_TURN }];

    const result = await enqueueCharacterAvatarGeneration('user-1', held);

    expect(result).toEqual({ jobId: 'avatar-held', isNew: false });
    expect(backgroundJobs.create).not.toHaveBeenCalled();
  });

  it('never parks a manual regenerate inside a held job', async () => {
    queued = [{ id: 'avatar-held', type: 'CHARACTER_AVATAR_GENERATION', status: 'PENDING', payload: { ...payload, awaitingTurn: true }, scheduledAt: HELD_UNTIL_NEXT_TURN }];

    const result = await enqueueCharacterAvatarGeneration('user-1', { ...payload, force: true });

    expect(result.isNew).toBe(true);
    const created = backgroundJobs.create.mock.calls[0][0];
    expect(created.scheduledAt).not.toBe(HELD_UNTIL_NEXT_TURN);
  });
});

describe('held avatar refreshes', () => {
  const heldJob = (id: string, characterId: string) => ({
    id,
    type: 'CHARACTER_AVATAR_GENERATION',
    status: 'PENDING',
    payload: { chatId: 'chat-1', characterId, awaitingTurn: true },
    scheduledAt: HELD_UNTIL_NEXT_TURN,
  });

  it('releases every held refresh for the chat at once', async () => {
    queued = [
      heldJob('held-a', 'char-a'),
      heldJob('held-b', 'char-b'),
      // Already released: not touched again.
      { ...heldJob('released', 'char-c'), scheduledAt: '2026-01-01T00:00:00.000Z' },
      // A manual job: never held.
      { id: 'manual', type: 'CHARACTER_AVATAR_GENERATION', status: 'PENDING', payload: { chatId: 'chat-1', characterId: 'char-d' }, scheduledAt: '2026-01-01T00:00:00.000Z' },
    ];

    const released = await releaseHeldAvatarRefreshes('chat-1');

    expect(released).toBe(2);
    expect(backgroundJobs.findAbsorbers).toHaveBeenCalledWith('CHARACTER_AVATAR_GENERATION', ['PENDING'], {
      payloadField: 'chatId', payloadValue: 'chat-1',
    });
    expect(backgroundJobs.update.mock.calls.map(c => c[0])).toEqual(['held-a', 'held-b']);
    for (const [, patch] of backgroundJobs.update.mock.calls) {
      expect(patch.scheduledAt < HELD_UNTIL_NEXT_TURN).toBe(true);
    }
    expect(mockEnsureProcessorRunning).toHaveBeenCalled();
  });

  it('does nothing when nothing is held', async () => {
    expect(await releaseHeldAvatarRefreshes('chat-1')).toBe(0);
    expect(backgroundJobs.update).not.toHaveBeenCalled();
    expect(mockEnsureProcessorRunning).not.toHaveBeenCalled();
  });

  it('never throws on a failed read', async () => {
    backgroundJobs.findAbsorbers.mockRejectedValueOnce(new Error('db down'));
    await expect(releaseHeldAvatarRefreshes('chat-1')).resolves.toBe(0);
  });

  it('cancels held refreshes when the chat is deleted', async () => {
    queued = [heldJob('held-a', 'char-a')];
    expect(await cancelHeldAvatarRefreshes('chat-1')).toBe(1);
    expect(backgroundJobs.cancel).toHaveBeenCalledWith('held-a');
  });
});

describe('enqueueDeduped (refactor 4.13 §5.3)', () => {
  const rule = (absorbs: 'pending' | 'active') => ({
    key: (p: { chatId: string }) => p.chatId,
    absorbs,
    scope: 'chatId' as const,
    label: 'Test',
  });

  it("'pending' reuses a queued job but not a running one", async () => {
    queued = [{ id: 'running', type: 'TITLE_UPDATE', status: 'PROCESSING', payload: { chatId: 'c1' } }];
    const fresh = await enqueueDeduped('u', 'TITLE_UPDATE', { chatId: 'c1' }, rule('pending'));
    expect(fresh).toEqual({ jobId: 'job-123', isNew: true });
    expect(backgroundJobs.findAbsorbers).toHaveBeenCalledWith('TITLE_UPDATE', ['PENDING'], {
      userId: 'u', payloadField: 'chatId', payloadValue: 'c1',
    });

    queued.push({ id: 'waiting', type: 'TITLE_UPDATE', status: 'PENDING', payload: { chatId: 'c1' } });
    const reused = await enqueueDeduped('u', 'TITLE_UPDATE', { chatId: 'c1' }, rule('pending'));
    expect(reused).toEqual({ jobId: 'waiting', isNew: false });
  });

  it("'active' lets a running job absorb the request", async () => {
    queued = [{ id: 'running', type: 'TITLE_UPDATE', status: 'PROCESSING', payload: { chatId: 'c1' } }];
    const result = await enqueueDeduped('u', 'TITLE_UPDATE', { chatId: 'c1' }, rule('active'));
    expect(result).toEqual({ jobId: 'running', isNew: false });
    expect(backgroundJobs.create).not.toHaveBeenCalled();
  });

  it('compares keys, not just type', async () => {
    queued = [{ id: 'other', type: 'TITLE_UPDATE', status: 'PENDING', payload: { chatId: 'c2' } }];
    const result = await enqueueDeduped('u', 'TITLE_UPDATE', { chatId: 'c1' }, rule('active'));
    expect(result.isNew).toBe(true);
  });

  it('enqueues anyway when the queue cannot be read', async () => {
    backgroundJobs.findAbsorbers.mockRejectedValueOnce(new Error('db gone'));
    const result = await enqueueDeduped('u', 'TITLE_UPDATE', { chatId: 'c1' }, rule('active'));
    expect(result.isNew).toBe(true);
  });

  it('skipDedupCheck skips the read', async () => {
    await enqueueDeduped('u', 'TITLE_UPDATE', { chatId: 'c1' }, rule('active'), { skipDedupCheck: true });
    expect(backgroundJobs.findAbsorbers).not.toHaveBeenCalled();
  });

  it('handlers that read state when they run do not absorb into a running job', async () => {
    queued = [
      { id: 'scene-running', type: 'SCENE_STATE_TRACKING', status: 'PROCESSING', payload: { chatId: 'c1' } },
      { id: 'embed-running', type: 'EMBEDDING_GENERATE', status: 'PROCESSING', payload: { entityId: 'e1' } },
    ];
    expect((await enqueueSceneStateTracking('u', { chatId: 'c1' } as any)).isNew).toBe(true);
    expect((await enqueueEmbeddingGenerate('u', { entityId: 'e1', entityType: 'MOUNT_CHUNK', profileId: 'p' } as any)).isNew).toBe(true);
  });

  it('a title update at the same checkpoint is absorbed by the running job', async () => {
    queued = [{ id: 'title-running', type: 'TITLE_UPDATE', status: 'PROCESSING', payload: { chatId: 'c1' } }];
    expect(await enqueueTitleUpdate('u', { chatId: 'c1', connectionProfileId: 'p' } as any)).toBe('title-running');
  });
});
