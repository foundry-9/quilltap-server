/**
 * The parent's job-completion hook drops the frozen memory archive cache after
 * a housekeeping sweep that ran in the job child
 * (memory-recall-and-housekeeping-fixes F5). The cache lives in the parent;
 * the child's own invalidation is a no-op on the parent's map.
 */

import { invalidateFrozenArchivesForCompletedJob } from '../job-dispatcher';
import type { BackgroundJob } from '@/lib/schemas/types';

jest.mock('../processor-host', () => ({ sendToChild: jest.fn(() => true), notifyChild: jest.fn() }));

const invalidateFrozenArchive = jest.fn();
const invalidateAllFrozenArchives = jest.fn();
jest.mock('@/lib/memory/recall/archive', () => ({
  invalidateFrozenArchive: (...args: unknown[]) => invalidateFrozenArchive(...args),
  invalidateAllFrozenArchives: (...args: unknown[]) => invalidateAllFrozenArchives(...args),
}));

function job(type: string, payload: Record<string, unknown>): BackgroundJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    type,
    status: 'PROCESSING',
    payload,
    priority: 0,
    attempts: 1,
    maxAttempts: 3,
    scheduledAt: '2026-10-08T00:00:00.000Z',
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
  } as unknown as BackgroundJob;
}

describe('invalidateFrozenArchivesForCompletedJob', () => {
  beforeEach(() => jest.clearAllMocks());

  it('drops the maintained character after a maintenance run', async () => {
    await invalidateFrozenArchivesForCompletedJob(job('MEMORY_MAINTENANCE', { characterId: 'char-1', reason: 'scheduled' }));
    expect(invalidateFrozenArchive).toHaveBeenCalledWith('char-1');
    expect(invalidateAllFrozenArchives).not.toHaveBeenCalled();
  });

  it('every maintenance job names its character; one without does nothing', async () => {
    await invalidateFrozenArchivesForCompletedJob(job('MEMORY_MAINTENANCE', { reason: 'scheduled' }));
    expect(invalidateFrozenArchive).not.toHaveBeenCalled();
    expect(invalidateAllFrozenArchives).not.toHaveBeenCalled();
  });

  it('never invalidates for ordinary per-turn memory work', async () => {
    await invalidateFrozenArchivesForCompletedJob(job('MEMORY_EXTRACTION', { characterId: 'char-1' }));
    await invalidateFrozenArchivesForCompletedJob(undefined);
    expect(invalidateFrozenArchive).not.toHaveBeenCalled();
    expect(invalidateAllFrozenArchives).not.toHaveBeenCalled();
  });
});
