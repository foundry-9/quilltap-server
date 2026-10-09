/**
 * Tests for the wardrobe image bridge: the `Wardrobe/images/<itemId>/…webp`
 * path shape over `storeMountFile` (unique-suffix for a fresh picture, an
 * upsert at the exact leaf for a transfer), the job-child host-RPC shim, and
 * link deletion.
 *
 * `@/lib/repositories/factory` is mocked app-wide in jest.setup.ts and
 * configured per test here; `storeMountFile` and the store events are mocked
 * locally. `sanitizeLeafName` stays real (pure).
 */

jest.mock('@/lib/background-jobs/child/host-rpc-client', () => ({
  callHost: jest.fn(),
}));

jest.mock('@/lib/mount-index/store-file', () => ({
  storeMountFile: jest.fn(),
}));

jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
}));

import {
  deleteWardrobeItemImageLink,
  writeWardrobeItemImage,
  wardrobeItemImagePath,
} from '@/lib/file-storage/wardrobe-image-bridge';
import { getRepositories } from '@/lib/repositories/factory';
import { callHost } from '@/lib/background-jobs/child/host-rpc-client';
import { storeMountFile } from '@/lib/mount-index/store-file';
import { emitDocumentDeleted } from '@/lib/mount-index/db-store-events';

const mockGetRepositories = jest.mocked(getRepositories);
const mockStore = jest.mocked(storeMountFile);
const mockEmitDeleted = jest.mocked(emitDocumentDeleted);

const ORIGINAL_ENV = process.env.QUILLTAP_JOB_CHILD;
const ITEM_ID = '11111111-1111-4111-8111-111111111111';

let findByMountPointAndPath: jest.Mock;
let deleteWithGC: jest.Mock;
let refreshStats: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.QUILLTAP_JOB_CHILD;

  mockStore.mockImplementation(async (input) => ({
    mountPointId: input.mountPointId,
    relativePath: input.relativePath,
    kind: 'blob',
    fileType: 'blob',
    sha256: 'sha-abc',
    sizeBytes: input.data.length,
    storedMimeType: 'image/webp',
    mtime: 0,
    fileId: 'file-1',
    linkId: 'link-1',
    blobId: 'blob-1',
  }));
  findByMountPointAndPath = jest.fn();
  deleteWithGC = jest.fn().mockResolvedValue({ fileGC: true });
  refreshStats = jest.fn().mockResolvedValue(undefined);

  mockGetRepositories.mockReturnValue({
    docMountFileLinks: { findByMountPointAndPath, deleteWithGC },
    docMountPoints: { refreshStats },
  } as unknown as ReturnType<typeof getRepositories>);
});

afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.QUILLTAP_JOB_CHILD;
  else process.env.QUILLTAP_JOB_CHILD = ORIGINAL_ENV;
});

describe('writeWardrobeItemImage', () => {
  it('writes Wardrobe/images/<itemId>/<yyyymmdd-hhmmss>-<kind>.webp through storeMountFile, unique-suffix', async () => {
    const result = await writeWardrobeItemImage({
      mountPointId: 'vault-1',
      itemId: ITEM_ID,
      kind: 'generated',
      content: Buffer.from('webp-bytes'),
      contentType: 'image/webp',
      description: 'caption',
    });

    const pattern = new RegExp(`^Wardrobe/images/${ITEM_ID}/\\d{8}-\\d{6}-generated\\.webp$`);
    expect(result.relativePath).toMatch(pattern);
    expect(result.leafName).toMatch(/^\d{8}-\d{6}-generated\.webp$/);
    expect(mockStore).toHaveBeenCalledWith(expect.objectContaining({
      mountPointId: 'vault-1',
      relativePath: expect.stringMatching(pattern),
      originalMimeType: 'image/webp',
      description: 'caption',
      collisionStrategy: 'unique-suffix',
      assetStorage: 'database',
      treatNativeTextAsDocument: false,
      extractText: false,
      enqueueEmbedding: false,
    }));
    expect(result).toMatchObject({
      storageKey: 'mount-blob:vault-1:blob-1',
      blobId: 'blob-1',
      linkId: 'link-1',
      storedMimeType: 'image/webp',
      sha256: 'sha-abc',
      sizeBytes: 'webp-bytes'.length,
    });
  });

  it('reports the leaf the pipeline actually landed on after a collision bump', async () => {
    mockStore.mockImplementationOnce(async (input) => ({
      mountPointId: input.mountPointId,
      relativePath: input.relativePath.replace(/\.webp$/, ' (2).webp'),
      kind: 'blob',
      fileType: 'blob',
      sha256: 's',
      sizeBytes: 1,
      storedMimeType: 'image/webp',
      mtime: 0,
      linkId: 'link-2',
      blobId: 'blob-2',
    }));
    const result = await writeWardrobeItemImage({
      mountPointId: 'vault-1',
      itemId: ITEM_ID,
      kind: 'uploaded',
      content: Buffer.from('x'),
      contentType: 'image/webp',
    });
    expect(result.leafName).toMatch(/-uploaded \(2\)\.webp$/);
    expect(result.storageKey).toBe('mount-blob:vault-1:blob-2');
  });

  it('keeps an exact leaf name when given one, upserting there', async () => {
    const result = await writeWardrobeItemImage({
      mountPointId: 'vault-2',
      itemId: ITEM_ID,
      kind: 'imported',
      content: Buffer.from('x'),
      contentType: 'image/webp',
      leafName: '20260101-120000-generated.webp',
    });
    expect(result.relativePath).toBe(`Wardrobe/images/${ITEM_ID}/20260101-120000-generated.webp`);
    expect(mockStore).toHaveBeenCalledWith(expect.objectContaining({ collisionStrategy: 'overwrite' }));
  });

  it('routes to the parent over host-RPC in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1';
    const hostResult = { storageKey: 'mount-blob:vault-1:blob-1', linkId: 'link-1' };
    jest.mocked(callHost).mockResolvedValue(hostResult);
    const input = {
      mountPointId: 'vault-1',
      itemId: ITEM_ID,
      kind: 'generated' as const,
      content: Buffer.from('x'),
      contentType: 'image/webp',
    };

    await expect(writeWardrobeItemImage(input)).resolves.toBe(hostResult);
    expect(callHost).toHaveBeenCalledWith('writeWardrobeItemImage', input);
    expect(mockStore).not.toHaveBeenCalled();
  });
});

describe('deleteWardrobeItemImageLink', () => {
  it('deletes the link with GC and emits emitDocumentDeleted', async () => {
    findByMountPointAndPath.mockResolvedValue({ id: 'link-9' });
    const removed = await deleteWardrobeItemImageLink('vault-1', ITEM_ID, 'a.webp');

    expect(removed).toBe(true);
    expect(findByMountPointAndPath).toHaveBeenCalledWith('vault-1', wardrobeItemImagePath(ITEM_ID, 'a.webp'));
    expect(deleteWithGC).toHaveBeenCalledWith('link-9');
    expect(mockEmitDeleted).toHaveBeenCalledWith({
      mountPointId: 'vault-1',
      relativePath: `Wardrobe/images/${ITEM_ID}/a.webp`,
    });
  });

  it('returns false when no link exists', async () => {
    findByMountPointAndPath.mockResolvedValue(null);
    expect(await deleteWardrobeItemImageLink('vault-1', ITEM_ID, 'gone.webp')).toBe(false);
    expect(deleteWithGC).not.toHaveBeenCalled();
  });

  it('refuses to run in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1';
    await expect(deleteWardrobeItemImageLink('vault-1', ITEM_ID, 'a.webp')).rejects.toThrow(/parent-process only/);
  });
});
