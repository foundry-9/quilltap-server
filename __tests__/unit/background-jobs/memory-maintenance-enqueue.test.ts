/**
 * Memory maintenance enqueue rules:
 *   - bug 221: housekeeping dedupes per character whatever the reason; a
 *     user-wide sweep fans out into one job per character, so a scheduled
 *     sweep and a watermark sweep collide on the same character.
 *   - bug 223: a consolidation job carries the requested `clusterThreshold`.
 */

import {
  enqueueMemoryConsolidation,
  enqueueMemoryHousekeeping,
  enqueueMemoryHousekeepingSweep,
} from '@/lib/background-jobs/queue-service';
import { getRepositories } from '@/lib/repositories/factory';

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
jest.mock('@/lib/background-jobs/processor', () => ({ ensureProcessorRunning: jest.fn() }));
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }));
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }));

interface Job {
  id: string;
  type: string;
  status: 'PENDING' | 'PROCESSING';
  payload: Record<string, unknown>;
}

let jobs: Job[];
let nextId: number;
let repos: any;

beforeEach(() => {
  jest.clearAllMocks();
  jobs = [];
  nextId = 1;
  repos = {
    characters: {
      findByUserId: jest.fn(async () => [{ id: 'char-a' }, { id: 'char-b' }]),
    },
    backgroundJobs: {
      findByUserId: jest.fn(async (_userId: string, status: string) => jobs.filter((j) => j.status === status)),
      create: jest.fn(async (data: any) => {
        const job: Job = { id: `job-${nextId++}`, type: data.type, status: 'PENDING', payload: data.payload };
        jobs.push(job);
        return job;
      }),
      update: jest.fn(async (id: string, data: any) => {
        const job = jobs.find((j) => j.id === id);
        if (job && data.payload) job.payload = data.payload;
        return job ?? null;
      }),
    },
  };
  jest.mocked(getRepositories).mockReturnValue(repos);
});

describe('housekeeping dedupe per character (bug 221)', () => {
  it('a user-wide sweep fans out into one job per character', async () => {
    const ids = await enqueueMemoryHousekeepingSweep('user-1', { reason: 'scheduled' });
    expect(ids).toHaveLength(2);
    expect(jobs.map((j) => j.payload)).toEqual([
      { reason: 'scheduled', characterId: 'char-a' },
      { reason: 'scheduled', characterId: 'char-b' },
    ]);
  });

  it('a watermark job collides with the scheduled sweep for the same character', async () => {
    const sweepIds = await enqueueMemoryHousekeepingSweep('user-1', { reason: 'scheduled' });
    const watermarkId = await enqueueMemoryHousekeeping('user-1', { characterId: 'char-b', reason: 'watermark' });
    expect(watermarkId).toBe(sweepIds[1]);
    expect(jobs).toHaveLength(2);
  });

  it('a scheduled sweep reuses an in-flight watermark job for that character', async () => {
    const watermarkId = await enqueueMemoryHousekeeping('user-1', { characterId: 'char-a', reason: 'watermark' });
    jobs[0].status = 'PROCESSING';
    const sweepIds = await enqueueMemoryHousekeepingSweep('user-1', { reason: 'scheduled' });
    expect(sweepIds[0]).toBe(watermarkId);
    expect(jobs).toHaveLength(2); // only char-b got a new job
    expect(jobs[1].payload.characterId).toBe('char-b');
  });

  it('enqueueMemoryHousekeeping with no character fans out too, returning the first id', async () => {
    const id = await enqueueMemoryHousekeeping('user-1', { reason: 'manual' });
    expect(id).toBe('job-1');
    expect(jobs.every((j) => typeof j.payload.characterId === 'string')).toBe(true);
  });

  it('a legacy user-wide job still in flight absorbs a per-character enqueue', async () => {
    jobs.push({ id: 'legacy', type: 'MEMORY_HOUSEKEEPING', status: 'PROCESSING', payload: { reason: 'scheduled' } });
    const id = await enqueueMemoryHousekeeping('user-1', { characterId: 'char-a', reason: 'watermark' });
    expect(id).toBe('legacy');
    expect(repos.backgroundJobs.create).not.toHaveBeenCalled();
  });
});

describe('consolidation carries clusterThreshold (bug 223)', () => {
  it('puts the threshold on the job payload', async () => {
    await enqueueMemoryConsolidation('user-1', { characterId: 'char-a', clusterThreshold: 0.65, trigger: 'manual' });
    expect(jobs[0].payload).toEqual({ characterId: 'char-a', clusterThreshold: 0.65, trigger: 'manual' });
  });

  it('a pending job for the character adopts the requested threshold', async () => {
    const first = await enqueueMemoryConsolidation('user-1', { characterId: 'char-a', trigger: 'scheduled' });
    const second = await enqueueMemoryConsolidation('user-1', { characterId: 'char-a', clusterThreshold: 0.65, trigger: 'manual' });
    expect(second).toBe(first);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.clusterThreshold).toBe(0.65);
  });

  it('leaves a running job alone', async () => {
    await enqueueMemoryConsolidation('user-1', { characterId: 'char-a', trigger: 'scheduled' });
    jobs[0].status = 'PROCESSING';
    await enqueueMemoryConsolidation('user-1', { characterId: 'char-a', clusterThreshold: 0.65, trigger: 'manual' });
    expect(repos.backgroundJobs.update).not.toHaveBeenCalled();
    expect(jobs[0].payload.clusterThreshold).toBeUndefined();
  });
});
