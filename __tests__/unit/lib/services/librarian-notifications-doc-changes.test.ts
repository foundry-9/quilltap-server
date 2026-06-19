/**
 * Unit tests for the character-initiated document-change announcements added to
 * the Librarian notifications writer: content writes (create/edit), moves,
 * copies, and blob uploads. Pins the systemKind labels chosen from the acting
 * origin, the empty-diff skip, and the truncation of large bodies/diffs.
 *
 * @jest-environment node
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must precede the subject import.
// ---------------------------------------------------------------------------

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('@/lib/repositories/factory', () => {
  const addMessage = jest.fn();
  const findById = jest.fn();
  const chats = { findById, addMessage };
  return { getRepositories: () => ({ chats }) };
});

import {
  postLibrarianWriteAnnouncement,
  postLibrarianMoveAnnouncement,
  postLibrarianCopyAnnouncement,
  postLibrarianBlobWriteAnnouncement,
} from '@/lib/services/librarian-notifications/writer';
import { getRepositories } from '@/lib/repositories/factory';

const repos = getRepositories();
const addMessage = repos.chats.addMessage as jest.Mock;
const findById = repos.chats.findById as jest.Mock;

const byCharacter = { kind: 'by-character' as const, characterName: 'Beatrice' };
const byUser = { kind: 'by-user' as const };

/** Pull the persisted message off the most recent addMessage call. */
function lastMessage() {
  const call = addMessage.mock.calls[addMessage.mock.calls.length - 1];
  return call[1] as { systemSender: string; systemKind: string; content: string; opaqueContent: string };
}

describe('Librarian doc-change announcements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findById.mockResolvedValue({ id: 'c-1' });
  });

  it('write/created → created-by-character, reports contents + uri', async () => {
    await postLibrarianWriteAnnouncement({
      chatId: 'c-1',
      displayTitle: 'Notes.md',
      uri: 'qtap://self/Notes.md',
      scope: 'document_store',
      mountPoint: 'self',
      origin: byCharacter,
      change: { kind: 'created', body: '# Title\n\nFresh prose.' },
    });
    expect(addMessage).toHaveBeenCalledTimes(1);
    const msg = lastMessage();
    expect(msg.systemSender).toBe('librarian');
    expect(msg.systemKind).toBe('created-by-character');
    expect(msg.content).toContain('Fresh prose.');
    expect(msg.content).toContain('qtap://self/Notes.md');
    expect(msg.opaqueContent).toContain('Document created: "Notes.md"');
  });

  it('write/created with by-user origin → created-by-user', async () => {
    await postLibrarianWriteAnnouncement({
      chatId: 'c-1',
      displayTitle: 'Notes.md',
      uri: 'qtap://self/Notes.md',
      scope: 'document_store',
      mountPoint: 'self',
      origin: byUser,
      change: { kind: 'created', body: 'x' },
    });
    expect(lastMessage().systemKind).toBe('created-by-user');
  });

  it('write/edited with a real diff → edited-by-character, embeds the diff', async () => {
    await postLibrarianWriteAnnouncement({
      chatId: 'c-1',
      displayTitle: 'Notes.md',
      uri: 'qtap://self/Notes.md',
      scope: 'document_store',
      mountPoint: 'self',
      origin: byCharacter,
      change: { kind: 'edited', diff: '--- a/Notes.md\n+++ b/Notes.md\n@@ -1 +1 @@\n-old\n+new' },
    });
    expect(addMessage).toHaveBeenCalledTimes(1);
    const msg = lastMessage();
    expect(msg.systemKind).toBe('edited-by-character');
    expect(msg.content).toContain('+new');
  });

  it('write/edited with an empty diff is silent (no message persisted)', async () => {
    const result = await postLibrarianWriteAnnouncement({
      chatId: 'c-1',
      displayTitle: 'Notes.md',
      uri: 'qtap://self/Notes.md',
      scope: 'document_store',
      mountPoint: 'self',
      origin: byCharacter,
      change: { kind: 'edited', diff: '   \n  ' },
    });
    expect(result).toBeNull();
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('caps a very large created body with a truncation notice naming the uri', async () => {
    const body = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    await postLibrarianWriteAnnouncement({
      chatId: 'c-1',
      displayTitle: 'Big.md',
      uri: 'qtap://self/Big.md',
      scope: 'document_store',
      mountPoint: 'self',
      origin: byCharacter,
      change: { kind: 'created', body },
    });
    const msg = lastMessage();
    expect(msg.content).toContain('[truncated');
    expect(msg.content).toContain('qtap://self/Big.md');
    expect(msg.content).not.toContain('line 399');
  });

  it('move → moved-by-character with both addresses', async () => {
    await postLibrarianMoveAnnouncement({
      chatId: 'c-1',
      oldDisplayTitle: 'old.md',
      newDisplayTitle: 'new.md',
      oldUri: 'qtap://self/old.md',
      newUri: 'qtap://self/sub/new.md',
      scope: 'document_store',
      mountPoint: 'self',
      origin: byCharacter,
      isFolder: false,
    });
    const msg = lastMessage();
    expect(msg.systemKind).toBe('moved-by-character');
    expect(msg.content).toContain('qtap://self/old.md');
    expect(msg.content).toContain('qtap://self/sub/new.md');
  });

  it('copy → copied-by-character naming source/dest stores', async () => {
    await postLibrarianCopyAnnouncement({
      chatId: 'c-1',
      sourceDisplayTitle: 'a.md',
      destDisplayTitle: 'a.md',
      sourceMountPoint: 'Library',
      destMountPoint: 'Archive',
      sourceUri: 'qtap://Library/a.md',
      destUri: 'qtap://Archive/a.md',
      origin: byCharacter,
    });
    const msg = lastMessage();
    expect(msg.systemKind).toBe('copied-by-character');
    expect(msg.content).toContain('Archive');
  });

  it('blob write → blob-written-by-character with mime/size/uri', async () => {
    await postLibrarianBlobWriteAnnouncement({
      chatId: 'c-1',
      displayTitle: 'sketch.webp',
      uri: 'qtap://self/photos/sketch.webp',
      mountPoint: 'self',
      mimeType: 'image/webp',
      sizeBytes: 4096,
      origin: byCharacter,
    });
    const msg = lastMessage();
    expect(msg.systemKind).toBe('blob-written-by-character');
    expect(msg.content).toContain('image/webp');
    expect(msg.content).toContain('qtap://self/photos/sketch.webp');
  });
});
