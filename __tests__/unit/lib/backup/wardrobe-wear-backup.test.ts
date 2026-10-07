/**
 * @jest-environment node
 *
 * The wardrobe wear ledger (`wardrobe_wear_stats`) goes into the archive and
 * comes back out again (wardrobe-wear-ledger.md §6).
 *
 * The table has no `userId` column (single-user), so nothing in the per-user
 * sweep would carry it: the backup dumps the whole table into its own file,
 * and the restore reads that file and writes the rows back as given through
 * `upsertRows` (no increment).
 *
 * Same harness as chat-informs-backup.test.ts: the write side drives the real
 * `createBackup` and intercepts the shell `zip`; the read side drives the real
 * `restore` over a primed archive.
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

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn(), listUserFiles: jest.fn(), uploadFile: jest.fn() },
}));

jest.mock('@/lib/file-storage/user-uploads-bridge', () => ({
  writeUserUploadToMountStore: jest.fn(),
}));

jest.mock('@/lib/paths', () => ({
  getNpmPluginsDir: jest.fn(() => '/tmp/qt-wear-test-absent-plugins'),
  getThemesDir: jest.fn(() => '/tmp/qt-wear-test-absent-themes'),
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

// Stand in for the shell `zip`, capturing the staged data directory before
// cleanup and leaving a file behind so the caller's `fs.stat` succeeds.
const stagedFilesByRun: string[][] = [];
const stagedLedgerByRun: unknown[][] = [];
jest.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    opts: { cwd: string },
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
  ) => {
    const [, zipPath, folderName] = args;
    const dataDir = path.join(opts.cwd, folderName, 'data');
    stagedFilesByRun.push(fs.existsSync(dataDir) ? fs.readdirSync(dataDir).sort() : []);
    const ledgerPath = path.join(dataDir, 'wardrobe-wear.json');
    stagedLedgerByRun.push(
      fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : []
    );
    fs.writeFileSync(zipPath, 'not really a zip');
    cb(null, { stdout: '', stderr: '' });
  },
}));

import { createBackup } from '@/lib/backup/backup-service';
import { restore } from '@/lib/backup/restore/restore';
import { parseBackupZip } from '@/lib/backup/restore/archive';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';

const LEDGER_ROWS = [
  {
    id: 'row-ada-coat',
    itemId: 'item-coat',
    wearerCharacterId: 'char-ada',
    wearCount: 3,
    firstWornAt: '2026-09-01T10:00:00.000Z',
    lastWornAt: '2026-09-19T21:14:00.000Z',
    lastWornChatId: 'chat-1',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-19T21:14:00.000Z',
  },
  {
    id: 'row-unattributed-coat',
    itemId: 'item-coat',
    wearerCharacterId: null,
    wearCount: 2,
    firstWornAt: '2026-08-01T10:00:00.000Z',
    lastWornAt: '2026-08-02T10:00:00.000Z',
    lastWornChatId: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
  },
];

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

describe('createBackup — wardrobe wear ledger', () => {
  const testUserId = 'user-wear-backup';
  let findAllLedger: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    stagedFilesByRun.length = 0;
    stagedLedgerByRun.length = 0;

    findAllLedger = jest.fn().mockResolvedValue(LEDGER_ROWS);

    const userRepos = repoStub({
      characters: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
      chats: methodStub({
        findAll: jest.fn().mockResolvedValue([]),
        getMessages: jest.fn().mockResolvedValue([]),
      }),
      llmLogs: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
    });
    const globalRepos = repoStub({
      chatSettings: methodStub({ findByUserId: jest.fn().mockResolvedValue(null) }),
      wardrobeWear: methodStub({ findAll: findAllLedger }),
      vectorIndices: methodStub({
        getAllCharacterIds: jest.fn().mockResolvedValue([]),
        findMetaByCharacterId: jest.fn().mockResolvedValue(null),
        findEntriesByCharacterId: jest.fn().mockResolvedValue([]),
      }),
      textReplacementRules: methodStub({ list: jest.fn().mockResolvedValue([]) }),
    });

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);
  });

  async function runBackup() {
    const { zipPath, manifest } = await createBackup(testUserId);
    const staged = stagedFilesByRun[stagedFilesByRun.length - 1];
    const ledger = stagedLedgerByRun[stagedLedgerByRun.length - 1] as Array<Record<string, unknown>>;
    await fs.promises.rm(path.dirname(zipPath), { recursive: true, force: true });
    return { manifest, staged, ledger };
  }

  it('writes data/wardrobe-wear.json with the whole table, unattributed rows included', async () => {
    const { staged, ledger } = await runBackup();

    expect(findAllLedger).toHaveBeenCalled();
    expect(staged).toContain('wardrobe-wear.json');
    expect(ledger).toEqual(LEDGER_ROWS);
  });

  it('reports the count in the manifest', async () => {
    const { manifest } = await runBackup();
    expect(manifest.counts.wardrobeWear).toBe(2);
  });
});

describe('restore — wardrobe wear ledger', () => {
  const testUserId = 'user-wear-restore';
  let upsertRows: jest.Mock;

  const EMPTY_COLLECTIONS = [
    'characters', 'tags', 'connectionProfiles', 'imageProfiles', 'embeddingProfiles',
    'files', 'promptTemplates', 'roleplayTemplates', 'providerModels', 'projects',
    'groups', 'llmLogs', 'pluginConfigs', 'folders', 'wardrobeItems',
    'characterPluginData', 'conversationAnnotations', 'chatDocuments', 'chatInforms',
    'instanceSettings', 'embeddingStatus', 'conversationChunks', 'tfidfVocabularies',
    'vectorIndexMetas', 'textReplacementRules', 'docMountPoints', 'docMountFiles',
    'docMountDocuments', 'docMountChunks', 'docMountFileLinks', 'docMountFolders',
    'docMountBlobs', 'projectDocMountLinks', 'groupDocMountLinks',
    'groupCharacterMembers', 'vectorEntries',
  ] as const;

  function makeBackupData(overrides: Record<string, unknown>) {
    const base: Record<string, unknown> = {
      manifest: { backupFormat: 4 },
      chats: [],
      memories: [],
      chatSettings: [],
    };
    for (const key of EMPTY_COLLECTIONS) base[key] = [];
    return { ...base, ...overrides };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    upsertRows = jest.fn().mockResolvedValue(undefined);
    (getUserRepositories as jest.Mock).mockReturnValue(repoStub({}));
    (getRepositories as jest.Mock).mockReturnValue(
      repoStub({ wardrobeWear: methodStub({ upsertRows }) })
    );
  });

  function primeArchive(data: Record<string, unknown>) {
    (parseBackupZip as jest.Mock).mockResolvedValue({
      data,
      extractDir: '/tmp/qt-wear-test-extract',
      rootFolder: '',
    });
  }

  it('writes every row back as given, ids and tallies intact', async () => {
    primeArchive(makeBackupData({ wardrobeWear: LEDGER_ROWS }));
    const result = await restore(testUserId, '/tmp/qt-wear-test.zip', {
      mode: 'replace',
      preserveIds: true,
    } as never);

    expect(upsertRows).toHaveBeenCalledTimes(1);
    expect(upsertRows).toHaveBeenCalledWith(LEDGER_ROWS);
    expect(result.wardrobeWear).toBe(2);
  });

  it('reports zero — and writes nothing — for an archive that predates the ledger', async () => {
    primeArchive(makeBackupData({}));
    const result = await restore(testUserId, '/tmp/qt-wear-test.zip', {
      mode: 'replace',
      preserveIds: true,
    } as never);

    expect(upsertRows).not.toHaveBeenCalled();
    expect(result.wardrobeWear).toBe(0);
  });
});
