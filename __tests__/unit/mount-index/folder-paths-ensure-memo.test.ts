/**
 * `ensureFolderPath` must be idempotent within a single background-job scope.
 *
 * In the forked job child, repository writes are buffered and reads use a
 * readonly connection, so a folder created earlier in the same job is invisible
 * to a later existence check — without a per-job memo, a second ensure for the
 * same path buffers a duplicate `docMountFolders.create`, which violates the
 * (mountPointId, parentId, name) unique index when the parent applies the batch
 * and atomically rolls back the whole job (the autonomous-room "poison write").
 *
 * These tests pin that a job-scoped memo collapses repeated ensures into a
 * single create, while the un-scoped path is unaffected.
 */

import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { runWithJobFolderCache } from '@/lib/background-jobs/child/job-folder-cache';
import { getRepositories } from '@/lib/repositories/factory';

jest.mock('@/lib/logger', () => {
  const childLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    logger: { ...childLogger, child: jest.fn(() => childLogger) },
  };
});

describe('ensureFolderPath job-scoped idempotency', () => {
  let create: jest.Mock;
  let findByMountPointAndPath: jest.Mock;

  beforeEach(() => {
    // Folder never pre-exists in the (readonly) DB view; each create returns a
    // row whose id derives from its path so nesting assertions are stable.
    findByMountPointAndPath = jest.fn(async () => null);
    create = jest.fn(async (data: { path: string; parentId: string | null }) => ({
      id: `id:${data.path}`,
      ...data,
      createdAt: '',
      updatedAt: '',
    }));
    jest.mocked(getRepositories).mockReturnValue({
      docMountFolders: { findByMountPointAndPath, create },
    } as unknown as ReturnType<typeof getRepositories>);
  });

  it('creates a folder only once across repeated ensures in the same job', async () => {
    await runWithJobFolderCache(async () => {
      const a = await ensureFolderPath('mp1', 'Covenant');
      const b = await ensureFolderPath('mp1', 'Covenant');
      expect(a).toBe('id:Covenant');
      expect(b).toBe('id:Covenant');
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('creates each segment of a nested path once, and not again on re-ensure', async () => {
    await runWithJobFolderCache(async () => {
      await ensureFolderPath('mp1', 'A/B');
      await ensureFolderPath('mp1', 'A/B');
    });
    // A and A/B each created exactly once; the second ensure is fully memoized.
    expect(create).toHaveBeenCalledTimes(2);
    const paths = create.mock.calls.map((c) => c[0].path);
    expect(paths).toEqual(['A', 'A/B']);
    // The 'A/B' segment nests under A's id from the same job.
    const bCall = create.mock.calls.find((c) => c[0].path === 'A/B');
    expect(bCall?.[0].parentId).toBe('id:A');
  });

  it('does not memoize across separate jobs (each job starts fresh)', async () => {
    await runWithJobFolderCache(async () => {
      await ensureFolderPath('mp1', 'Covenant');
    });
    await runWithJobFolderCache(async () => {
      await ensureFolderPath('mp1', 'Covenant');
    });
    // Distinct job scopes → distinct memos → one create each.
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('outside a job scope there is no memo (relies on the existence check)', async () => {
    // With no job scope the cache is null; since the fake never reports the
    // folder as existing, both ensures create — demonstrating the pre-fix
    // behavior the memo guards against in the buffered-write child.
    await ensureFolderPath('mp1', 'Covenant');
    await ensureFolderPath('mp1', 'Covenant');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
