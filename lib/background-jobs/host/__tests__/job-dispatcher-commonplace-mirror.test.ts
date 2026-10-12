/**
 * Bug 208: the Commonplace vault mirror is written by the parent only after a
 * consolidation job's write batch commits. A batch that fails to commit marks
 * the job FAILED and never reaches the mirror, so the vault never describes a
 * digest that was not saved.
 */

import { handleChildJobResult } from '../job-dispatcher';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { getRawMountIndexDatabase } from '@/lib/database/backends/sqlite/mount-index-client';
import { getRawLLMLogsDatabase } from '@/lib/database/backends/sqlite/llm-logs-client';
import type { BackgroundJob } from '@/lib/schemas/types';
import type { ChildWritePayload } from '../../ipc-types';

// `@/lib/repositories/factory` is already mocked globally in jest.setup.ts.
jest.mock('@/lib/database/backends/sqlite/client', () => ({ getRawDatabase: jest.fn() }));
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({ getRawMountIndexDatabase: jest.fn() }));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({ getRawLLMLogsDatabase: jest.fn() }));
jest.mock('../processor-host', () => ({ sendToChild: jest.fn(() => true), notifyChild: jest.fn() }));
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }));
jest.mock('@/lib/memory/frozen-archive-cache', () => ({
  invalidateFrozenArchive: jest.fn(),
  invalidateAllFrozenArchives: jest.fn(),
}));
jest.mock('@/lib/memory/consolidation-triggers', () => ({
  maybeEnqueueConsolidationAfterCommit: jest.fn(async () => undefined),
}));

const mirrorCommonplaceAfterCommit = jest.fn(async () => undefined);
jest.mock('@/lib/memory/commonplace-mirror', () => ({
  mirrorCommonplaceAfterCommit: (...args: unknown[]) => mirrorCommonplaceAfterCommit(...(args as [])),
}));

function fakeDb(opts?: { failCommit?: string }) {
  const calls: string[] = [];
  return {
    calls,
    exec: jest.fn((sql: string) => {
      calls.push(sql);
      if (opts?.failCommit && sql === 'COMMIT') throw new Error(opts.failCommit);
    }),
  };
}

function consolidationJob(id: string): BackgroundJob {
  return {
    id,
    userId: 'user-1',
    type: 'MEMORY_CONSOLIDATION',
    status: 'PROCESSING',
    payload: { characterId: 'holder-1', trigger: 'manual' },
    priority: 0,
    attempts: 1,
    maxAttempts: 1,
    scheduledAt: '2026-10-12T00:00:00.000Z',
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  } as unknown as BackgroundJob;
}

const writes: ChildWritePayload[] = [
  {
    method: 'memories.create',
    args: [{ characterId: 'holder-1', aboutCharacterId: 'laura-1', source: 'CONSOLIDATED', content: 'Laura keeps the charts.' }, { id: 'digest-1' }],
  },
  { method: 'memories.updateTierBulk', args: ['holder-1', ['m1', 'm2'], 'cold', { supersededById: 'digest-1' }] },
];

let repos: any;

beforeEach(() => {
  jest.clearAllMocks();
  repos = {
    memories: {
      create: jest.fn(async () => ({})),
      updateTierBulk: jest.fn(async () => 0),
    },
    backgroundJobs: {
      markCompleted: jest.fn(async () => null),
      markFailed: jest.fn(async () => null),
      claimNextJob: jest.fn(async () => null),
      findNextScheduledAt: jest.fn(async () => null),
    },
  };
  jest.mocked(getRepositories).mockReturnValue(repos as never);
  jest.mocked(getRawMountIndexDatabase).mockReturnValue(fakeDb() as never);
  jest.mocked(getRawLLMLogsDatabase).mockReturnValue(fakeDb() as never);
  globalThis.__quilltapJobDispatcher = undefined;
});

function inFlight(job: BackgroundJob): void {
  globalThis.__quilltapJobDispatcher = {
    pollTimer: null,
    stuckCheckTimer: null,
    wakeTimer: null,
    inFlight: new Map([[job.id, job]]),
    claiming: false,
    running: false,
    maxInFlight: 4,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Commonplace mirror after a consolidation job (bug 208)', () => {
  it('a batch that fails to commit fails the job and writes no mirror', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb({ failCommit: 'disk full' }) as never);
    const job = consolidationJob('job-fail');
    inFlight(job);

    await handleChildJobResult({ type: 'job-result', jobId: job.id, ok: true, writes } as never);
    await flush();

    expect(repos.backgroundJobs.markFailed).toHaveBeenCalledWith('job-fail', expect.stringContaining('disk full'));
    expect(repos.backgroundJobs.markCompleted).not.toHaveBeenCalled();
    expect(mirrorCommonplaceAfterCommit).not.toHaveBeenCalled();
  });

  it('a committed batch mirrors from the parent, after commit', async () => {
    const mainDb = fakeDb();
    jest.mocked(getRawDatabase).mockReturnValue(mainDb as never);
    const job = consolidationJob('job-ok');
    inFlight(job);

    await handleChildJobResult({ type: 'job-result', jobId: job.id, ok: true, writes } as never);
    await flush();

    expect(mainDb.calls).toEqual(['BEGIN IMMEDIATE', 'COMMIT']);
    expect(repos.backgroundJobs.markCompleted).toHaveBeenCalledWith('job-ok');
    expect(mirrorCommonplaceAfterCommit).toHaveBeenCalledWith('MEMORY_CONSOLIDATION', job.payload, writes);
  });

  it('a job that failed in the child writes no mirror', async () => {
    jest.mocked(getRawDatabase).mockReturnValue(fakeDb() as never);
    const job = consolidationJob('job-child-fail');
    inFlight(job);

    await handleChildJobResult({
      type: 'job-result',
      jobId: job.id,
      ok: false,
      error: { message: 'boom' },
      writes,
    } as never);
    await flush();

    expect(repos.backgroundJobs.markFailed).toHaveBeenCalled();
    expect(mirrorCommonplaceAfterCommit).not.toHaveBeenCalled();
  });
});
