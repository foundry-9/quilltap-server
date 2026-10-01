/**
 * @jest-environment node
 *
 * Bug 38 — a native-text document attached from a database store must reach the
 * LLM.
 *
 * `.md`/`.txt`/`.json` files PUT into a database store become documents
 * (doc_mount_documents, no blob row). The blob-only resolver returned null for
 * exactly those, so an attached markdown document silently never reached the
 * model. `loadMountFileAsAttachment` now falls back to the document row and
 * serves its text as a FileAttachment.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const l = { child: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child.mockReturnValue(l);
  return { logger: l };
});

import { loadChatFilesForLLM } from '@/lib/chat-files-v2';

const { getRepositories } = jest.requireMock('@/lib/repositories/factory') as {
  getRepositories: jest.Mock;
};

const DOC_CONTENT = '# Field Notes\n\nThe zeppelin listed to starboard.';

function reposWithDocument(overrides: Record<string, unknown> = {}) {
  return {
    files: { findById: jest.fn(async () => null) },
    docMountFileLinks: {
      findByIdWithContent: jest.fn(async () => ({
        id: 'link-1',
        fileId: 'file-1',
        mountPointId: 'mp-1',
        relativePath: 'Notes/field.md',
        fileName: 'field.md',
        originalFileName: null,
      })),
      findByFileId: jest.fn(async () => []),
    },
    docMountBlobs: { findByFileId: jest.fn(async () => null) },
    docMountDocuments: { findByFileId: jest.fn(async () => ({ content: DOC_CONTENT })) },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Bug 38 — mount document resolves to a text FileAttachment', () => {
  it('serves the document text when the link has no blob', async () => {
    getRepositories.mockReturnValue(reposWithDocument());

    const attachments = await loadChatFilesForLLM(['link-1']);

    expect(attachments).toHaveLength(1);
    expect(attachments[0].mimeType).toBe('text/markdown');
    expect(attachments[0].filename).toBe('field.md');
    expect(Buffer.from(attachments[0].data, 'base64').toString('utf-8')).toBe(DOC_CONTENT);
    expect(attachments[0].size).toBe(Buffer.byteLength(DOC_CONTENT, 'utf-8'));
  });

  it('bug 174 — sets no url on a document attachment, only filepath', async () => {
    getRepositories.mockReturnValue(reposWithDocument());

    const [attachment] = await loadChatFilesForLLM(['link-1']);

    expect(attachment.url).toBeUndefined();
    expect(attachment.filepath).toBe('/api/v1/mount-points/mp-1/files/Notes/field.md');
  });

  it('bug 174 — sets no url on a blob (vault image) attachment, only filepath', async () => {
    const bytes = Buffer.from('RIFF0000WEBP');
    getRepositories.mockReturnValue(
      reposWithDocument({
        docMountFileLinks: {
          findByIdWithContent: jest.fn(async () => ({
            id: 'link-2',
            fileId: 'file-2',
            mountPointId: 'mp-1',
            relativePath: 'photos/laura.webp',
            fileName: 'laura.webp',
            originalFileName: null,
          })),
          findByFileId: jest.fn(async () => []),
        },
        docMountBlobs: {
          findByFileId: jest.fn(async () => ({ id: 'blob-2', storedMimeType: 'image/webp' })),
          readData: jest.fn(async () => bytes),
        },
      }),
    );

    const [attachment] = await loadChatFilesForLLM(['link-2']);

    expect(attachment.url).toBeUndefined();
    expect(attachment.filepath).toBe('/api/v1/mount-points/mp-1/blobs/photos/laura.webp');
    expect(attachment.data).toBe(bytes.toString('base64'));
    expect(attachment.mimeType).toBe('image/webp');
  });

  it('still returns nothing when neither a blob nor a document exists', async () => {
    getRepositories.mockReturnValue(
      reposWithDocument({ docMountDocuments: { findByFileId: jest.fn(async () => null) } }),
    );

    const attachments = await loadChatFilesForLLM(['link-1']);

    expect(attachments).toHaveLength(0);
  });
});
