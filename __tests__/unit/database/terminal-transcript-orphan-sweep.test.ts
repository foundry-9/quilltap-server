import { promises as fsp, mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { TerminalSessionsRepository } from '@/lib/database/repositories/terminal-sessions.repository';

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

let logsDir = '';
jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getLogsDir: () => logsDir,
}));

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-26T12:00:00.000Z');

let repo: TerminalSessionsRepository;
let transcriptsDir: string;

function writeFile(name: string, ageMs: number): string {
  const p = path.join(transcriptsDir, name);
  writeFileSync(p, 'output');
  const t = new Date(NOW.getTime() - ageMs);
  utimesSync(p, t, t);
  return p;
}

beforeEach(() => {
  jest.clearAllMocks();
  logsDir = mkdtempSync(path.join(os.tmpdir(), 'qt-term-sweep-'));
  transcriptsDir = path.join(logsDir, 'terminals');
  mkdirSync(transcriptsDir, { recursive: true });
  repo = new TerminalSessionsRepository();
});

afterEach(() => {
  rmSync(logsDir, { recursive: true, force: true });
});

describe('TerminalSessionsRepository.sweepOrphanedTranscripts', () => {
  it('removes transcripts no row names and spares named, live, recent and non-log files', async () => {
    // Rows remaining after a chat delete cascaded the others away.
    const customPath = writeFile('custom-name.log', 48 * HOUR);
    (repo as any).findAll = jest.fn().mockResolvedValue([
      { id: 'kept', transcriptPath: null },
      { id: 'other', transcriptPath: customPath },
    ]);

    const kept = writeFile('kept.log', 48 * HOUR);
    const orphan = writeFile('deleted-chat-session.log', 48 * HOUR);
    const live = writeFile('live-no-row.log', 48 * HOUR);
    const fresh = writeFile('spawning.log', 5 * 60 * 1000);
    const bashrc = writeFile('init-deleted-chat-session.bashrc', 48 * HOUR);

    const result = await repo.sweepOrphanedTranscripts({
      isLive: (id) => id === 'live-no-row',
      graceMs: HOUR,
      now: NOW,
    });

    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(customPath)).toBe(true);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(bashrc)).toBe(true);
    expect(result).toEqual({ scanned: 5, deleted: 1 });
  });

  it('returns zeros when the transcript directory does not exist', async () => {
    rmSync(transcriptsDir, { recursive: true, force: true });
    (repo as any).findAll = jest.fn().mockResolvedValue([]);

    const result = await repo.sweepOrphanedTranscripts({ isLive: () => false, graceMs: HOUR, now: NOW });

    expect(result).toEqual({ scanned: 0, deleted: 0 });
    expect((repo as any).findAll).not.toHaveBeenCalled();
  });

  it('tolerates a file vanishing between listing and unlink', async () => {
    (repo as any).findAll = jest.fn().mockResolvedValue([]);
    writeFile('gone.log', 48 * HOUR);
    const unlinkSpy = jest.spyOn(fsp, 'unlink').mockImplementation(async () => {
      const e: NodeJS.ErrnoException = new Error('missing');
      e.code = 'ENOENT';
      throw e;
    });

    try {
      const result = await repo.sweepOrphanedTranscripts({ isLive: () => false, graceMs: HOUR, now: NOW });
      expect(result).toEqual({ scanned: 1, deleted: 0 });
    } finally {
      unlinkSpy.mockRestore();
    }
  });
});
