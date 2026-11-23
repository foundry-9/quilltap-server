/**
 * doc_grep / doc_list_files on the operator surface (research kit §4).
 *
 * The Brahma Console and the builders run with `operatorOverride: true` and no
 * project or mount pool. Both tools used to refuse there ("requires a project
 * context") although the path resolver already admitted the override; these
 * hold the repair: with a `mount_point` and without one, an operator call
 * searches or lists, and with no `mount_point` it reaches every enabled store.
 *
 * Runs against the real path resolver and handlers with only the repositories,
 * the General mount and the database store mocked, as
 * `path-resolver.mountpool.test.ts` does.
 */

// ── Subject ──────────────────────────────────────────────────────────────────
import { handleGrep, handleListFiles } from '@/lib/tools/handlers/doc-edit/text-handlers';

// ── Mocks ────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import { listDatabaseFiles } from '@/lib/mount-index/database-store';

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  listDatabaseBlobTexts: jest.fn().mockResolvedValue([]),
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

const STORE_A = { id: 'mp-a', name: 'Estate Papers', enabled: true, mountType: 'database', storeType: 'documents', basePath: '' };
const STORE_B = { id: 'mp-b', name: 'Amy Character Vault', enabled: true, mountType: 'database', storeType: 'character', basePath: '' };
const ALL_STORES = [STORE_A, STORE_B];

const DOCUMENTS: Record<string, Array<{ relativePath: string; content: string }>> = {
  'mp-a': [{ relativePath: 'Staff/meetings.md', content: 'Formal staff meetings are held on Mondays.\nDress is formal.' }],
  'mp-b': [{ relativePath: 'Wardrobe/blazer.md', content: 'A navy blazer worn to formal staff meetings.' }],
};

function mockWorld() {
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null);
  jest.mocked(getRepositories).mockReturnValue({
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => ALL_STORES.find((s) => s.id === id) ?? null),
      findEnabled: jest.fn().mockResolvedValue(ALL_STORES),
    },
    docMountDocuments: {
      findByMountPointId: jest.fn().mockImplementation(async (id: string) => DOCUMENTS[id] ?? []),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue([]),
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
    chats: {
      findById: jest.fn().mockResolvedValue(null),
    },
  } as never);
}

const OPERATOR = { chatId: 'console-1', userId: 'u1', operatorOverride: true };

beforeEach(() => jest.clearAllMocks());

describe('doc_grep on the operator surface', () => {
  it('searches every enabled store when no mount_point is given', async () => {
    mockWorld();
    const result = await handleGrep({ query: 'formal staff meetings' } as never, OPERATOR);
    expect(result.success).toBe(true);
    const stores = new Set(result.result?.matches.map((m) => m.mount_point));
    expect(stores).toEqual(new Set([STORE_A.name, STORE_B.name]));
  });

  it('narrows to the named store when mount_point is given', async () => {
    mockWorld();
    const result = await handleGrep({ query: 'formal', mount_point: STORE_A.name } as never, OPERATOR);
    expect(result.success).toBe(true);
    expect(result.result?.matches.length).toBeGreaterThan(0);
    expect(result.result?.matches.every((m) => m.mount_point === STORE_A.name)).toBe(true);
  });

  it('still refuses a context with no project, no pool and no operator override', async () => {
    mockWorld();
    const result = await handleGrep({ query: 'formal' } as never, { chatId: 'c', userId: 'u1' });
    expect(result).toEqual({ success: false, error: 'Grep requires a project context' });
  });
});

describe('doc_list_files on the operator surface', () => {
  it('lists every enabled store when no mount_point is given', async () => {
    mockWorld();
    jest.mocked(listDatabaseFiles).mockImplementation(async (id: string) =>
      (DOCUMENTS[id] ?? []).map((d) => ({
        relativePath: d.relativePath,
        kind: 'file',
        fileSizeBytes: d.content.length,
        lastModified: '2026-11-18T00:00:00.000Z',
      })) as never,
    );
    const result = await handleListFiles({ scope: 'document_store' } as never, OPERATOR);
    expect(result.success).toBe(true);
    const stores = new Set(result.result?.files.map((f) => f.mount_point));
    expect(stores).toEqual(new Set([STORE_A.name, STORE_B.name]));
  });

  it('lists one store when mount_point is given', async () => {
    mockWorld();
    jest.mocked(listDatabaseFiles).mockResolvedValue([] as never);
    const result = await handleListFiles({ scope: 'document_store', mount_point: STORE_A.name } as never, OPERATOR);
    expect(result.success).toBe(true);
    expect(jest.mocked(listDatabaseFiles)).toHaveBeenCalledWith(STORE_A.id, {});
    expect(jest.mocked(listDatabaseFiles)).not.toHaveBeenCalledWith(STORE_B.id, expect.anything());
  });
});
