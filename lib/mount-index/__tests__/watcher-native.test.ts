/**
 * @jest-environment node
 *
 * The document-store watcher's domain on the shared recursive watcher core.
 * What the core itself does (debounce, ignore, lstat dispatch, symlinks, the
 * cloud guard, polling and its fallback) is pinned once, in
 * lib/files/__tests__/recursive-watcher.test.ts; these tests pin what a
 * store does with each event: index, drop, sweep a departed folder, walk an
 * arrived one, announce it, and stop on detach.
 */

jest.mock('@/lib/logging/create-logger', () => {
  const make = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });
  return { createServiceLogger: jest.fn(make), createLogger: jest.fn(make) };
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  watch: jest.fn(),
}));

jest.mock('fs/promises', () => {
  const lstat = jest.fn();
  const fns = { access: jest.fn(), lstat, stat: jest.fn() };
  // The store watcher reads the default export; the core imports lstat by name.
  return { __esModule: true, default: fns, ...fns };
});

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

jest.mock('@/lib/mount-index/realtime', () => ({
  publishMountChange: jest.fn(),
}));

import { attachMountPoint, detachMountPoint, stopMountWatchers } from '@/lib/mount-index/watcher';
import { watch } from 'fs';
import fs from 'fs/promises';
import {
  processMountFile,
  removeMountFile,
  walkDirectory,
} from '@/lib/mount-index/scanner';
import { getRepositories } from '@/lib/repositories/factory';
import { publishMountChange } from '@/lib/mount-index/realtime';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';

const mockWatch = watch as unknown as jest.Mock;
const mockLstat = fs.lstat as jest.Mock;
const mockAccess = fs.access as jest.Mock;
const mockStat = fs.stat as jest.Mock;
const mockProcess = processMountFile as jest.Mock;
const mockRemove = removeMountFile as jest.Mock;
const mockWalk = walkDirectory as jest.Mock;
const mockGetRepositories = getRepositories as jest.Mock;
const mockPublish = publishMountChange as jest.Mock;

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

describe('document-store watcher domain', () => {
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

  it('hands the store\'s exclude patterns to the core', async () => {
    const listener = await attachTracked(makeMountPoint({ excludePatterns: ['drafts'] }));

    listener('change', 'drafts/secret.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockLstat).not.toHaveBeenCalled();
  });

  it('closes every store\'s watcher on stopMountWatchers', async () => {
    await attachMountPoint(makeMountPoint());
    await attachMountPoint(makeMountPoint());
    const handles = mockWatch.mock.results.slice(-2).map(r => r.value);

    stopMountWatchers();

    for (const h of handles) expect(h.close).toHaveBeenCalled();
  });

  it('closes the native watcher on detach', async () => {
    const mp = makeMountPoint();
    await attachMountPoint(mp);
    const handle = mockWatch.mock.results.at(-1)!.value;

    await detachMountPoint(mp.id);

    expect(handle.close).toHaveBeenCalled();
  });
});

describe('realtime hints for outside changes', () => {
  it('announces a changed file once per burst', async () => {
    const mp = makeMountPoint();
    const listener = await attachTracked(mp);
    mockLstat.mockResolvedValue(fileStat);
    mockProcess.mockResolvedValue({ status: 'modified', chunksCreated: 1 });

    listener('change', 'Notes/a.md');
    listener('change', 'Notes/b.md');
    await jest.advanceTimersByTimeAsync(1100);

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(mp.id);
  });

  it('announces a removed file and a folder that arrived or left', async () => {
    const mp = makeMountPoint();
    const listener = await attachTracked(mp);

    mockLstat.mockRejectedValue(enoent);
    mockRemove.mockResolvedValue(true);
    listener('rename', 'Notes/old.md');
    await jest.advanceTimersByTimeAsync(1100);
    expect(mockPublish).toHaveBeenCalledTimes(1);

    mockRemove.mockResolvedValue(false);
    listener('rename', 'Empty');
    await jest.advanceTimersByTimeAsync(1100);
    expect(mockPublish).toHaveBeenCalledTimes(2);

    mockLstat.mockResolvedValue(dirStat);
    mockWalk.mockResolvedValue([]);
    listener('rename', 'New Folder');
    await jest.advanceTimersByTimeAsync(1100);
    expect(mockPublish).toHaveBeenCalledTimes(3);
  });

  it('says nothing when a file is unchanged', async () => {
    const listener = await attachTracked(makeMountPoint());
    mockLstat.mockResolvedValue(fileStat);

    listener('change', 'Notes/plan.md');
    await jest.advanceTimersByTimeAsync(1100);

    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe('polling snapshot', () => {
  const file = (relativePath: string) => ({ relativePath, absolutePath: `${BASE}/${relativePath}` });

  it('snapshots the store by walking it when QUILLTAP_WATCHER_POLLING=1', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';
    mockWalk.mockResolvedValue([]);
    const mp = makeMountPoint();
    attached.push(mp.id);

    await attachMountPoint(mp);
    await jest.advanceTimersByTimeAsync(0);

    expect(mockWatch).not.toHaveBeenCalled();
    expect(mockWalk).toHaveBeenCalledWith(BASE, [], ['.git']);
  });

  it('indexes what changed or arrived between walks, and drops what left', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';
    const mtimes: Record<string, number> = { 'kept.md': 1, 'edited.md': 1, 'gone.md': 1 };
    mockStat.mockImplementation(async (abs: string) => ({
      mtimeMs: mtimes[abs.slice(BASE.length + 1)],
      size: 10,
    }));
    mockWalk.mockResolvedValue([file('kept.md'), file('edited.md'), file('gone.md'), file('song.m4a')]);
    const mp = makeMountPoint();
    attached.push(mp.id);
    await attachMountPoint(mp);
    await jest.advanceTimersByTimeAsync(0);

    // The baseline walk indexes nothing — the startup scan covers it.
    expect(mockStat).not.toHaveBeenCalledWith(`${BASE}/song.m4a`);
    expect(mockProcess).not.toHaveBeenCalled();

    mtimes['edited.md'] = 2;
    mtimes['new.md'] = 1;
    mockLstat.mockImplementation(async (abs: string) => {
      if (abs.endsWith('gone.md')) throw enoent;
      return fileStat;
    });
    mockWalk.mockResolvedValue([file('kept.md'), file('edited.md'), file('new.md')]);
    await jest.advanceTimersByTimeAsync(2000 + 800);

    const processed = mockProcess.mock.calls.map(c => c[2]);
    expect(processed.sort()).toEqual(['edited.md', 'new.md']);
    expect(mockRemove.mock.calls.map(c => c[1])).toEqual(['gone.md']);
  });

});
