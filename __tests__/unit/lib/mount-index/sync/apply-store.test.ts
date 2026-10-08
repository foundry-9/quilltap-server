import {
  StoreRaceError,
  writeStoreFile,
  readStoreBytes,
  applyStoreAction,
} from '@/lib/mount-index/sync/apply-store';
import { sha256OfString, sha256OfBuffer } from '@/lib/utils/sha256';
import type { SyncAction } from '@/lib/mount-index/sync/types';

jest.mock('@/lib/repositories/factory');
jest.mock('@/lib/mount-index/folder-paths', () => ({ ensureFolderPath: jest.fn() }));
jest.mock('@/lib/mount-index/database-store', () => ({ deleteDatabaseFolder: jest.fn() }));
jest.mock('@/lib/mount-index/post-write-reindex', () => ({ reindexAfterDatabaseWrite: jest.fn() }));
jest.mock('@/lib/mount-index/db-store-events', () => ({ emitDocumentWritten: jest.fn() }));

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const ensureFolderPath = jest.requireMock('@/lib/mount-index/folder-paths').ensureFolderPath as jest.Mock;
const deleteDatabaseFolder = jest.requireMock('@/lib/mount-index/database-store').deleteDatabaseFolder as jest.Mock;
const reindex = jest.requireMock('@/lib/mount-index/post-write-reindex').reindexAfterDatabaseWrite as jest.Mock;
const emitWritten = jest.requireMock('@/lib/mount-index/db-store-events').emitDocumentWritten as jest.Mock;

const MP = 'mp-1';

