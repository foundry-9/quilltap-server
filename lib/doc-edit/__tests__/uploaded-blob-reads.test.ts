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
import { handleGrep, handleListFiles, handleReadFile, handleStrReplace } from '@/lib/tools/handlers/doc-edit/text-handlers';
import { handleReadHeading } from '@/lib/tools/handlers/doc-edit/markdown-handlers';
import { handleOpenDocument } from '@/lib/tools/handlers/doc-edit/document-ui-handlers';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import {
  listDatabaseFiles,
  listDatabaseBlobTexts,
  readDatabaseBlobForDocument,
  readDatabaseDocument,
  writeDatabaseDocument,
  databaseDocumentExists,
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
    readDatabaseBlobForDocument: jest.fn(),
    readDatabaseDocument: jest.fn(),
    writeDatabaseDocument: jest.fn(),
    databaseDocumentExists: jest.fn(),
    databaseFolderExists: jest.fn(),
  };
});

// Writes are what is under test, not their background refresh or announcement.
jest.mock('@/lib/doc-edit/reindex-file', () => ({
  reindexSingleFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/mount-index/embedding-scheduler', () => ({
  enqueueEmbeddingJobsForMountPoint: jest.fn(),
}));
jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianWriteAnnouncement: jest.fn(),
  postLibrarianOpenAnnouncement: jest.fn(),
  contentHiddenFromCharacters: jest.fn(() => false),
  documentHiddenFromCharacters: jest.fn(async () => false),
  toLibrarianOpenKind: jest.fn((origin: unknown) => origin),
}));

const mockOpenChatDocument = jest.fn();

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
  // An uploaded .md reads as its own bytes, the same reader the editor uses (#134).
  jest.mocked(readDatabaseBlobForDocument).mockImplementation(async (_mp: string, rel: string) =>
    rel.toLowerCase() === 'changelog.md'
      ? { content: CHANGELOG, mtime: 1792771329442, size: CHANGELOG.length, source: 'blob-bytes' as const }
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
    chatDocuments: { openDocument: mockOpenChatDocument },
    chats: {
      update: jest.fn(),
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
    expect(readDatabaseBlobForDocument).toHaveBeenCalledWith(PROJECT_STORE.id, 'CHANGELOG.md');
  });

  it('still reports a missing file when there is no blob either', async () => {
    await expect(
      handleReadFile({ uri: 'qtap://project/MISSING.md' } as never, toolContext),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('doc_str_replace edits an uploaded text blob (#134)', () => {
  it('reads the upload through the same reader and writes a document over it', async () => {
    jest.mocked(writeDatabaseDocument).mockResolvedValue({ mtime: 1792771329999 } as never);

    const res = await handleStrReplace(
      { uri: 'qtap://project/CHANGELOG.md', find: 'drag ordering', replace: 'keyboard ordering' } as never,
      toolContext,
    );

    expect(res.success).toBe(true);
    expect(readDatabaseBlobForDocument).toHaveBeenCalledWith(PROJECT_STORE.id, 'CHANGELOG.md');
    expect(writeDatabaseDocument).toHaveBeenCalledWith(
      PROJECT_STORE.id,
      'CHANGELOG.md',
      CHANGELOG.replace('drag ordering', 'keyboard ordering'),
      undefined,
    );
  });
});

describe('the markdown tools read an uploaded text blob (#134)', () => {
  it('doc_read_heading finds a heading in an upload', async () => {
    const res = await handleReadHeading(
      { uri: 'qtap://project/CHANGELOG.md', heading: '4.11-dev' } as never,
      toolContext,
    );

    expect(res.success).toBe(true);
    expect(JSON.stringify(res.result)).toContain('drag ordering');
  });
});

describe('doc_open_document (#134)', () => {
  it('opens an uploaded text file, as Document Mode does', async () => {
    const res = await handleOpenDocument({ uri: 'qtap://project/CHANGELOG.md' } as never, toolContext);

    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ filePath: 'CHANGELOG.md', isNew: false, mtime: 1792771329442 });
    expect(mockOpenChatDocument).toHaveBeenCalled();
  });

  it('still refuses a file that is not there', async () => {
    const res = await handleOpenDocument({ uri: 'qtap://project/MISSING.md' } as never, toolContext);

    expect(res.success).toBe(false);
    expect(res.error).toBe('File not found: MISSING.md');
  });

  it('creates a blank document through the store writer, never raw fs', async () => {
    jest.mocked(databaseDocumentExists).mockResolvedValue(false);
    jest.mocked(writeDatabaseDocument).mockResolvedValue({ mtime: 1792771330000 } as never);

    const res = await handleOpenDocument({} as never, toolContext);

    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ isNew: true, mtime: 1792771330000 });
    expect(writeDatabaseDocument).toHaveBeenCalledWith(
      PROJECT_STORE.id,
      expect.stringMatching(/^[0-9a-f-]+\.md$/),
      '',
      undefined,
    );
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
