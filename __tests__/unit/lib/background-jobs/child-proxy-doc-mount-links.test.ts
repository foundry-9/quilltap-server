/**
 * Child-proxy classification for the doc-mount file-link content writers.
 *
 * Regression coverage for the gap where `linkDocumentContent`, `linkBlobContent`,
 * and `linkFilesystemFile` were all 'unknown', so the child proxy threw
 * "not classified for child execution" the moment a `doc_write_file` /
 * `doc_copy_file` landed in a database-backed store during an
 * AUTONOMOUS_ROOM_TURN.
 *
 * The fix:
 *   - `linkDocumentContent` / `linkBlobContent` are buffered writes. Their
 *     in-child callers (database-store.writeDatabaseDocument, file-ops.writeDestBytes)
 *     discard the return value, so the `undefined` synthetic result is fine and
 *     the parent applies the real INSERT on its RW connection.
 *   - `linkFilesystemFile` is deliberately NOT a buffered write — it returns ids
 *     that callers consume to insert chunk rows, which a buffered write can't
 *     supply. It throws a tailored, caught-able error instead.
 *
 * These tests need no database — they exercise the proxy and the database-store
 * handler path against plain-object repository stand-ins.
 */

// Real-repo source the proxy wraps.
jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

// ---- deps pulled in by the database-store handler-path test ----------------
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));
jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
  emitDocumentMoved: jest.fn(),
}));
jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-id'),
}));
// In the child runtime `@/lib/repositories/factory` returns the child proxy;
// database-store.ts reads `getRepositories` from there, so mirror that wiring.
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () =>
    require('@/lib/background-jobs/child/child-repositories-proxy').getChildRepositoriesProxy(),
}));

import { getRepositories as mockedRealRepositories } from '@/lib/database/repositories';
import {
  runWithJobScope,
  flushPendingWrites,
  getChildRepositoriesProxy,
  __resetProxyCacheForTesting,
} from '@/lib/background-jobs/child/child-repositories-proxy';
import { classifyWriteTarget } from '@/lib/background-jobs/host/write-partition';

const mockedRepoSource = mockedRealRepositories as jest.MockedFunction<typeof mockedRealRepositories>;

beforeEach(() => {
  jest.clearAllMocks();
  __resetProxyCacheForTesting();
});

function makeFakeRepos() {
  return {
    docMountFileLinks: {
      // reads — pass through to the readonly connection
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      findByMountPointId: jest.fn().mockResolvedValue([]),
      // content writers under test. The real impls return rich objects; the
      // proxy should NEVER call these in the child (buffered or thrown), so the
      // resolved values here only exist to prove they go untouched.
      linkDocumentContent: jest.fn().mockResolvedValue({
        link: { id: 'real-link' }, file: { id: 'real-file' }, documentId: 'real-doc',
      }),
      linkBlobContent: jest.fn().mockResolvedValue({
        link: { id: 'real-link' }, file: { id: 'real-file' }, blobId: 'real-blob',
      }),
      linkFilesystemFile: jest.fn().mockResolvedValue({ id: 'real-link' }),
    },
    docMountDocuments: {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    },
  };
}

type FakeLinks = ReturnType<typeof makeFakeRepos>['docMountFileLinks'];

