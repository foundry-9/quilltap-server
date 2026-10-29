/**
 * @jest-environment node
 *
 * The mount watcher on Node's recursive fs.watch. Chokidar 5 held a kqueue
 * descriptor per watched file on macOS; a store on a 24,000-file ~/Documents
 * reached 15,770 and Next.js could no longer spawn ("spawn EBADF"). fs.watch
 * reports only a path and "rename" / "change", so the watcher resolves each
 * event against the disk — these tests pin that resolution.
 */

jest.mock('@/lib/logging/create-logger', () => {
  const make = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { createServiceLogger: jest.fn(make), createLogger: jest.fn(make) };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  watch: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    access: jest.fn(),
    lstat: jest.fn(),
  },
}));

jest.mock('chokidar', () => ({
  __esModule: true,
  default: { watch: jest.fn() },
}));

jest.mock('@/lib/mount-index/scanner', () => {
  const actual = jest.requireActual('@/lib/mount-index/scanner');
  return {
    detectFileType: actual.detectFileType,
    matchesPattern: actual.matchesPattern,
    processMountFile: jest.fn(),
    removeMountFile: jest.fn(),
    updateMountPointTotals: jest.fn(),
    walkDirectory: jest.fn(),
  };
});

jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/lib/mount-index/db-store-events', () => ({
  onDocumentWritten: jest.fn(),
  onDocumentDeleted: jest.fn(),
  onDocumentMoved: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

import { attachMountPoint, detachMountPoint } from '@/lib/mount-index/watcher';
import { watch } from 'fs';
import fs from 'fs/promises';
import chokidar from 'chokidar';
import {
  processMountFile,
  removeMountFile,
  walkDirectory,
} from '@/lib/mount-index/scanner';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';

const mockWatch = watch as unknown as jest.Mock;
const mockLstat = fs.lstat as jest.Mock;
const mockAccess = fs.access as jest.Mock;
const mockChokidarWatch = chokidar.watch as jest.Mock;
const mockProcess = processMountFile as jest.Mock;
const mockRemove = removeMountFile as jest.Mock;
const mockWalk = walkDirectory as jest.Mock;
const mockGetRepositories = getRepositories as jest.Mock;

const BASE = '/Users/me/Documents';
let nextId = 0;

function makeMountPoint(overrides: Partial<DocMountPoint> = {}): DocMountPoint {
  nextId++;
  return {
    id: `mp-${nextId}`,
    name: 'Documents',
    basePath: BASE,
    mountType: 'filesystem',
    includePatterns: [],
    excludePatterns: ['.git'],
    enabled: true,
    ...overrides,
  } as unknown as DocMountPoint;
}

type Listener = (eventType: 'rename' | 'change', filename: string | null) => void;

function fakeFsWatcher() {
  return { on: jest.fn().mockReturnThis(), close: jest.fn() };
}

/** Attach a store and return the fs.watch listener it registered. */
async function attach(mp: DocMountPoint): Promise<Listener> {
  await attachMountPoint(mp);
  const call = mockWatch.mock.calls.at(-1);
  return call[2] as Listener;
}

const fileStat = { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false };
const dirStat = { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true };
const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

let attached: string[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  delete process.env.QUILLTAP_WATCHER_POLLING;
  mockAccess.mockResolvedValue(undefined);
  mockWatch.mockImplementation(() => fakeFsWatcher());
  mockProcess.mockResolvedValue({ status: 'unchanged' });
  mockRemove.mockResolvedValue(false);
  mockGetRepositories.mockReturnValue({
    docMountFiles: { findByMountPointId: jest.fn().mockResolvedValue([]) },
  });
});

afterEach(async () => {
  for (const id of attached) await detachMountPoint(id);
  attached = [];
  jest.useRealTimers();
});

async function attachTracked(mp: DocMountPoint): Promise<Listener> {
  attached.push(mp.id);
  return attach(mp);
}

