/**
 * Two doc_* handler guards:
 *
 *  - `doc_delete_blob` deletes only a blob: a path whose file is a document
 *    (or carries no blob bytes) is refused, and the per-document write policy
 *    is honoured as it is by the other doc write tools.
 *  - `doc_open_document` refuses a URI that names no file (`qtap://general`);
 *    a new blank document is asked for only by omitting both `uri` and `path`.
 *
 * The mount resolution helpers are mocked; the handlers' own checks and the
 * real `assertCharacterMayWrite` run. `getRepositories` is globally mocked by
 * jest.setup and configured per test.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import { handleDeleteBlob } from '../doc-edit/blob-handlers';
import { handleOpenDocument } from '../doc-edit/document-ui-handlers';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { getAccessibleMountPoints } from '@/lib/doc-edit';
import { postLibrarianDeleteAnnouncement } from '@/lib/services/librarian-notifications/writer';

jest.mock('@/lib/doc-edit', () => {
  const actual = jest.requireActual('@/lib/doc-edit');
  return {
    ...actual,
    getAccessibleMountPoints: jest.fn(),
    resolveMountPointRef: jest.fn(async (ref: string) => ref),
  };
});

jest.mock('@/lib/tools/handlers/doc-edit/shared', () => {
  const actual = jest.requireActual('@/lib/tools/handlers/doc-edit/shared');
  return {
    ...actual,
    collectPeerCharacterIdsForReads: jest.fn(async () => []),
    actingCharacterIsOpaqueToVaults: jest.fn(async () => false),
    assertWriteDoesNotTargetPeerVault: jest.fn(async () => undefined),
    resolveActorOrigin: jest.fn(async () => undefined),
    docStoreUriFor: jest.fn(async () => 'qtap://Lore/x'),
  };
});

jest.mock('@/lib/services/librarian-notifications/writer', () => ({
  postLibrarianDeleteAnnouncement: jest.fn(),
  postLibrarianBlobWriteAnnouncement: jest.fn(),
}));

const STORE = { id: 'mp-1', name: 'Lore' };
const ctx = { userId: 'u1', chatId: 'chat-1', characterId: 'c1', projectId: 'p1' };

let blobs: { findByMountPointAndPath: jest.Mock; deleteByMountPointAndPath: jest.Mock };
let documents: { findByFileId: jest.Mock };
let links: { findByMountPointAndPath: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  blobs = {
    findByMountPointAndPath: jest.fn().mockResolvedValue(null),
    deleteByMountPointAndPath: jest.fn().mockResolvedValue(true),
  };
  documents = { findByFileId: jest.fn().mockResolvedValue(null) };
  links = { findByMountPointAndPath: jest.fn().mockResolvedValue(null) };
  jest.mocked(getRepositories).mockReturnValue({
    docMountBlobs: blobs,
    docMountDocuments: documents,
    docMountFileLinks: links,
  } as never);
  jest.mocked(getAccessibleMountPoints).mockResolvedValue([STORE] as never);
});

describe('doc_delete_blob', () => {
  it('refuses a document path and deletes nothing', async () => {
    links.findByMountPointAndPath.mockResolvedValue({ id: 'l1', fileId: 'f1', relativePath: 'Notes/a.md' });

    const result = await handleDeleteBlob({ mount_point: 'Lore', path: 'Notes/a.md' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Not a blob: .*doc_delete_file/);
    expect(blobs.deleteByMountPointAndPath).not.toHaveBeenCalled();
    expect(postLibrarianDeleteAnnouncement).not.toHaveBeenCalled();
  });

  it('refuses a file that carries both blob bytes and a document', async () => {
    blobs.findByMountPointAndPath.mockResolvedValue({ fileId: 'f2', relativePath: 'Notes/b.md' });
    documents.findByFileId.mockResolvedValue({ id: 'd2', fileId: 'f2' });

    const result = await handleDeleteBlob({ mount_point: 'Lore', path: 'Notes/b.md' }, ctx);

    expect(result.error).toMatch(/Not a blob/);
    expect(blobs.deleteByMountPointAndPath).not.toHaveBeenCalled();
  });

  it('honours character_write:false on a blob', async () => {
    blobs.findByMountPointAndPath.mockResolvedValue({ fileId: 'f3', relativePath: 'images/map.webp' });
    links.findByMountPointAndPath.mockResolvedValue({ allowCharacterRead: true, allowCharacterWrite: false });

    const result = await handleDeleteBlob({ mount_point: 'Lore', path: 'images/map.webp' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/read-only to characters/);
    expect(blobs.deleteByMountPointAndPath).not.toHaveBeenCalled();
  });

  it('deletes a blob by its stored path', async () => {
    blobs.findByMountPointAndPath.mockResolvedValue({ fileId: 'f4', relativePath: 'images/Map.webp' });

    const result = await handleDeleteBlob({ mount_point: 'Lore', path: 'images/map.webp' }, ctx);

    expect(result.success).toBe(true);
    expect(blobs.deleteByMountPointAndPath).toHaveBeenCalledWith('mp-1', 'images/Map.webp');
  });
});

describe('doc_open_document', () => {
  it.each(['qtap://general', 'qtap://general/', 'qtap://self'])('refuses %s, which names no file', async (uri) => {
    const result = await handleOpenDocument({ uri }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/names no file/);
  });
});
