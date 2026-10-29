/**
 * Bugs 260 and 261 — a chat upload in the project store, invisible to the
 * doc tools.
 *
 * On `Friday` the operator uploaded `CHANGELOG.md` into a project chat. It
 * landed at the root of the project's official store, but as a blob (every
 * upload is, so its `files` row can address it by `mount-blob:` key), and:
 *
 *  - `doc_read_file qtap://project/CHANGELOG.md` read only `doc_mount_documents`
 *    and answered ENOENT (bug 260);
 *  - `doc_grep` searched only documents, so the text was unfindable (bug 260);
 *  - `doc_list_files` with `pattern: "**\/CHANGELOG.md"` matched nothing,
 *    because its matcher knew only `*.ext` and an exact name (bug 261).
 *
 * Built like `path-resolver-opacity-enumeration.test.ts`: the REAL path
 * resolver and handlers, mocking only the repositories, the instance-settings
 * singleton and the database-store reader.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { handleGrep, handleListFiles, handleReadFile } from '@/lib/tools/handlers/doc-edit/text-handlers';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  listDatabaseFiles,
  listDatabaseBlobTexts,
  readDatabaseBlobText,
  readDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}));

jest.mock('@/lib/mount-index/database-store', () => {
  class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  }
  return {
    DatabaseStoreError,
    listDatabaseFiles: jest.fn(),
    listDatabaseBlobTexts: jest.fn(),
    readDatabaseBlobText: jest.fn(),
    readDatabaseDocument: jest.fn(),
  };
});

const ACTING = 'char-friday';

const PROJECT_STORE = {
  id: 'mp-project',
  name: 'Project Files: Quilltap Plans',
  enabled: true,
  mountType: 'database',
  storeType: 'documents',
  basePath: '',
};

const CHANGELOG = '# Quilltap Changelog\n\n## Recent Changes\n\n### 4.11-dev\n\n- Storyteller board got drag ordering.';

function mockWorld() {
  jest.mocked(getGeneralMountPointId).mockResolvedValue(null);
  jest.mocked(listDatabaseFiles).mockResolvedValue([
    { relativePath: 'CHANGELOG.md', fileName: 'CHANGELOG.md', kind: 'file', fileSizeBytes: CHANGELOG.length, lastModified: '2026-10-23T16:02:09.442Z', mountPointId: PROJECT_STORE.id },
    { relativePath: 'custom-tools', fileName: 'custom-tools', kind: 'folder', fileSizeBytes: 0, lastModified: '2026-10-19T00:00:00.000Z', mountPointId: PROJECT_STORE.id },
    { relativePath: 'custom-tools/gnomon-record-NOTES.md', fileName: 'gnomon-record-NOTES.md', kind: 'file', fileSizeBytes: 10, lastModified: '2026-10-19T00:00:00.000Z', mountPointId: PROJECT_STORE.id },
    { relativePath: 'custom-tools/spec.json', fileName: 'spec.json', kind: 'file', fileSizeBytes: 10, lastModified: '2026-10-19T00:00:00.000Z', mountPointId: PROJECT_STORE.id },
  ] as never);
  // The upload is a blob: no document at its path, but converted text.
  jest.mocked(readDatabaseDocument).mockRejectedValue(new DatabaseStoreError('Document not found', 'NOT_FOUND'));
  jest.mocked(readDatabaseBlobText).mockImplementation(async (_mp: string, rel: string) =>
    rel.toLowerCase() === 'changelog.md'
      ? { content: CHANGELOG, mtime: 1792771329442, size: CHANGELOG.length, storedMimeType: 'text/markdown' }
      : null,
  );
  jest.mocked(listDatabaseBlobTexts).mockResolvedValue([{ relativePath: 'CHANGELOG.md', content: CHANGELOG }]);

  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findById: jest.fn().mockResolvedValue({ id: ACTING, name: 'Friday', systemTransparency: true, characterDocumentMountPointId: null }),
      findByIdRaw: jest.fn().mockResolvedValue({ id: ACTING, characterDocumentMountPointId: null }),
    },
    groupCharacterMembers: { findByCharacterId: jest.fn().mockResolvedValue([]) },
    groups: { findByIdRaw: jest.fn().mockResolvedValue(null) },
    groupDocMountLinks: { findByGroupId: jest.fn().mockResolvedValue([]) },
    projectDocMountLinks: { findByProjectId: jest.fn().mockResolvedValue([{ mountPointId: PROJECT_STORE.id }]) },
    projects: {
      findById: jest.fn().mockResolvedValue({ id: 'proj-1', officialMountPointId: PROJECT_STORE.id }),
      canCharacterParticipate: jest.fn().mockResolvedValue(true),
    },
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => (id === PROJECT_STORE.id ? PROJECT_STORE : null)),
      findEnabled: jest.fn().mockResolvedValue([PROJECT_STORE]),
    },
    docMountFileLinks: {
      findByMountPointId: jest.fn().mockResolvedValue([]),
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
    docMountDocuments: { findByMountPointId: jest.fn().mockResolvedValue([]) },
    docMountBlobs: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      listByMountPoint: jest.fn().mockResolvedValue([]),
    },
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: 'chat-1',
        allowCrossCharacterVaultReads: false,
        participants: [{ characterId: ACTING, status: 'active' }],
      }),
    },
  } as never);
}

/** The doc-edit tool context the Salon builds for a character's own turn. */
const toolContext = { chatId: 'chat-1', userId: 'u1', projectId: 'proj-1', characterId: ACTING };

beforeEach(() => {
  jest.clearAllMocks();
  mockWorld();
});

describe('doc_read_file reads an uploaded text blob (bug 260)', () => {
  it('returns the upload where no document exists at the path', async () => {
    const res = await handleReadFile({ uri: 'qtap://project/CHANGELOG.md' } as never, toolContext);

    expect(res.success).toBe(true);
    expect(res.result?.content).toBe(CHANGELOG);
    expect(readDatabaseBlobText).toHaveBeenCalledWith(PROJECT_STORE.id, 'CHANGELOG.md');
  });

  it('still reports a missing file when there is no blob either', async () => {
    await expect(
      handleReadFile({ uri: 'qtap://project/MISSING.md' } as never, toolContext),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('doc_grep searches uploaded blobs (bug 260)', () => {
  it('finds text that lives only in an upload', async () => {
    const res = await handleGrep({ query: 'drag ordering' } as never, toolContext);

    expect(res.success).toBe(true);
    expect(res.result?.matches).toEqual([
      expect.objectContaining({ path: 'CHANGELOG.md', mount_point: PROJECT_STORE.name, line_number: 7 }),
    ]);
  });
});

describe('doc_list_files globs (bug 261)', () => {
  const listed = async (pattern: string) => {
    const res = await handleListFiles({ scope: 'project', pattern } as never, toolContext);
    expect(res.success).toBe(true);
    return (res.result?.files ?? []).map((f) => f.path);
  };

  it('`**/CHANGELOG.md` finds the file at the store root', async () => {
    expect(await listed('**/CHANGELOG.md')).toEqual(['CHANGELOG.md']);
  });

  it('a bare name or `*.ext` matches in any folder', async () => {
    expect(await listed('changelog.md')).toEqual(['CHANGELOG.md']);
    expect(await listed('*.md')).toEqual(['CHANGELOG.md', 'custom-tools/gnomon-record-NOTES.md']);
  });

  it('a path pattern and braces match as documented', async () => {
    expect(await listed('custom-tools/*.{md,json}')).toEqual([
      'custom-tools/gnomon-record-NOTES.md',
      'custom-tools/spec.json',
    ]);
  });
});