describe('mount watcher on native fs.watch', () => {
  it('watches the base path recursively and does not use chokidar', async () => {
    await attachTracked(makeMountPoint());

    expect(mockWatch).toHaveBeenCalledWith(
      BASE,
      expect.objectContaining({ recursive: true }),
      expect.any(Function),
    );
    expect(mockChokidarWatch).not.toHaveBeenCalled();
  });

  it('indexes a file that was changed, once per burst', async () => {
    const listener = await attachTracked(makeMountPoint());
    mockLstat.mockResolvedValue(fileStat);

    listener('change', 'Notes/plan.md');
    listener('change', 'Notes/plan.md');
    listener('change', 'Notes/plan.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockProcess).toHaveBeenCalledTimes(1);
    expect(mockProcess).toHaveBeenCalledWith(
      expect.objectContaining({ basePath: BASE }),
      `${BASE}/Notes/plan.md`,
      'Notes/plan.md',
    );
  });

  it('ignores paths under an excluded segment', async () => {
    const listener = await attachTracked(makeMountPoint());

    listener('change', '.git/index');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockLstat).not.toHaveBeenCalled();
  });

  it('drops a deleted file from the index', async () => {
    const listener = await attachTracked(makeMountPoint());
    mockLstat.mockRejectedValue(enoent);
    mockRemove.mockResolvedValue(true);

    listener('rename', 'Notes/old.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockRemove).toHaveBeenCalledWith(expect.stringMatching(/^mp-/), 'Notes/old.md');
  });

  it('drops everything indexed beneath a folder that left', async () => {
    const mp = makeMountPoint();
    const listener = await attachTracked(mp);
    mockLstat.mockRejectedValue(enoent);
    mockGetRepositories.mockReturnValue({
      docMountFiles: {
        findByMountPointId: jest.fn().mockResolvedValue([
          { relativePath: 'Lore/a.md' },
          { relativePath: 'Lore/deep/b.txt' },
          { relativePath: 'Lore2/c.md' },
        ]),
      },
    });

    listener('rename', 'Lore');
    await jest.advanceTimersByTimeAsync(800);

    const removed = mockRemove.mock.calls.map(c => c[1]);
    expect(removed).toEqual(expect.arrayContaining(['Lore/a.md', 'Lore/deep/b.txt']));
    expect(removed).not.toContain('Lore2/c.md');
  });

  it('indexes every file in a folder that arrived', async () => {
    const listener = await attachTracked(makeMountPoint());
    mockLstat.mockResolvedValue(dirStat);
    mockWalk.mockResolvedValue([
      { relativePath: 'Imported/a.md', absolutePath: `${BASE}/Imported/a.md` },
      { relativePath: 'Imported/b.txt', absolutePath: `${BASE}/Imported/b.txt` },
    ]);

    listener('rename', 'Imported');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockWalk).toHaveBeenCalledWith(BASE, [], ['.git'], 'Imported');
    expect(mockProcess).toHaveBeenCalledTimes(2);
  });

  it('does not walk a folder whose only event was a change', async () => {
    const listener = await attachTracked(makeMountPoint());
    mockLstat.mockResolvedValue(dirStat);

    listener('change', 'Notes');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockWalk).not.toHaveBeenCalled();
  });

  it('skips symlinks', async () => {
    const listener = await attachTracked(makeMountPoint());
    mockLstat.mockResolvedValue({ ...fileStat, isSymbolicLink: () => true });

    listener('change', 'link.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('closes the native watcher on detach', async () => {
    const mp = makeMountPoint();
    await attachMountPoint(mp);
    const handle = mockWatch.mock.results.at(-1)!.value;

    await detachMountPoint(mp.id);

    expect(handle.close).toHaveBeenCalled();
  });
});

describe('polling and fallback', () => {
  function fakeChokidar() {
    const w = { on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
    w.on.mockReturnValue(w);
    return w;
  }

  it('polls through chokidar when QUILLTAP_WATCHER_POLLING=1', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';
    mockChokidarWatch.mockReturnValue(fakeChokidar());
    const mp = makeMountPoint();
    attached.push(mp.id);

    await attachMountPoint(mp);

    expect(mockWatch).not.toHaveBeenCalled();
    expect(mockChokidarWatch).toHaveBeenCalledWith(BASE, expect.objectContaining({ usePolling: true }));
  });

  it('polling ignores files the scanner would never index', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';
    mockChokidarWatch.mockReturnValue(fakeChokidar());
    const mp = makeMountPoint();
    attached.push(mp.id);
    await attachMountPoint(mp);
    const { ignored } = mockChokidarWatch.mock.calls[0][1];

    expect(ignored(`${BASE}/song.m4a`, { isFile: () => true })).toBe(true);
    expect(ignored(`${BASE}/notes.md`, { isFile: () => true })).toBe(false);
    expect(ignored(`${BASE}/Music`, { isFile: () => false })).toBe(false);
    expect(ignored(`${BASE}/.git`, undefined)).toBe(true);
  });

  it('falls back to polling when recursive watch is unavailable', async () => {
    mockWatch.mockImplementation(() => {
      throw Object.assign(new Error('unsupported'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    });
    mockChokidarWatch.mockReturnValue(fakeChokidar());
    const mp = makeMountPoint();
    attached.push(mp.id);

    await attachMountPoint(mp);

    expect(mockChokidarWatch).toHaveBeenCalledWith(BASE, expect.objectContaining({ usePolling: true }));
  });
});
