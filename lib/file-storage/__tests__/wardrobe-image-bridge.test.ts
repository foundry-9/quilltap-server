/**
 * Tests for the wardrobe image bridge: the `Wardrobe/images/<itemId>/…webp`
 * path shape, the job-child refusal, and the document-written event.
 *
 * `@/lib/repositories/factory` is mocked app-wide in jest.setup.ts and
 * configured per test here; folder creation, unique-path resolution and the
 * store events are mocked locally. `sanitizeLeafName` stays real (pure).
 */

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue('folder-id'),
}));

jest.mock('@/lib/mount-index/db-store-events', () => ({
  emitDocumentWritten: jest.fn(),
  emitDocumentDeleted: jest.fn(),
}));

jest.mock('@/lib/file-storage/bridge-path-helpers', () => {
  const actual = jest.requireActual('@/lib/file-storage/bridge-path-helpers');
  return {
    ...actual,
    resolveUniqueRelativePath: jest.fn(async (_mount: string, relativePath: string) => relativePath),
  };
});

import {
  deleteWardrobeItemImageLink,
  writeWardrobeItemImage,
  wardrobeItemImagePath,
} from '@/lib/file-storage/wardrobe-image-bridge';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureFolderPath } from '@/lib/mount-index/folder-paths';
import { emitDocumentDeleted, emitDocumentWritten } from '@/lib/mount-index/db-store-events';
import { resolveUniqueRelativePath } from '@/lib/file-storage/bridge-path-helpers';

const mockGetRepositories = jest.mocked(getRepositories);
const mockEnsureFolderPath = jest.mocked(ensureFolderPath);
const mockEmitWritten = jest.mocked(emitDocumentWritten);
const mockEmitDeleted = jest.mocked(emitDocumentDeleted);
const mockResolveUnique = jest.mocked(resolveUniqueRelativePath);

const ORIGINAL_ENV = process.env.QUILLTAP_JOB_CHILD;
const ITEM_ID = '11111111-1111-4111-8111-111111111111';

let linkBlobContent: jest.Mock;
let findByMountPointAndPath: jest.Mock;
let deleteWithGC: jest.Mock;
let refreshStats: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.QUILLTAP_JOB_CHILD;

  linkBlobContent = jest.fn(async (args: { relativePath: string; data: Buffer }) => ({
    link: {
      id: 'link-1',
      relativePath: args.relativePath,
      sha256: 'sha-abc',
      fileSizeBytes: args.data.length,
    },
    blobId: 'blob-1',
  }));
  findByMountPointAndPath = jest.fn();
  deleteWithGC = jest.fn().mockResolvedValue({ fileGC: true });
  refreshStats = jest.fn().mockResolvedValue(undefined);

  mockGetRepositories.mockReturnValue({
    docMountFileLinks: { linkBlobContent, findByMountPointAndPath, deleteWithGC },
    docMountBlobs: { findById: jest.fn().mockResolvedValue({ id: 'blob-1', storedMimeType: 'image/webp' }) },
    docMountPoints: { refreshStats },
  } as unknown as ReturnType<typeof getRepositories>);
});

afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.QUILLTAP_JOB_CHILD;
  else process.env.QUILLTAP_JOB_CHILD = ORIGINAL_ENV;
});

describe('writeWardrobeItemImage', () => {
  it('writes to Wardrobe/images/<itemId>/<yyyymmdd-hhmmss>-<kind>-<8 hex>.webp', async () => {
    const result = await writeWardrobeItemImage({
      mountPointId: 'vault-1',
      itemId: ITEM_ID,
      kind: 'generated',
      content: Buffer.from('webp-bytes'),
      contentType: 'image/webp',
    });

    const pattern = new RegExp(`^Wardrobe/images/${ITEM_ID}/\\d{8}-\\d{6}-generated-[0-9a-f]{8}\\.webp$`);
    expect(result.relativePath).toMatch(pattern);
    expect(result.leafName).toMatch(/^\d{8}-\d{6}-generated-[0-9a-f]{8}\.webp$/);
    expect(mockResolveUnique).toHaveBeenCalledWith('vault-1', expect.stringMatching(pattern));
    expect(mockEnsureFolderPath).toHaveBeenCalledWith('vault-1', `Wardrobe/images/${ITEM_ID}`);
    expect(linkBlobContent).toHaveBeenCalledWith(
      expect.objectContaining({ mountPointId: 'vault-1', folderId: 'folder-id', originalMimeType: 'image/webp' }),
    );
    expect(result).toMatchObject({
      storageKey: 'mount-blob:vault-1:blob-1',
      blobId: 'blob-1',
      linkId: 'link-1',
      storedMimeType: 'image/webp',
      sha256: 'sha-abc',
      sizeBytes: 'webp-bytes'.length,
    });
  });

  it('uses the kind in the minted leaf name', async () => {
    const result = await writeWardrobeItemImage({
      mountPointId: 'vault-1',
      itemId: ITEM_ID,
      kind: 'uploaded',
      content: Buffer.from('x'),
      contentType: 'image/webp',
    });
    expect(result.leafName).toMatch(/-uploaded-[0-9a-f]{8}\.webp$/);
  });

  it('keeps an exact leaf name when given one, without collision bumping', async () => {
    const result = await writeWardrobeItemImage({
      mountPointId: 'vault-2',
      itemId: ITEM_ID,
      kind: 'imported',
      content: Buffer.from('x'),
      contentType: 'image/webp',
      leafName: '20260101-120000-generated.webp',
    });
    expect(result.relativePath).toBe(`Wardrobe/images/${ITEM_ID}/20260101-120000-generated.webp`);
    expect(mockResolveUnique).not.toHaveBeenCalled();
  });

  it('emits emitDocumentWritten for the written link', async () => {
    const result = await writeWardrobeItemImage({
      mountPointId: 'vault-1',
      itemId: ITEM_ID,
      kind: 'generated',
      content: Buffer.from('x'),
      contentType: 'image/webp',
    });
    expect(mockEmitWritten).toHaveBeenCalledWith({ mountPointId: 'vault-1', relativePath: result.relativePath });
    expect(refreshStats).toHaveBeenCalledWith('vault-1');
  });

  it('refuses to run in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1';
    await expect(
      writeWardrobeItemImage({
        mountPointId: 'vault-1',
        itemId: ITEM_ID,
        kind: 'generated',
        content: Buffer.from('x'),
        contentType: 'image/webp',
      }),
    ).rejects.toThrow(/parent-process only/);
    expect(linkBlobContent).not.toHaveBeenCalled();
    expect(mockEmitWritten).not.toHaveBeenCalled();
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
