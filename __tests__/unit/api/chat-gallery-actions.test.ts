/**
 * Unit tests for the two chat-gallery routes.
 *
 *   GET  /api/v1/chats/[id]?action=gallery
 *   POST /api/v1/chats/[id]?action=save-image
 *
 * The enumerator has its own suite (`lib/photos/chat-gallery.test.ts`); these
 * pin the route contracts around it — the response shape, the membership guard
 * that stands in for the message route's attachment guard, and the error map.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  },
}));

// The chat GET handler pulls in the markdown renderer, whose unified/remark
// imports are ESM-only and unloadable under Jest. Nothing on the gallery path
// touches it.
jest.mock('@/lib/services/markdown-renderer.service', () => ({
  renderMarkdownToHtml: jest.fn(),
  canPreRenderMessage: jest.fn(() => false),
}));

const mockListChatGallery = jest.fn();
const mockGetChatGallery = jest.fn();
jest.mock('@/lib/photos/chat-gallery', () => ({
  listChatGallery: (...args: unknown[]) => mockListChatGallery(...args),
  getChatGallery: (...args: unknown[]) => mockGetChatGallery(...args),
}));

const mockSaveImageToAlbum = jest.fn();
jest.mock('@/lib/photos/save-image-to-album', () => {
  const actual = jest.requireActual('@/lib/photos/save-image-to-album') as Record<string, unknown>;
  return {
    ...actual,
    saveImageToAlbum: (...args: unknown[]) => mockSaveImageToAlbum(...args),
  };
});

const mockResolveSaveAttribution = jest.fn();
jest.mock('@/lib/photos/save-attribution', () => ({
  resolveSaveAttribution: (...args: unknown[]) => mockResolveSaveAttribution(...args),
}));

import { handleGet } from '@/app/api/v1/chats/[id]/handlers/get';
import { handleSaveGalleryImage } from '@/app/api/v1/chats/[id]/actions/save-image';
import { SaveImageToAlbumError } from '@/lib/photos/save-image-to-album';
import type { RequestContext } from '@/lib/api/middleware';

const CHAT_ID = 'chat-1';
const MOUNT_ID = 'mount-1';

const BACKGROUND_ENTRY = {
  id: 'bg-1',
  idKind: 'file' as const,
  url: '/api/v1/files/bg-1',
  filename: 'bg-1.webp',
  mimeType: 'image/webp',
  size: 1024,
  createdAt: '2026-09-05T00:00:00.000Z',
  source: 'story-background' as const,
  isCurrent: true,
  deletable: false,
};

function ctx(chat: unknown = { id: CHAT_ID, participants: [] }): RequestContext {
  return {
    user: { id: 'user-1', name: 'Charlie' },
    repos: {
      chats: { findById: jest.fn().mockResolvedValue(chat) },
    },
  } as unknown as RequestContext;
}

function getRequest(): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/chats/${CHAT_ID}?action=gallery`);
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/chats/${CHAT_ID}?action=save-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveSaveAttribution.mockResolvedValue({ name: 'Charlie', id: 'user-1', role: 'user' });
});

// ---------------------------------------------------------------------------

describe('GET /api/v1/chats/[id]?action=gallery', () => {
  it('answers with the enumerator’s entries, counts and total', async () => {
    mockGetChatGallery.mockResolvedValue({
      entries: [BACKGROUND_ENTRY],
      counts: {
        'story-background': 1,
        avatar: 0,
        portrait: 0,
        generated: 0,
        attachment: 0,
        kept: 0,
        inline: 0,
      },
      total: 1,
    });

    const response = await handleGet(getRequest(), ctx(), CHAT_ID);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ id: 'bg-1', source: 'story-background' });
    expect(body.counts['story-background']).toBe(1);
  });

  it('404s for a chat that does not exist', async () => {
    const response = await handleGet(getRequest(), ctx(null), CHAT_ID);

    expect(response.status).toBe(404);
    expect(mockGetChatGallery).not.toHaveBeenCalled();
  });

  it('500s rather than answering an empty roll when the enumerator throws', async () => {
    mockGetChatGallery.mockRejectedValue(new Error('mount index unavailable'));

    const response = await handleGet(getRequest(), ctx(), CHAT_ID);
    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------

describe('POST /api/v1/chats/[id]?action=save-image', () => {
  it('saves a background that hangs beneath no message at all', async () => {
    mockListChatGallery.mockResolvedValue([BACKGROUND_ENTRY]);
    mockSaveImageToAlbum.mockResolvedValue({
      mountPointName: 'Amelia',
      relativePath: 'photos/2026-09-05-a-backdrop.webp',
      linkId: 'link-new',
      keptAt: '2026-09-09T00:00:00.000Z',
      fileId: 'bg-1',
      sha256: 'sha-bg-1',
    });

    const response = await handleSaveGalleryImage(
      postRequest({ fileId: 'bg-1', mountPointId: MOUNT_ID }),
      CHAT_ID,
      ctx(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data ?? body).toMatchObject({ saved: true, mountPoint: 'Amelia', linkId: 'link-new' });
    expect(mockSaveImageToAlbum).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'bg-1', mountPointId: MOUNT_ID, chatId: CHAT_ID }),
    );
  });

  it('rejects an id that belongs to some other chat', async () => {
    mockListChatGallery.mockResolvedValue([BACKGROUND_ENTRY]);

    const response = await handleSaveGalleryImage(
      postRequest({ fileId: 'someone-elses-image', mountPointId: MOUNT_ID }),
      CHAT_ID,
      ctx(),
    );

    expect(response.status).toBe(400);
    expect(mockSaveImageToAlbum).not.toHaveBeenCalled();
  });

  it('maps ALREADY_SAVED to 409 and says where the picture already hangs', async () => {
    mockListChatGallery.mockResolvedValue([BACKGROUND_ENTRY]);
    mockSaveImageToAlbum.mockRejectedValue(
      new SaveImageToAlbumError('ALREADY_SAVED', 'Image already saved to Amelia', {
        existingRelativePath: 'photos/older.webp',
        existingCreatedAt: '2026-09-01T00:00:00.000Z',
      }),
    );

    const response = await handleSaveGalleryImage(
      postRequest({ fileId: 'bg-1', mountPointId: MOUNT_ID }),
      CHAT_ID,
      ctx(),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: 'ALREADY_SAVED',
      relativePath: 'photos/older.webp',
      keptAt: '2026-09-01T00:00:00.000Z',
    });
  });

  it('maps the other album errors to 400', async () => {
    mockListChatGallery.mockResolvedValue([BACKGROUND_ENTRY]);
    mockSaveImageToAlbum.mockRejectedValue(
      new SaveImageToAlbumError('MOUNT_NOT_FOUND', 'Mount point not found: mount-1'),
    );

    const response = await handleSaveGalleryImage(
      postRequest({ fileId: 'bg-1', mountPointId: MOUNT_ID }),
      CHAT_ID,
      ctx(),
    );

    expect(response.status).toBe(400);
  });

  it('404s for a chat that does not exist', async () => {
    const response = await handleSaveGalleryImage(
      postRequest({ fileId: 'bg-1', mountPointId: MOUNT_ID }),
      CHAT_ID,
      ctx(null),
    );

    expect(response.status).toBe(404);
    expect(mockListChatGallery).not.toHaveBeenCalled();
  });

  it('400s on a body missing its mount point', async () => {
    const response = await handleSaveGalleryImage(
      postRequest({ fileId: 'bg-1' }),
      CHAT_ID,
      ctx(),
    );

    expect(response.status).toBe(400);
    expect(mockListChatGallery).not.toHaveBeenCalled();
  });
});
