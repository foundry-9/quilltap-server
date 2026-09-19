/**
 * @jest-environment node
 *
 * Inform rows go into the archive and come back out again.
 *
 * `chat_informs` has no `userId` column (single-user), so nothing in the
 * per-user sweep would carry it: the backup has to collect it per chat and
 * write its own file, and the restore has to read that file and re-insert the
 * rows with their ids preserved. Consumed rows are included on purpose — a
 * consumed row is what lets a swipe of the turn that consumed it re-apply the
 * same passage in the restored instance.
 *
 * The write side drives the real `createBackup` and intercepts the shell
 * `zip`, reading the staging directory at the one moment the archive exists on
 * disk. The read side drives the real `restore` over a primed archive.
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

// Stand in for the shell `zip`, capturing the staged data directory before
// cleanup and leaving a file behind so the caller's `fs.stat` succeeds.
const stagedFilesByRun: string[][] = [];
const stagedInformsByRun: unknown[][] = [];
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
    const informsPath = path.join(dataDir, 'chat-informs.json');
    stagedInformsByRun.push(
      fs.existsSync(informsPath) ? JSON.parse(fs.readFileSync(informsPath, 'utf8')) : []
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

const CHAT_ID = 'chat-informs-backup';

const PENDING_INFORM = {
  id: 'inform-pending',
  chatId: CHAT_ID,
  batchId: 'batch-1',
  participantId: 'participant-alice',
  contentMarkdown: 'You notice the clock has stopped.',
  recordMessageId: 'msg-host-record',
  createdAt: '2026-09-19T21:14:00.000Z',
  updatedAt: '2026-09-19T21:14:00.000Z',
  consumedAt: null,
  consumedByMessageId: null,
};

const CONSUMED_INFORM = {
  ...PENDING_INFORM,
  id: 'inform-consumed',
  participantId: 'participant-bob',
  updatedAt: '2026-09-19T21:16:00.000Z',
  consumedAt: '2026-09-19T21:16:00.000Z',
  consumedByMessageId: 'msg-bob-replied',
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

describe('createBackup — chat informs', () => {
  const testUserId = 'user-informs-backup';
  let findInformsByChatId: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    stagedFilesByRun.length = 0;
    stagedInformsByRun.length = 0;

    findInformsByChatId = jest.fn(async (chatId: string) =>
      chatId === CHAT_ID ? [PENDING_INFORM, CONSUMED_INFORM] : []
    );

    const userRepos = repoStub({
      characters: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
      chats: methodStub({
        findAll: jest.fn().mockResolvedValue([{ id: CHAT_ID, title: 'The Stopped Clock' }]),
        getMessages: jest.fn().mockResolvedValue([]),
      }),
      llmLogs: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
    });
    const globalRepos = repoStub({
      chatSettings: methodStub({ findByUserId: jest.fn().mockResolvedValue(null) }),
      chatInforms: methodStub({ findByChatId: findInformsByChatId }),
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
    const informs = stagedInformsByRun[stagedInformsByRun.length - 1] as Array<
      Record<string, unknown>
    >;
    await fs.promises.rm(path.dirname(zipPath), { recursive: true, force: true });
    return { manifest, staged, informs };
  }

  it('writes data/chat-informs.json', async () => {
    const { staged } = await runBackup();
    expect(staged).toContain('chat-informs.json');
  });

  it('collects the rows per chat, consumed ones included', async () => {
    const { informs } = await runBackup();

    expect(findInformsByChatId).toHaveBeenCalledWith(CHAT_ID);
    expect(informs).toHaveLength(2);
    expect(informs.map((i) => i.id).sort()).toEqual(['inform-consumed', 'inform-pending']);
    // The consumed row keeps its anchor: a swipe of that turn re-applies it.
    expect(informs.find((i) => i.id === 'inform-consumed')).toMatchObject({
      consumedAt: '2026-09-19T21:16:00.000Z',
      consumedByMessageId: 'msg-bob-replied',
    });
  });

  it('reports the count in the manifest', async () => {
    const { manifest } = await runBackup();
    expect(manifest.counts.chatInforms).toBe(2);
  });
});

describe('restore — chat informs', () => {
  const testUserId = 'user-informs-restore';
  let informsCreate: jest.Mock;

  const EMPTY_COLLECTIONS = [
    'characters', 'tags', 'connectionProfiles', 'imageProfiles', 'embeddingProfiles',
    'files', 'promptTemplates', 'roleplayTemplates', 'providerModels', 'projects',
    'groups', 'llmLogs', 'pluginConfigs', 'folders', 'wardrobeItems',
    'characterPluginData', 'conversationAnnotations', 'chatDocuments',
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

    informsCreate = jest.fn(async (data: Record<string, unknown>, opts?: { id?: string }) => ({
      ...data,
      id: opts?.id ?? 'generated-inform-id',
    }));

    const userRepos = repoStub({});
    const globalRepos = repoStub({
      chatInforms: methodStub({ create: informsCreate }),
    });
    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);
  });

  function primeArchive(data: Record<string, unknown>) {
    (parseBackupZip as jest.Mock).mockResolvedValue({
      data,
      extractDir: '/tmp/qt-informs-test-extract',
      rootFolder: '',
    });
  }

  async function runRestore(chatInforms: unknown[]) {
    primeArchive(makeBackupData({ chatInforms }));
    return restore(testUserId, '/tmp/qt-informs-test.zip', {
      mode: 'replace',
      preserveIds: true,
    } as never);
  }

  it('re-inserts every row with its id preserved', async () => {
    const result = await runRestore([PENDING_INFORM, CONSUMED_INFORM]);

    expect(informsCreate).toHaveBeenCalledTimes(2);
    expect(informsCreate.mock.calls[0][1]).toEqual({ id: 'inform-pending' });
    expect(informsCreate.mock.calls[0][0]).toMatchObject({
      chatId: CHAT_ID,
      batchId: 'batch-1',
      participantId: 'participant-alice',
      contentMarkdown: 'You notice the clock has stopped.',
      recordMessageId: 'msg-host-record',
    });
    // `id` / `createdAt` / `updatedAt` are destructured off the payload and
    // handed to the repository as options instead.
    expect(informsCreate.mock.calls[0][0]).not.toHaveProperty('id');
    expect(result.chatInforms).toBe(2);
  });

  it('brings a consumed row back consumed', async () => {
    await runRestore([CONSUMED_INFORM]);

    expect(informsCreate.mock.calls[0][0]).toMatchObject({
      consumedAt: '2026-09-19T21:16:00.000Z',
      consumedByMessageId: 'msg-bob-replied',
    });
  });

  it('reports zero — and writes nothing — for a pre-4.10 archive with no file', async () => {
    primeArchive(makeBackupData({}));
    const result = await restore(testUserId, '/tmp/qt-informs-test.zip', {
      mode: 'replace',
      preserveIds: true,
    } as never);

    expect(informsCreate).not.toHaveBeenCalled();
    expect(result.chatInforms).toBe(0);
  });
});
