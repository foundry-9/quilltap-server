/**
 * @jest-environment node
 *
 * The Salon avatar timeline (`chat_avatar_timeline`, 4.13) goes into the
 * archive and comes back out again.
 *
 * The table has no `userId` column, so the backup collects it whole and
 * writes its own file (`data/avatar-timeline.json`); the restore reads that
 * file and hands the rows to `upsertRows`, the one sanctioned bulk writer for
 * restore and import. In a new-account restore the rows are renamed with the
 * chat and character they belong to, and `imageId` follows the same remap the
 * chat's own avatar pointers take, so the timeline keeps naming the file the
 * bubble was drawn with.
 *
 * The write side drives the real `createBackup` and intercepts the shell
 * `zip`, reading the staging directory at the one moment the archive exists on
 * disk. The read side drives the real `restore` over a primed archive. The
 * remap side drives the real `remapBackupData`.
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
      child: jest.fn(),
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
  getNpmPluginsDir: jest.fn(() => '/tmp/qt-avatar-timeline-test-absent-plugins'),
  getThemesDir: jest.fn(() => '/tmp/qt-avatar-timeline-test-absent-themes'),
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
const stagedRowsByRun: unknown[][] = [];
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
    const rowsPath = path.join(dataDir, 'avatar-timeline.json');
    stagedRowsByRun.push(fs.existsSync(rowsPath) ? JSON.parse(fs.readFileSync(rowsPath, 'utf8')) : []);
    fs.writeFileSync(zipPath, 'not really a zip');
    cb(null, { stdout: '', stderr: '' });
  },
}));

import { createBackup } from '@/lib/backup/backup-service';
import { restore } from '@/lib/backup/restore/restore';
import { remapBackupData } from '@/lib/backup/restore/uuid-remap';
import { UuidRemapper } from '@/lib/backup/uuid-remapper';
import { parseBackupZip } from '@/lib/backup/restore/archive';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import type { BackupData } from '@/lib/backup/types';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const CHARACTER_ID = '22222222-2222-4222-8222-222222222222';
const STRANGER_ID = '33333333-3333-4333-8333-333333333333';
const IMAGE_ID = '44444444-4444-4444-8444-444444444444';

const BASELINE_ROW = {
  id: '55555555-5555-4555-8555-555555555555',
  chatId: CHAT_ID,
  characterId: CHARACTER_ID,
  imageId: null,
  effectiveAt: '1970-01-01T00:00:00.000Z',
  source: 'baseline',
  createdAt: '2026-11-01T10:00:00.000Z',
};

const GENERATED_ROW = {
  id: '66666666-6666-4666-8666-666666666666',
  chatId: CHAT_ID,
  characterId: CHARACTER_ID,
  imageId: IMAGE_ID,
  effectiveAt: '2026-11-01T10:00:00.000Z',
  source: 'generated',
  createdAt: '2026-11-01T10:00:00.000Z',
};

/** A row for a character the backup does not carry. */
const STRANGER_ROW = {
  ...GENERATED_ROW,
  id: '77777777-7777-4777-8777-777777777777',
  characterId: STRANGER_ID,
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

describe('createBackup — avatar timeline', () => {
  const testUserId = 'user-avatar-timeline-backup';
  let findAllTimeline: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    stagedFilesByRun.length = 0;
    stagedRowsByRun.length = 0;

    findAllTimeline = jest.fn().mockResolvedValue([BASELINE_ROW, GENERATED_ROW]);

    const userRepos = repoStub({
      characters: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
      chats: methodStub({
        findAll: jest.fn().mockResolvedValue([{ id: CHAT_ID, title: 'The Portrait Gallery' }]),
        getMessages: jest.fn().mockResolvedValue([]),
      }),
      llmLogs: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
    });
    const globalRepos = repoStub({
      chatSettings: methodStub({ findByUserId: jest.fn().mockResolvedValue(null) }),
      avatarTimeline: methodStub({ findAll: findAllTimeline }),
      textReplacementRules: methodStub({ list: jest.fn().mockResolvedValue([]) }),
    });

    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);
  });

  async function runBackup() {
    const { zipPath, manifest } = await createBackup(testUserId);
    const staged = stagedFilesByRun[stagedFilesByRun.length - 1];
    const rows = stagedRowsByRun[stagedRowsByRun.length - 1] as Array<Record<string, unknown>>;
    await fs.promises.rm(path.dirname(zipPath), { recursive: true, force: true });
    return { manifest, staged, rows };
  }

  it('writes every row, baselines included, to data/avatar-timeline.json', async () => {
    const { staged, rows } = await runBackup();

    expect(findAllTimeline).toHaveBeenCalled();
    expect(staged).toContain('avatar-timeline.json');
    expect(rows).toEqual([BASELINE_ROW, GENERATED_ROW]);
  });

  it('reports the count in the manifest', async () => {
    const { manifest } = await runBackup();
    expect(manifest.counts.avatarTimeline).toBe(2);
  });
});