describe('child proxy — doc-mount file-link content writers', () => {
  it('buffers linkDocumentContent as a write and never runs it on the readonly child', async () => {
    const repos = makeFakeRepos();
    mockedRepoSource.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const writes = await runWithJobScope('job-doc', async () => {
      const result = await (proxied.docMountFileLinks as unknown as FakeLinks).linkDocumentContent({
        mountPointId: 'mp-1',
        relativePath: 'a.md',
        fileName: 'a.md',
        folderId: null,
        fileType: 'markdown',
        content: 'x',
        contentSha256: 'sha',
        plainTextLength: 1,
        fileSizeBytes: 1,
      } as never);
      // Discard-return callers (writeDatabaseDocument / file-ops) see the
      // synthetic `undefined` — syntheticWriteResult only shapes create*/upsert*.
      expect(result).toBeUndefined();
      return flushPendingWrites();
    });

    // Buffered, not executed against the readonly DB.
    expect(repos.docMountFileLinks.linkDocumentContent).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('docMountFileLinks.linkDocumentContent');
    expect(writes[0].args[0]).toEqual(
      expect.objectContaining({ mountPointId: 'mp-1', relativePath: 'a.md', content: 'x' }),
    );
  });

  it('buffers linkBlobContent as a write and leaves the Buffer payload intact for IPC', async () => {
    const repos = makeFakeRepos();
    mockedRepoSource.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    const data = Buffer.from([1, 2, 3, 4]);
    const writes = await runWithJobScope('job-blob', async () => {
      const result = await (proxied.docMountFileLinks as unknown as FakeLinks).linkBlobContent({
        mountPointId: 'mp-1',
        relativePath: 'images/x.webp',
        fileName: 'x.webp',
        folderId: 'folder-id',
        sha256: 'sha',
        data,
      } as never);
      expect(result).toBeUndefined();
      return flushPendingWrites();
    });

    expect(repos.docMountFileLinks.linkBlobContent).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('docMountFileLinks.linkBlobContent');
    // sanitizeForIpc only down-converts Float32Array; Buffers survive verbatim.
    const payload = writes[0].args[0] as { data: unknown };
    expect(Buffer.isBuffer(payload.data)).toBe(true);
    expect(payload.data).toBe(data);
  });

  it('routes the buffered link writes to the mount-index partition (not main)', () => {
    expect(classifyWriteTarget('docMountFileLinks.linkDocumentContent')).toBe('mountIndex');
    expect(classifyWriteTarget('docMountFileLinks.linkBlobContent')).toBe('mountIndex');
  });

  it('throws a tailored, caught-able error for linkFilesystemFile and buffers nothing', async () => {
    const repos = makeFakeRepos();
    mockedRepoSource.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    await runWithJobScope('job-fs', async () => {
      const fn = (proxied.docMountFileLinks as unknown as FakeLinks).linkFilesystemFile;
      // Distinct from the generic "not classified" hint — names why it's unsafe.
      expect(() => fn({ mountPointId: 'mp-1', relativePath: 'a.md' } as never))
        .toThrow(/cannot run in the job child/);
      expect(() => fn({} as never)).toThrow(/chunk|host-RPC|processMountFile/);
      // Not the generic message that would invite a naive 'write' override.
      expect(() => fn({} as never)).not.toThrow(/Add it to METHOD_OVERRIDES/);
      // Nothing was buffered — the throw beats appendWrite.
      expect(flushPendingWrites()).toEqual([]);
    });

    expect(repos.docMountFileLinks.linkFilesystemFile).not.toHaveBeenCalled();
  });

  it('documents the host-RPC follow-up: a consume-return caller fails loudly, not silently', async () => {
    // Mirrors writeCharacterAvatarToVault / writeLanternBackgroundToMountStore,
    // which do `const { blobId } = await linkBlobContent(...)`. Buffering returns
    // `undefined`, so the destructure throws — the handler fails (job FAILED,
    // buffered writes discarded) rather than persisting a bogus storageKey.
    const repos = makeFakeRepos();
    mockedRepoSource.mockReturnValue(repos as never);
    const proxied = getChildRepositoriesProxy();

    await runWithJobScope('job-consume', async () => {
      await expect(
        (async () => {
          const { blobId } = (await (proxied.docMountFileLinks as unknown as FakeLinks).linkBlobContent({
            mountPointId: 'mp-1',
            relativePath: 'images/x.webp',
            data: Buffer.from([1]),
          } as never)) as unknown as { blobId: string };
          return blobId;
        })(),
      ).rejects.toThrow(/Cannot destructure|undefined/i);
    });
  });
});

describe('handler path — writeDatabaseDocument (autonomous-turn doc_write_file)', () => {
  it('buffers a docMountFileLinks.linkDocumentContent write instead of throwing', async () => {
    const repos = makeFakeRepos();
    mockedRepoSource.mockReturnValue(repos as never);

    // Imported lazily so the factory/proxy mocks are wired first.
    const { writeDatabaseDocument } = require('@/lib/mount-index/database-store') as
      typeof import('@/lib/mount-index/database-store');

    const writes = await runWithJobScope('job-write-db-doc', async () => {
      const { mtime } = await writeDatabaseDocument('mp-1', 'notes.md', '# hello');
      expect(typeof mtime).toBe('number');
      return flushPendingWrites();
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('docMountFileLinks.linkDocumentContent');
    expect(writes[0].args[0]).toEqual(
      expect.objectContaining({
        mountPointId: 'mp-1',
        relativePath: 'notes.md',
        fileName: 'notes.md',
        fileType: 'markdown',
        content: '# hello',
      }),
    );
    // The content writer was buffered, never executed on the readonly child.
    expect(repos.docMountFileLinks.linkDocumentContent).not.toHaveBeenCalled();
  });
});