describe('apply-store', () => {
  let links: Record<string, jest.Mock>;
  let docs: Record<string, jest.Mock>;
  let blobs: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();
    links = {
      findByMountPointAndPath: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      linkDocumentContent: jest.fn().mockResolvedValue(undefined),
      linkBlobContent: jest.fn().mockResolvedValue(undefined),
      setLinkTimestamps: jest.fn().mockResolvedValue(undefined),
      deleteWithGC: jest.fn().mockResolvedValue(undefined),
    };
    docs = { findByFileId: jest.fn().mockResolvedValue(null) };
    blobs = {
      readDataByFileId: jest.fn().mockResolvedValue(null),
      findByFileId: jest.fn(),
      updateDescription: jest.fn().mockResolvedValue(undefined),
    };
    ensureFolderPath.mockResolvedValue('folder-id');
    getRepositoriesMock.mockReturnValue({
      docMountFileLinks: links,
      docMountDocuments: docs,
      docMountBlobs: blobs,
    });
  });

  describe('StoreRaceError', () => {
    it('names the path and truncates both shas', () => {
      const err = new StoreRaceError('a.md', 'a'.repeat(64), undefined);
      expect(err.name).toBe('StoreRaceError');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('a.md changed in the store');
      expect(err.message).toContain(`expected sha ${'a'.repeat(12)}…`);
      expect(err.message).toContain('found none…');
    });
  });

  describe('writeStoreFile', () => {
    it('writes native text as a document, with folder ensured and reindex + event', async () => {
      const bytes = Buffer.from('héllo', 'utf-8');
      const sha = await writeStoreFile(MP, 'lore/a.md', bytes, {
        lastModified: '2026-01-01T00:00:00.000Z',
        createdAt: null,
      });

      expect(ensureFolderPath).toHaveBeenCalledWith(MP, 'lore');
      expect(sha).toBe(sha256OfString('héllo'));
      expect(links.linkDocumentContent).toHaveBeenCalledWith({
        mountPointId: MP,
        relativePath: 'lore/a.md',
        fileName: 'a.md',
        folderId: 'folder-id',
        fileType: 'markdown',
        content: 'héllo',
        contentSha256: sha,
        plainTextLength: 5,
        fileSizeBytes: bytes.length,
        lastModified: '2026-01-01T00:00:00.000Z',
        createdAt: undefined,
      });
      expect(links.linkBlobContent).not.toHaveBeenCalled();
      expect(reindex).toHaveBeenCalledWith(MP, 'lore/a.md');
      expect(emitWritten).toHaveBeenCalledWith({ mountPointId: MP, relativePath: 'lore/a.md' });
    });

    it('does not ensure a folder for a root-level file and passes createdAt through', async () => {
      await writeStoreFile(MP, 'root.txt', Buffer.from('x'), { createdAt: '2025-05-05T00:00:00.000Z' });
      expect(ensureFolderPath).not.toHaveBeenCalled();
      expect(links.linkDocumentContent).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: null, fileType: 'txt', createdAt: '2025-05-05T00:00:00.000Z' })
      );
    });

    it('writes a bitmap verbatim as a blob (no transcoding), skips reindex, and returns the stored sha', async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      links.findByMountPointAndPath.mockResolvedValue({ sha256: 'stored-sha' });

      const sha = await writeStoreFile(MP, 'img/pic.PNG', bytes, {});

      expect(sha).toBe('stored-sha');
      const arg = links.linkBlobContent.mock.calls[0][0];
      expect(arg).toMatchObject({
        mountPointId: MP,
        relativePath: 'img/pic.PNG',
        fileName: 'pic.PNG',
        fileType: 'blob',
        originalFileName: 'pic.PNG',
        sha256: sha256OfBuffer(bytes),
        data: bytes,
      });
      expect(arg.originalMimeType).toBe(arg.storedMimeType);
      expect(arg).not.toHaveProperty('description');
      expect(links.linkDocumentContent).not.toHaveBeenCalled();
      expect(reindex).not.toHaveBeenCalled();
      expect(emitWritten).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['doc.pdf', 'pdf'],
      ['doc.docx', 'docx'],
    ])('treats %s as %s and reindexes it', async (file, type) => {
      await writeStoreFile(MP, file, Buffer.from('bin'), {});
      expect(links.linkBlobContent).toHaveBeenCalledWith(expect.objectContaining({ fileType: type }));
      expect(reindex).toHaveBeenCalledWith(MP, file);
    });

    it('returns an empty string when the written link cannot be re-read', async () => {
      links.findByMountPointAndPath.mockResolvedValue(null);
      expect(await writeStoreFile(MP, 'a.bin', Buffer.from('x'), {})).toBe('');
    });
  });

  describe('readStoreBytes', () => {
    it('returns null when there is no link', async () => {
      expect(await readStoreBytes(MP, 'a.md')).toBeNull();
      expect(docs.findByFileId).not.toHaveBeenCalled();
    });

    it('returns document text as UTF-8 bytes', async () => {
      links.findByMountPointAndPath.mockResolvedValue({ fileId: 'f1' });
      docs.findByFileId.mockResolvedValue({ content: 'héllo' });
      const bytes = await readStoreBytes(MP, 'a.md');
      expect(bytes!.toString('utf-8')).toBe('héllo');
      expect(docs.findByFileId).toHaveBeenCalledWith('f1');
    });

    it('falls back to the blob data', async () => {
      links.findByMountPointAndPath.mockResolvedValue({ fileId: 'f2' });
      const data = Buffer.from([1, 2, 3]);
      blobs.readDataByFileId.mockResolvedValue(data);
      expect(await readStoreBytes(MP, 'a.png')).toBe(data);
    });

    it('returns null when neither a document nor blob data exists', async () => {
      links.findByMountPointAndPath.mockResolvedValue({ fileId: 'f3' });
      blobs.readDataByFileId.mockResolvedValue(undefined);
      expect(await readStoreBytes(MP, 'a.png')).toBeNull();
    });
  });

  describe('applyStoreAction', () => {
    const act = (over: Partial<SyncAction>): SyncAction => ({
      kind: 'create', side: 'store', relativePath: 'a.md', entryKind: 'file', ...over,
    });

    it('mkdir ensures the folder path', async () => {
      await applyStoreAction(MP, act({ kind: 'mkdir', relativePath: 'x/y', entryKind: 'folder' }), null);
      expect(ensureFolderPath).toHaveBeenCalledWith(MP, 'x/y');
    });

    it('create/modify without bytes throws', async () => {
      await expect(applyStoreAction(MP, act({}), null)).rejects.toThrow('No bytes supplied for create a.md');
      await expect(applyStoreAction(MP, act({ kind: 'modify' }), null)).rejects.toThrow(/modify a\.md/);
    });

    it('create succeeds when nothing is at the path and nothing was expected', async () => {
      await applyStoreAction(MP, act({ lastModified: 'LM', createdAt: 'CA' }), Buffer.from('hi'));
      expect(links.linkDocumentContent).toHaveBeenCalledWith(
        expect.objectContaining({ relativePath: 'a.md', lastModified: 'LM', createdAt: 'CA' })
      );
    });

    it('create raises StoreRaceError when something appeared at the path', async () => {
      links.findByMountPointAndPath.mockResolvedValue({ sha256: 'surprise' });
      await expect(applyStoreAction(MP, act({}), Buffer.from('hi'))).rejects.toBeInstanceOf(StoreRaceError);
      expect(links.linkDocumentContent).not.toHaveBeenCalled();
    });

    it('modify succeeds when the sha matches the planner’s expectation', async () => {
      links.findByMountPointAndPath.mockResolvedValue({ sha256: 'same' });
      await applyStoreAction(MP, act({ kind: 'modify', expectedStoreSha256: 'same' }), Buffer.from('new'));
      expect(links.linkDocumentContent).toHaveBeenCalledTimes(1);
    });

    it('modify raises StoreRaceError when the sha changed, or the file vanished', async () => {
      links.findByMountPointAndPath.mockResolvedValue({ sha256: 'other' });
      await expect(
        applyStoreAction(MP, act({ kind: 'modify', expectedStoreSha256: 'same' }), Buffer.from('new'))
      ).rejects.toThrow(/changed in the store/);

      links.findByMountPointAndPath.mockResolvedValue(null);
      await expect(
        applyStoreAction(MP, act({ kind: 'modify', expectedStoreSha256: 'same' }), Buffer.from('new'))
      ).rejects.toBeInstanceOf(StoreRaceError);
      expect(links.linkDocumentContent).not.toHaveBeenCalled();
    });

    it('touch sets timestamps, mapping null createdAt to undefined', async () => {
      await applyStoreAction(MP, act({ kind: 'touch', linkId: 'l1', lastModified: 'LM', createdAt: null }), null);
      expect(links.setLinkTimestamps).toHaveBeenCalledWith('l1', { lastModified: 'LM', createdAt: undefined });
    });

    it('touch without a linkId throws', async () => {
      await expect(applyStoreAction(MP, act({ kind: 'touch' }), null)).rejects.toThrow('No link to touch at a.md');
    });

    it('describe by linkId writes the caption with the three-arg form', async () => {
      links.findById.mockResolvedValue({ id: 'l1', fileId: 'f1' });
      blobs.findByFileId.mockResolvedValue({ id: 'blob-1' });
      await applyStoreAction(MP, act({ kind: 'describe', linkId: 'l1', description: 'cap' }), null);
      expect(blobs.updateDescription).toHaveBeenCalledWith('blob-1', 'cap', 'l1');
    });

    it('describe without linkId resolves by path and clears on undefined description', async () => {
      links.findByMountPointAndPath.mockResolvedValue({ id: 'l9', fileId: 'f9' });
      blobs.findByFileId.mockResolvedValue({ id: 'blob-9' });
      await applyStoreAction(MP, act({ kind: 'describe' }), null);
      expect(links.findById).not.toHaveBeenCalled();
      expect(blobs.updateDescription).toHaveBeenCalledWith('blob-9', '', 'l9');
    });

    it('describe throws when the link or the blob row is missing', async () => {
      await expect(applyStoreAction(MP, act({ kind: 'describe' }), null)).rejects.toThrow('No link to describe at a.md');

      links.findByMountPointAndPath.mockResolvedValue({ id: 'l9', fileId: 'f9' });
      blobs.findByFileId.mockResolvedValue(null);
      await expect(applyStoreAction(MP, act({ kind: 'describe' }), null)).rejects.toThrow(/No blob row behind a\.md/);
      expect(blobs.updateDescription).not.toHaveBeenCalled();
    });

    it('delete garbage-collects the link; without a linkId it throws', async () => {
      await applyStoreAction(MP, act({ kind: 'delete', linkId: 'l1' }), null);
      expect(links.deleteWithGC).toHaveBeenCalledWith('l1');
      await expect(applyStoreAction(MP, act({ kind: 'delete' }), null)).rejects.toThrow('No link to delete at a.md');
    });

    it('rmdir removes the database folder', async () => {
      await applyStoreAction(MP, act({ kind: 'rmdir', relativePath: 'old', entryKind: 'folder' }), null);
      expect(deleteDatabaseFolder).toHaveBeenCalledWith(MP, 'old');
    });

    it('ignores kinds with no store-side behaviour', async () => {
      await applyStoreAction(MP, act({ kind: 'skip', side: null }), null);
      await applyStoreAction(MP, act({ kind: 'conflict', side: null }), null);
      expect(links.linkDocumentContent).not.toHaveBeenCalled();
      expect(links.deleteWithGC).not.toHaveBeenCalled();
    });
  });
});
