/**
 * @jest-environment node
 *
 * Ariel's terminal sessions stay out of the archive on purpose.
 *
 * `terminal_sessions` rows and the transcripts under `logs/terminals/` are
 * runtime state, not record: a shell cannot be restored, `cwd` names a path on
 * the old machine, closed sessions are reaped after
 * `CLOSED_TERMINAL_RETENTION_DAYS`, and a transcript is raw shell output that
 * can hold whatever secret was printed into it. What a character needs to
 * keep — Ariel's dispatches — already lives in `chat_messages`. The exclusion
 * is stated in `help/system-backup-restore.md`; this test keeps the code to it.
 *
 * Drives the real `createBackup` and intercepts the shell `zip`, reading the
 * staging tree at the one moment the archive exists on disk.
 */

import fs from 'fs';
import path from 'path';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
  getUserRepositories: jest.fn(),
}));

// The restore drops the memory-index cache once the rows are in.
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: { reloadAll: jest.fn() },
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn(), listUserFiles: jest.fn(), uploadFile: jest.fn() },
}));

jest.mock('@/lib/file-storage/user-uploads-bridge', () => ({
  writeUserUploadToMountStore: jest.fn(),
}));

jest.mock('@/lib/paths', () => ({
  getNpmPluginsDir: jest.fn(() => '/tmp/qt-informs-test-absent-plugins'),
  getThemesDir: jest.fn(() => '/tmp/qt-informs-test-absent-themes'),
}));

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(() => null),
}));
jest.mock('@/lib/database/backends/sqlite/protection', () => ({
  runBackupCheckpoint: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  getRawLLMLogsDatabase: jest.fn(() => null),
  isLLMLogsDegraded: jest.fn(() => true),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-protection', () => ({
  runLLMLogsBackupCheckpoint: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(() => null),
  isMountIndexDegraded: jest.fn(() => true),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-protection', () => ({
  runMountIndexBackupCheckpoint: jest.fn(),
}));

jest.mock('@/lib/backup/restore/archive', () => ({
  parseBackupZip: jest.fn(),
  getFileFromExtractedBackup: jest.fn(),
  cleanupDir: jest.fn(),
}));

jest.mock('@/lib/backup/restore/delete-service', () => ({
  deleteUserData: jest.fn(),
}));

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}));

jest.mock('@/lib/llm/connection-profile-names', () => ({
  normalizeProfileName: jest.fn((n: string) => n),
  makeUniqueProfileName: jest.fn((n: string) => n),
}));

// Stand in for the shell `zip`, capturing every path staged for the archive
// before cleanup and leaving a file behind so the caller's `fs.stat` succeeds.
const stagedTreesByRun: string[][] = [];
function walk(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? [rel, ...walk(path.join(dir, entry.name), rel)] : [rel];
  });
}
jest.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    opts: { cwd: string },
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
  ) => {
    const [, zipPath, folderName] = args;
    stagedTreesByRun.push(walk(path.join(opts.cwd, folderName)).sort());
    fs.writeFileSync(zipPath, 'not really a zip');
    cb(null, { stdout: '', stderr: '' });
  },
}));

import { createBackup } from '@/lib/backup/backup-service';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';

const CHAT_ID = 'chat-with-terminal';

const CLOSED_SESSION = {
  id: 'terminal-closed',
  chatId: CHAT_ID,
  label: null,
  shell: 'bash',
  cwd: '/home/someone/project',
  startedAt: '2026-10-20T09:00:00.000Z',
  exitedAt: '2026-10-20T09:30:00.000Z',
  exitCode: 0,
  transcriptPath: '/home/someone/.quilltap/logs/terminals/terminal-closed.log',
  cols: 120,
  rows: 40,
};

function methodStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue([]));
      return cache.get(prop);
    },
  });
}

function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (!cache.has(prop)) cache.set(prop, methodStub());
      return cache.get(prop);
    },
  });
}

describe('createBackup — terminal sessions are left out', () => {
  const testUserId = 'user-terminal-backup';
  let terminalSessions: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();
    stagedTreesByRun.length = 0;

    // Every method answers with the session, so any read of the repository
    // would put it in reach of the archive.
    const answer = jest.fn().mockResolvedValue([CLOSED_SESSION]);
    terminalSessions = {
      findAll: answer,
      findByChatId: answer,
      findByFilter: answer,
      findById: jest.fn().mockResolvedValue(CLOSED_SESSION),
    };

    const userRepos = repoStub({
      characters: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
      chats: methodStub({
        findAll: jest.fn().mockResolvedValue([{ id: CHAT_ID, title: 'The Engine Room' }]),
        getMessages: jest.fn().mockResolvedValue([]),
      }),
      llmLogs: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
      terminalSessions: methodStub(terminalSessions),
    });
    const globalRepos = repoStub({
      chatSettings: methodStub({ findByUserId: jest.fn().mockResolvedValue(null) }),
      textReplacementRules: methodStub({ list: jest.fn().mockResolvedValue([]) }),
      terminalSessions: methodStub(terminalSessions),
    });

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);
  });

  async function runBackup() {
    const { zipPath, manifest } = await createBackup(testUserId);
    const staged = stagedTreesByRun[stagedTreesByRun.length - 1];
    await fs.promises.rm(path.dirname(zipPath), { recursive: true, force: true });
    return { manifest, staged };
  }

  it('never reads the terminal_sessions table', async () => {
    await runBackup();
    for (const method of Object.values(terminalSessions)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('stages no session rows and no transcripts', async () => {
    const { staged } = await runBackup();
    expect(staged.length).toBeGreaterThan(0);
    expect(staged.filter((p) => /terminal/i.test(p))).toEqual([]);
    expect(staged.filter((p) => p.endsWith('.log'))).toEqual([]);
  });

  it('reports no terminal count in the manifest', async () => {
    const { manifest } = await runBackup();
    expect(Object.keys(manifest.counts).filter((k) => /terminal/i.test(k))).toEqual([]);
  });
});
