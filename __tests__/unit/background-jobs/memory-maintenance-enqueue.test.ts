/**
 * Memory maintenance enqueue rules (memory refactor §3.9):
 *   - bug 221: one MEMORY_MAINTENANCE job per character whatever the reason;
 *     a user-wide run fans out into one job per character, so a scheduled run
 *     and a watermark run collide on the same character.
 *   - a waiting job widens to the phases asked for; each phase keeps its own
 *     exemption, so merging a manual ask never lends a scheduled phase the
 *     manual exemption (PR 97 review);
 *   - a running job never absorbs a request: a new waiting job is made, which
 *     the handler defers while the running one finishes (PR 97 review);
 *   - a user-wide run reads the user's pending jobs once (PR 97 review).
 *   - bug 223: a manual run carries the requested `clusterThreshold`.
 */

import {
  enqueueMemoryMaintenance,
  enqueueMemoryMaintenanceForUser,
} from '@/lib/background-jobs/queue-service';
import { resolvePhases } from '@/lib/memory/maintenance/run';
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

const ALL = ['fold-near-duplicates', 'consolidate', 'demote', 'retire', 'mirror'];

describe('one maintenance job per character (bug 221)', () => {
  it('a user-wide run fans out into one job per live character, reading pending jobs once', async () => {
    const ids = await enqueueMemoryMaintenanceForUser('user-1', { reason: 'scheduled' });
    expect(ids).toHaveLength(2);
    expect(jobs.map((j) => [j.type, j.payload])).toEqual([
      ['MEMORY_MAINTENANCE', { reason: 'scheduled', characterId: 'char-a', exemptPhases: [] }],
      ['MEMORY_MAINTENANCE', { reason: 'scheduled', characterId: 'char-b', exemptPhases: [] }],
    ]);
    expect(repos.backgroundJobs.findByUserId).toHaveBeenCalledTimes(1);
    expect(repos.backgroundJobs.findByUserId).toHaveBeenCalledWith('user-1', 'PENDING');
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

  it('a waiting job widens to the phases asked for; only the hand-asked phases are exempt', async () => {
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
      exemptPhases: ['consolidate', 'mirror'],
      settings: { consolidation: { clusterThreshold: 0.65 } },
    });
  });

  it('a manual ask merged into a scheduled job does not lend it the exemption', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'scheduled' });
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'manual', phases: ['fold-near-duplicates'] });
    const merged = jobs[0].payload as any;
    expect(merged.phases).toBeUndefined();
    expect(merged.exemptPhases).toEqual(['fold-near-duplicates']);

    // With consolidation and maintenance both switched off, only the fold runs.
    const off = {
      maintenance: {
        enabled: false,
        phases: { foldNearDuplicates: true, demote: true, retire: true },
        coldRetentionDays: 30,
        consolidation: { enabled: false },
      },
    };
    const plan = resolvePhases(merged, off as never);
    expect(plan.get('fold-near-duplicates')).toBeNull();
    expect(plan.get('consolidate')).toBe('consolidation-disabled');
    expect(plan.get('demote')).toBe('maintenance-disabled');
    expect(plan.get('retire')).toBe('maintenance-disabled');
  });

  it('an unscoped manual ask exempts every phase', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'manual' });
    expect((jobs[0].payload as any).exemptPhases).toEqual(ALL);
  });

  it('a waiting job that runs every phase stays unscoped', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'scheduled' });
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'watermark', phases: ['demote'] });
    expect(jobs[0].payload).toEqual({ characterId: 'char-a', reason: 'scheduled', exemptPhases: [] });
  });

  it('a running job never absorbs a request: a new waiting job is made', async () => {
    await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'watermark', phases: ['demote'] });
    jobs[0].status = 'PROCESSING';
    const id = await enqueueMemoryMaintenance('user-1', { characterId: 'char-a', reason: 'manual', phases: ['consolidate'] });
    expect(id).toBe('job-2');
    expect(jobs[0].payload.phases).toEqual(['demote']);
    expect(jobs[1].payload).toMatchObject({ characterId: 'char-a', phases: ['consolidate'], exemptPhases: ['consolidate'] });
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
