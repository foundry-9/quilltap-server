/**
 * @jest-environment node
 *
 * The recursive watcher core shared by the document-store watcher and the
 * `files/` watcher. fs.watch reports only a path and "rename" / "change", so
 * the core resolves each event against the disk — these tests pin that
 * resolution, the debounce, the cloud-placeholder guard and the polling
 * fallback, once, for both watchers.
 */

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  watch: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  lstat: jest.fn(),
}));

import { watch } from 'fs';
import { lstat } from 'fs/promises';
import {
  createRecursiveWatcher,
  type PolledFile,
  type RecursiveWatcher,
  type RecursiveWatcherSpec,
} from '@/lib/files/recursive-watcher';

const mockWatch = watch as unknown as jest.Mock;
const mockLstat = lstat as unknown as jest.Mock;

const ROOT = '/root/store';

type Listener = (eventType: 'rename' | 'change', filename: string | null) => void;

const fileStat = { isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false, size: 10, blocks: 8 };
const dirStat = { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true, size: 0, blocks: 0 };
const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

let on: { file: jest.Mock; gone: jest.Mock; dirArrived: jest.Mock; inCloud: jest.Mock };
let snapshot: jest.Mock<Promise<Map<string, PolledFile>>, []>;
let log: { debug: jest.Mock; info: jest.Mock; warn: jest.Mock; error: jest.Mock };
let handle: RecursiveWatcher | null;
let fakeFsWatcher: { on: jest.Mock; close: jest.Mock };

function start(overrides: Partial<RecursiveWatcherSpec> = {}): Listener | undefined {
  handle = createRecursiveWatcher({
    root: ROOT,
    normalize: (f) => f,
    ignore: (rel) => rel.split('/').includes('.git'),
    polling: { snapshot },
    on,
    log,
    ...overrides,
  });
  return mockWatch.mock.calls.at(-1)?.[2] as Listener | undefined;
}

function snap(entries: Record<string, number>): Map<string, PolledFile> {
  return new Map(Object.entries(entries).map(([k, mtimeMs]) => [k, { mtimeMs, size: 10 }]));
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  delete process.env.QUILLTAP_WATCHER_POLLING;
  fakeFsWatcher = { on: jest.fn().mockReturnThis(), close: jest.fn() };
  mockWatch.mockImplementation(() => fakeFsWatcher);
  on = {
    file: jest.fn().mockResolvedValue(undefined),
    gone: jest.fn().mockResolvedValue(undefined),
    dirArrived: jest.fn().mockResolvedValue(undefined),
    inCloud: jest.fn(),
  };
  snapshot = jest.fn().mockResolvedValue(new Map());
  log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  handle = null;
});

afterEach(() => {
  handle?.close();
  jest.useRealTimers();
});

