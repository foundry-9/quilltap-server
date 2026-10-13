/**
 * Memory maintenance enqueue rules (memory refactor §3.9):
 *   - bug 221: one MEMORY_MAINTENANCE job per character whatever the reason;
 *     a user-wide run fans out into one job per character, so a scheduled run
 *     and a watermark run collide on the same character.
 *   - a waiting job widens to the phases asked for; a running one is left.
 *   - bug 223: a manual run carries the requested `clusterThreshold`.
 */

import {
  enqueueMemoryMaintenance,
  enqueueMemoryMaintenanceForUser,
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
      findByUserId: jest.fn(async () => [{ id: 'char-a' }, { id: 'char-b' }, { id: 'char-gone', archivedAt: '2026-01-01' }]),
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

describe('one maintenance job per character (bug 221)', () => {
  it('a user-wide run fans out into one job per live character', async () => {
    const ids = await enqueueMemoryMaintenanceForUser('user-1', { reason: 'scheduled' });
    expect(ids).toHaveLength(2);
    expect(jobs.map((j) => [j.type, j.payload])).toEqual([
      ['MEMORY_MAINTENANCE', { reason: 'scheduled', characterId: 'char-a' }],
      ['MEMORY_MAINTENANCE', { reason: 'scheduled', characterId: 'char-b' }],
    ]);
  });

  it('a watermark run collides with the scheduled run for the same character', async () => {
    await enqueueMemoryMaintenanceForUser('user-1', { reason: 'scheduled' });
    const id = await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'watermark', phases: ['demote'] });
    expect(id).toBe('job-1');
    expect(jobs).toHaveLength(2);
  });

  it('a different character gets its own job', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'watermark', phases: ['demote'] });
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-b', reason: 'watermark', phases: ['demote'] });
    expect(jobs).toHaveLength(2);
  });

  it('a waiting job widens to the phases asked for, and a manual ask makes it manual', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'watermark', phases: ['demote'] });
    await enqueueMemoryMaintenance('user-1', {
      characterId: 'char-a',
      reason: 'manual',
      phases: ['consolidate', 'mirror'],
      settings: { consolidation: { clusterThreshold: 0.65 } },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({
      characterId: 'char-a',
      reason: 'manual',
      phases: ['demote', 'consolidate', 'mirror'],
      settings: { consolidation: { clusterThreshold: 0.65 } },
    });
  });

  it('a waiting job that runs every phase stays unscoped', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'scheduled' });
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'watermark', phases: ['demote'] });
    expect(jobs[0].payload).toEqual({ characterId: 'char-a', reason: 'scheduled' });
  });

  it('a running job is left alone', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'watermark', phases: ['demote'] });
    jobs[0].status = 'PROCESSING';
    const id = await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'manual', phases: ['consolidate'] });
    expect(id).toBe('job-1');
    expect(jobs[0].payload.phases).toEqual(['demote']);
    expect(repos.backgroundJobs.update).not.toHaveBeenCalled();
  });

  it('bug 223: a manual run carries the requested cluster threshold', async () => {
    await enqueueMemoryMaintenance('user-1', {
      characterId: 'char-a',
      reason: 'manual',
      phases: ['consolidate'],
      settings: { consolidation: { clusterThreshold: 0.6 } },
    });
    expect(jobs[0].payload.settings).toEqual({ consolidation: { clusterThreshold: 0.6 } });
  });
});