describe('restore — avatar timeline', () => {
  const testUserId = 'user-avatar-timeline-restore';
  let upsertRows: jest.Mock;

  const EMPTY_COLLECTIONS = [
    'characters', 'tags', 'connectionProfiles', 'imageProfiles', 'embeddingProfiles',
    'files', 'promptTemplates', 'roleplayTemplates', 'providerModels', 'projects',
    'groups', 'llmLogs', 'pluginConfigs', 'folders', 'wardrobeItems',
    'characterPluginData', 'conversationAnnotations', 'chatDocuments',
    'instanceSettings', 'embeddingStatus', 'conversationChunks', 'tfidfVocabularies',
    'textReplacementRules', 'docMountPoints', 'docMountFiles',
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

    upsertRows = jest.fn(async (rows: unknown[]) => rows.length);

    (getUserRepositories as jest.Mock).mockReturnValue(repoStub({}));
    (getRepositories as jest.Mock).mockReturnValue(
      repoStub({ avatarTimeline: methodStub({ upsertRows }) })
    );
  });

  function primeArchive(data: Record<string, unknown>) {
    (parseBackupZip as jest.Mock).mockResolvedValue({
      data,
      extractDir: '/tmp/qt-avatar-timeline-test-extract',
      rootFolder: '',
    });
  }

  async function runRestore(data: Record<string, unknown>) {
    primeArchive(makeBackupData(data));
    return restore(testUserId, '/tmp/qt-avatar-timeline-test.zip', {
      mode: 'replace',
      preserveIds: true,
    } as never);
  }

  it('hands every row to upsertRows exactly as archived', async () => {
    const result = await runRestore({ avatarTimeline: [BASELINE_ROW, GENERATED_ROW] });

    expect(upsertRows).toHaveBeenCalledTimes(1);
    expect(upsertRows.mock.calls[0][0]).toEqual([BASELINE_ROW, GENERATED_ROW]);
    expect(result.avatarTimeline).toBe(2);
  });

  it('reports zero — and writes nothing — for a pre-4.13 archive with no file', async () => {
    const result = await runRestore({});

    expect(upsertRows).not.toHaveBeenCalled();
    expect(result.avatarTimeline).toBe(0);
  });
});

describe('remapBackupData — avatar timeline in a new-account restore', () => {
  function backup(): BackupData {
    return {
      manifest: {} as BackupData['manifest'],
      characters: [{ id: CHARACTER_ID, name: 'Vivienne' }] as unknown as BackupData['characters'],
      chats: [
        {
          id: CHAT_ID,
          title: 'The Portrait Gallery',
          participants: [{ id: 'seat-old', type: 'CHARACTER', characterId: CHARACTER_ID }],
          messages: [],
        },
      ] as unknown as BackupData['chats'],
      tags: [],
      connectionProfiles: [],
      imageProfiles: [],
      embeddingProfiles: [],
      memories: [],
      files: [],
      promptTemplates: [],
      roleplayTemplates: [],
      providerModels: [],
      projects: [],
      llmLogs: [],
      // The picture's vault link travels in the backup, so its id is issued.
      docMountFileLinks: [{ id: IMAGE_ID, mountPointId: 'vault', fileId: 'f', relativePath: 'images/a.webp' }],
      docMountPoints: [{ id: 'vault', name: 'Vault' }],
      docMountFiles: [{ id: 'f' }],
      avatarTimeline: [BASELINE_ROW, GENERATED_ROW, STRANGER_ROW],
    } as unknown as BackupData;
  }

  it('renames each row with its chat and character, and follows imageId through the same remap', () => {
    const remapper = new UuidRemapper();
    const result = remapBackupData(backup(), 'target-user', remapper);
    const mapping = remapper.getMapping();
    const rows = result.avatarTimeline ?? [];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.chatId).toBe(mapping[CHAT_ID]);
      expect(row.characterId).toBe(mapping[CHARACTER_ID]);
      expect(row.chatId).toBe(result.chats[0].id);
      expect(row.characterId).toBe(result.chats[0].participants[0].characterId);
    }
    expect(rows.map((r) => r.id)).toEqual([mapping[BASELINE_ROW.id], mapping[GENERATED_ROW.id]]);
    expect(rows[1].imageId).toBe(mapping[IMAGE_ID]);
    expect(rows[1].imageId).not.toBe(IMAGE_ID);
  });

  it("keeps a null imageId (the character's own avatar) null", () => {
    const result = remapBackupData(backup(), 'target-user', new UuidRemapper());
    expect(result.avatarTimeline?.[0].imageId).toBeNull();
  });

  it('keeps dates and source as they were', () => {
    const result = remapBackupData(backup(), 'target-user', new UuidRemapper());
    expect(result.avatarTimeline?.[1]).toMatchObject({
      effectiveAt: GENERATED_ROW.effectiveAt,
      source: 'generated',
      createdAt: GENERATED_ROW.createdAt,
    });
  });

  it('drops a row for a character the backup does not carry', () => {
    const result = remapBackupData(backup(), 'target-user', new UuidRemapper());
    expect(result.avatarTimeline?.some((r) => r.id === STRANGER_ROW.id)).toBe(false);
    expect(result.avatarTimeline).toHaveLength(2);
  });
});
