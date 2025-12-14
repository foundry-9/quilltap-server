import {
  enqueueJob,
  enqueueMemoryExtraction,
  enqueueMemoryExtractionBatch,
  getJobStatus,
  getQueueStats,
  cancelJob,
  getPendingJobsForChat,
  cleanupOldJobs,
} from '@/lib/background-jobs/queue-service';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureProcessorRunning } from '@/lib/background-jobs/processor';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
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
  cleanupOldJobs: jest.Mock;
};

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockEnsureProcessorRunning = ensureProcessorRunning as jest.MockedFunction<typeof ensureProcessorRunning>;

let backgroundJobs: MockBackgroundJobRepo;

beforeEach(() => {
  jest.clearAllMocks();

  backgroundJobs = {
    create: jest.fn().mockResolvedValue({ id: 'job-123' }),
    createBatch: jest.fn().mockResolvedValue(['job-1', 'job-2']),
    findById: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getStats: jest.fn().mockResolvedValue({ pending: 1, processing: 0, completed: 0, failed: 0, dead: 0, paused: 0 }),
    cancel: jest.fn().mockResolvedValue(true),
    findPendingForChat: jest.fn().mockResolvedValue([{ id: 'job-77' }]),
    cleanupOldJobs: jest.fn().mockResolvedValue(5),
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
  it('enqueues memory extraction jobs and returns the job id', async () => {
    const payload = {
      chatId: 'chat-1',
      characterId: 'char-1',
      characterName: 'Hero',
      userMessage: 'Hi',
      assistantMessage: 'Hello',
      sourceMessageId: 'msg-1',
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
    characterId: 'char-1',
    characterName: 'Hero',
    connectionProfileId: 'profile-1',
  };

  it('creates a batch of jobs, mirroring each message pair payload', async () => {
    const pairs = [
      {
        userMessageId: 'u-1',
        assistantMessageId: 'a-1',
        userContent: 'User message',
        assistantContent: 'Assistant reply',
      },
      {
        userMessageId: 'u-2',
        assistantMessageId: 'a-2',
        userContent: 'Another user message',
        assistantContent: 'Second assistant reply',
      },
    ];

    const ids = await enqueueMemoryExtractionBatch(
      basePayload.userId,
      basePayload.chatId,
      basePayload.characterId,
      basePayload.characterName,
      basePayload.connectionProfileId,
      pairs
    );

    expect(ids).toEqual(['job-1', 'job-2']);
    expect(backgroundJobs.createBatch).toHaveBeenCalledTimes(1);
    const createdJobs = backgroundJobs.createBatch.mock.calls[0][0];
    expect(createdJobs).toHaveLength(2);
    expect(createdJobs[0]).toMatchObject({
      userId: basePayload.userId,
      type: 'MEMORY_EXTRACTION',
      payload: expect.objectContaining({
        chatId: basePayload.chatId,
        characterId: basePayload.characterId,
        characterName: basePayload.characterName,
        userMessage: pairs[0].userContent,
        assistantMessage: pairs[0].assistantContent,
        sourceMessageId: pairs[0].assistantMessageId,
        connectionProfileId: basePayload.connectionProfileId,
      }),
    });
    expect(mockEnsureProcessorRunning).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array and skips processor startup when there are no pairs', async () => {
    const ids = await enqueueMemoryExtractionBatch(
      basePayload.userId,
      basePayload.chatId,
      basePayload.characterId,
      basePayload.characterName,
      basePayload.connectionProfileId,
      []
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

  it('calculates the cutoff timestamp when cleaning up old jobs', async () => {
    const now = new Date('2024-02-01T00:00:00.000Z').getTime();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);

    const deleted = await cleanupOldJobs(2);

    expect(deleted).toBe(5);
    expect(backgroundJobs.cleanupOldJobs).toHaveBeenCalledTimes(1);
    const cutoff: Date = backgroundJobs.cleanupOldJobs.mock.calls[0][0];
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.toISOString()).toBe('2024-01-30T00:00:00.000Z');

    spy.mockRestore();
  });
});
