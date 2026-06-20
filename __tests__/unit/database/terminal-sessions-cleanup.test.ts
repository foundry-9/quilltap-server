import { promises as fsp } from 'fs';
import { TerminalSessionsRepository } from '@/lib/database/repositories/terminal-sessions.repository';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getLogsDir: () => '/tmp/test-logs',
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2024-06-01T00:00:00.000Z').getTime();
const isoDaysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

let repo: TerminalSessionsRepository;
let unlinkSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  repo = new TerminalSessionsRepository();
  unlinkSpy = jest.spyOn(fsp, 'unlink');
});

afterEach(() => {
  unlinkSpy.mockRestore();
});

describe('TerminalSessionsRepository.cleanupClosedSessions', () => {
  it('reaps closed sessions, skips running ones, and unlinks transcripts', async () => {
    const sessions = [
      { id: 's-old-withpath', exitedAt: isoDaysAgo(40), transcriptPath: '/custom/s-old.log' },
      { id: 's-old-nopath', exitedAt: isoDaysAgo(40), transcriptPath: null },
      { id: 's-running', exitedAt: null, transcriptPath: null }, // never reap a live PTY
      { id: 's-recent', exitedAt: isoDaysAgo(5), transcriptPath: null }, // newer than cutoff
    ];
    (repo as any).findByFilter = jest.fn().mockResolvedValue(sessions);
    (repo as any).delete = jest.fn().mockResolvedValue(true);

    // The no-path session's derived transcript doesn't exist — must tolerate ENOENT.
    unlinkSpy.mockImplementation(async (p: any) => {
      if (p === '/tmp/test-logs/terminals/s-old-nopath.log') {
        const e: NodeJS.ErrnoException = new Error('missing');
        e.code = 'ENOENT';
        throw e;
      }
    });

    const cutoff = new Date(NOW - 30 * DAY);
    const result = await repo.cleanupClosedSessions(cutoff);

    // Only the two genuinely-old, closed sessions are reaped.
    const deletedIds = (repo as any).delete.mock.calls.map((c: any[]) => c[0]).sort();
    expect(deletedIds).toEqual(['s-old-nopath', 's-old-withpath']);
    expect((repo as any).delete).not.toHaveBeenCalledWith('s-running');
    expect((repo as any).delete).not.toHaveBeenCalledWith('s-recent');

    // Stored transcriptPath is preferred; otherwise the path is derived.
    expect(unlinkSpy).toHaveBeenCalledWith('/custom/s-old.log');
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/test-logs/terminals/s-old-nopath.log');

    // 2 rows deleted; only 1 transcript actually removed (the other was ENOENT).
    expect(result).toEqual({ rows: 2, transcripts: 1 });
  });

  it('never selects a still-running session even if the filter returns it', async () => {
    (repo as any).findByFilter = jest.fn().mockResolvedValue([
      { id: 'running-1', exitedAt: null, transcriptPath: null },
    ]);
    (repo as any).delete = jest.fn().mockResolvedValue(true);
    unlinkSpy.mockResolvedValue(undefined);

    const result = await repo.cleanupClosedSessions(new Date(NOW - 30 * DAY));

    expect((repo as any).delete).not.toHaveBeenCalled();
    expect(unlinkSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: 0, transcripts: 0 });
  });
});