describe('native recursive watch', () => {
  it('watches the root recursively and does not poll', () => {
    start();

    expect(mockWatch).toHaveBeenCalledWith(ROOT, expect.objectContaining({ recursive: true }), expect.any(Function));
    expect(handle!.mode).toBe('native');
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('hands a file that changed to the domain once per burst', async () => {
    const listener = start()!;
    mockLstat.mockResolvedValue(fileStat);

    listener('change', 'Notes/plan.md');
    listener('change', 'Notes/plan.md');
    listener('rename', 'Notes/plan.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(mockLstat).toHaveBeenCalledTimes(1);
    expect(mockLstat).toHaveBeenCalledWith(`${ROOT}/Notes/plan.md`);
    expect(on.file).toHaveBeenCalledTimes(1);
    expect(on.file).toHaveBeenCalledWith('Notes/plan.md', fileStat);
  });

  it('debounces for 750 ms by default', async () => {
    const listener = start()!;
    mockLstat.mockResolvedValue(fileStat);

    listener('change', 'a.md');
    await jest.advanceTimersByTimeAsync(700);
    expect(on.file).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100);
    expect(on.file).toHaveBeenCalledTimes(1);
  });

  it('ignores what the domain ignores, and paths that climb out or say nothing', async () => {
    const listener = start()!;

    listener('change', '.git/index');
    listener('change', '../outside.md');
    listener('change', '.');
    listener('change', '');
    listener('change', null);
    await jest.advanceTimersByTimeAsync(800);

    expect(mockLstat).not.toHaveBeenCalled();
  });

  it('applies the domain normalizer before anything else', async () => {
    const listener = start({ normalize: (f) => f.replace(/\\/g, '/') })!;
    mockLstat.mockResolvedValue(fileStat);

    listener('change', 'Notes\\plan.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(on.file).toHaveBeenCalledWith('Notes/plan.md', fileStat);
  });

  it('reports a path that is gone, saying whether a rename was seen', async () => {
    const listener = start()!;
    mockLstat.mockRejectedValue(enoent);

    listener('rename', 'Lore');
    listener('change', 'old.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(on.gone).toHaveBeenCalledWith('Lore', true);
    expect(on.gone).toHaveBeenCalledWith('old.md', false);
  });

  it('treats ENOTDIR as gone, and logs any other lstat failure', async () => {
    const listener = start()!;
    mockLstat.mockRejectedValueOnce(Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }));
    listener('rename', 'a/b.md');
    await jest.advanceTimersByTimeAsync(800);
    expect(on.gone).toHaveBeenCalledWith('a/b.md', true);

    mockLstat.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    listener('change', 'locked.md');
    await jest.advanceTimersByTimeAsync(800);
    expect(on.gone).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('Error in debounced watcher handler', expect.objectContaining({ relativePath: 'locked.md' }));
  });

  it('hands a folder that arrived by rename to the domain', async () => {
    const listener = start()!;
    mockLstat.mockResolvedValue(dirStat);

    listener('rename', 'Imported');
    await jest.advanceTimersByTimeAsync(800);

    expect(on.dirArrived).toHaveBeenCalledWith('Imported');
  });

  it('does not report a folder whose only event was a change', async () => {
    const listener = start()!;
    mockLstat.mockResolvedValue(dirStat);

    listener('change', 'Notes');
    await jest.advanceTimersByTimeAsync(800);

    expect(on.dirArrived).not.toHaveBeenCalled();
  });

  it('skips symlinks', async () => {
    const listener = start()!;
    mockLstat.mockResolvedValue({ ...fileStat, isSymbolicLink: () => true });

    listener('change', 'link.md');
    listener('rename', 'linked-folder');
    await jest.advanceTimersByTimeAsync(800);

    expect(on.file).not.toHaveBeenCalled();
    expect(on.dirArrived).not.toHaveBeenCalled();
  });

  it('leaves an evicted cloud placeholder unread', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const listener = start()!;
      mockLstat.mockResolvedValue({ ...fileStat, size: 4096, blocks: 0 });

      listener('change', 'evicted.md');
      await jest.advanceTimersByTimeAsync(800);

      expect(on.file).not.toHaveBeenCalled();
      expect(on.inCloud).toHaveBeenCalledWith('evicted.md');
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('catches and logs a domain handler that throws', async () => {
    const listener = start()!;
    mockLstat.mockResolvedValue(fileStat);
    on.file.mockRejectedValueOnce(new Error('boom'));

    listener('change', 'a.md');
    await jest.advanceTimersByTimeAsync(800);

    expect(log.warn).toHaveBeenCalledWith('Error in debounced watcher handler', expect.objectContaining({ error: 'boom' }));
  });

  it('logs an error event from the watch', () => {
    start();
    const errorListener = fakeFsWatcher.on.mock.calls.find((c) => c[0] === 'error')![1];

    errorListener(new Error('queue overflow'));

    expect(log.error).toHaveBeenCalledWith('Watcher error', expect.objectContaining({ error: 'queue overflow' }));
  });

  it('closes the watch and drops pending events on close', async () => {
    const listener = start()!;
    mockLstat.mockResolvedValue(fileStat);

    listener('change', 'a.md');
    handle!.close();
    await jest.advanceTimersByTimeAsync(800);

    expect(fakeFsWatcher.close).toHaveBeenCalled();
    expect(on.file).not.toHaveBeenCalled();
  });
});

describe('polling and fallback', () => {
  it('polls the snapshot when QUILLTAP_WATCHER_POLLING=1', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';

    start();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockWatch).not.toHaveBeenCalled();
    expect(handle!.mode).toBe('polling');
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when recursive watch is unavailable', async () => {
    mockWatch.mockImplementation(() => {
      throw Object.assign(new Error('unsupported'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
    });

    start();
    await jest.advanceTimersByTimeAsync(0);

    expect(handle!.mode).toBe('polling');
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      'Native recursive watch unavailable, falling back to polling',
      expect.any(Object),
    );
  });

  it('reports what changed or arrived between walks, and what left', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';
    snapshot.mockResolvedValueOnce(snap({ 'kept.md': 1, 'edited.md': 1, 'gone.md': 1 }));
    start();
    await jest.advanceTimersByTimeAsync(0);

    // The baseline walk reports nothing — the startup scan covers it.
    expect(mockLstat).not.toHaveBeenCalled();

    snapshot.mockResolvedValue(snap({ 'kept.md': 1, 'edited.md': 2, 'new.md': 1 }));
    mockLstat.mockImplementation(async (abs: string) => {
      if (abs.endsWith('gone.md')) throw enoent;
      return fileStat;
    });
    await jest.advanceTimersByTimeAsync(2000 + 800);

    expect(on.file.mock.calls.map((c) => c[0]).sort()).toEqual(['edited.md', 'new.md']);
    expect(on.gone).toHaveBeenCalledWith('gone.md', true);
  });

  it('stops walking once closed', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';
    start();
    await jest.advanceTimersByTimeAsync(0);
    handle!.close();
    snapshot.mockClear();

    await jest.advanceTimersByTimeAsync(10_000);

    expect(snapshot).not.toHaveBeenCalled();
  });

  it('logs a failed walk and keeps polling', async () => {
    process.env.QUILLTAP_WATCHER_POLLING = '1';
    snapshot.mockRejectedValueOnce(new Error('EIO'));
    start();
    await jest.advanceTimersByTimeAsync(0);

    expect(log.error).toHaveBeenCalledWith('Watcher polling walk failed', expect.objectContaining({ error: 'EIO' }));
    await jest.advanceTimersByTimeAsync(2000);
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});
