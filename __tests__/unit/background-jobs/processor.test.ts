import * as processor from '@/lib/background-jobs/processor';
import { getRepositories } from '@/lib/repositories/factory';
import { getHandler } from '@/lib/background-jobs/handlers';

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/background-jobs/handlers', () => ({
  getHandler: jest.fn(),
}));

type MockBackgroundJobsRepo = {
  claimNextJob: jest.Mock;
  markCompleted: jest.Mock;
  markFailed: jest.Mock;
  resetStuckJobs: jest.Mock;
  findNextScheduledAt: jest.Mock;
};

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockGetHandler = getHandler as jest.MockedFunction<typeof getHandler>;

let backgroundJobs: MockBackgroundJobsRepo;
let handlerImpl: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  backgroundJobs = {
    claimNextJob: jest.fn().mockResolvedValue(null),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    resetStuckJobs: jest.fn().mockResolvedValue(0),
    findNextScheduledAt: jest.fn().mockResolvedValue(null),
  };

  handlerImpl = jest.fn().mockResolvedValue(undefined);

  mockGetRepositories.mockReturnValue({ backgroundJobs } as any);
  mockGetHandler.mockReturnValue(handlerImpl);
});

afterEach(() => {
  processor.stopProcessor();
  jest.useRealTimers();
});

describe('processNextJob', () => {
  it('runs the handler, marks completion, and rate-limits the next job', async () => {
    jest.useFakeTimers();
    const job = {
      id: 'job-1',
      type: 'MEMORY_EXTRACTION',
      attempts: 0,
    } as any;
    backgroundJobs.claimNextJob.mockResolvedValue(job);

    const promise = processor.processNextJob();
    await jest.advanceTimersByTimeAsync(500);
    const processed = await promise;

    expect(processed).toBe(true);
    expect(mockGetHandler).toHaveBeenCalledWith('MEMORY_EXTRACTION');
    expect(handlerImpl).toHaveBeenCalledWith(job);
    expect(backgroundJobs.markCompleted).toHaveBeenCalledWith('job-1');
  });

  it('marks the job as failed when the handler throws', async () => {
    const error = new Error('boom');
    handlerImpl.mockRejectedValue(error);
    const job = { id: 'job-2', type: 'CONTEXT_SUMMARY', attempts: 1 } as any;
    backgroundJobs.claimNextJob.mockResolvedValue(job);

    const processed = await processor.processNextJob();

    expect(processed).toBe(true);
    expect(backgroundJobs.markFailed).toHaveBeenCalledWith('job-2', 'boom');
  });

  it('does not claim additional jobs while processing one', async () => {
    jest.useFakeTimers();
    const job = {
      id: 'job-3',
      type: 'TITLE_UPDATE',
      attempts: 0,
    } as any;
    backgroundJobs.claimNextJob.mockResolvedValue(job);

    let resolveHandler: (() => void) | null = null;
    const blockingPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });
    handlerImpl.mockReturnValue(blockingPromise);

    const first = processor.processNextJob();
    const second = processor.processNextJob();

    await expect(second).resolves.toBe(false);
    expect(backgroundJobs.claimNextJob).toHaveBeenCalledTimes(1);

    resolveHandler?.();
    await jest.advanceTimersByTimeAsync(500);
    await first;
  });

  it('stops the processor automatically when no jobs are available', async () => {
    jest.useFakeTimers();
    processor.startProcessor(1000);
    backgroundJobs.claimNextJob.mockResolvedValue(null);

    const processed = await processor.processNextJob();

    expect(processed).toBe(false);
    expect(processor.getProcessorStatus().running).toBe(false);
  });

  it('wakes the processor back up when a FAILED job is scheduled for a future retry', async () => {
    jest.useFakeTimers();
    processor.startProcessor(1000);

    // Claim returns null because the only job's scheduledAt is in the future,
    // but findNextScheduledAt surfaces that retry time so the processor can
    // arm a wake-up timer instead of stranding the job.
    const scheduledAt = new Date(Date.now() + 5000).toISOString();
    backgroundJobs.claimNextJob.mockResolvedValue(null);
    backgroundJobs.findNextScheduledAt.mockResolvedValue(scheduledAt);

    await processor.processNextJob();

    expect(backgroundJobs.findNextScheduledAt).toHaveBeenCalled();
    expect(processor.getProcessorStatus().running).toBe(false);

    // Advance past the scheduled time — the wake-up timer should restart the
    // processor without any new enqueue.
    await jest.advanceTimersByTimeAsync(5100);
    expect(processor.getProcessorStatus().running).toBe(true);
  });
});

describe('processJobs', () => {
  it('processes jobs sequentially until the queue is empty', async () => {
    jest.useFakeTimers();
    const job = { id: 'job-10', type: 'MEMORY_EXTRACTION', attempts: 0 } as any;
    backgroundJobs.claimNextJob
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(null);

    const promise = processor.processJobs(5);
    await jest.advanceTimersByTimeAsync(500);
    const summary = await promise;

    expect(summary).toEqual({ processed: 1, succeeded: 0, failed: 0 });
    expect(backgroundJobs.markCompleted).toHaveBeenCalledWith('job-10');
  });
});

describe('processor lifecycle helpers', () => {
  it('resets stuck jobs via the repository', async () => {
    backgroundJobs.resetStuckJobs.mockResolvedValue(3);

    const count = await processor.resetStuckJobs(20);

    expect(count).toBe(3);
    expect(backgroundJobs.resetStuckJobs).toHaveBeenCalledWith(20);
  });

  it('ensures the processor is running after calling ensureProcessorRunning', () => {
    jest.useFakeTimers();
    processor.stopProcessor();

    processor.ensureProcessorRunning();
    expect(processor.getProcessorStatus().running).toBe(true);

    processor.ensureProcessorRunning();
    expect(processor.getProcessorStatus().running).toBe(true);
  });
});
