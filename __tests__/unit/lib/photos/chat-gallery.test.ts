/**
 * The chat gallery enumerator — one fixture per way an image reaches a chat.
 *
 * The nine sources in `docs/developer/features/complete/salon-chat-gallery.md`
 * are the contract this file pins. Each `it` names one of them, plus the three
 * rules that cut across all nine: dedup by content hash, first-pass-wins on
 * `source`, and `deletable` only where the chat owns the record.
 */

import {
  listChatGallery,
  getChatGallery,
  resolveMessageAttachmentEntries,
  countBySource,
  type ChatGalleryEntry,
} from '@/lib/photos/chat-gallery';
import type { RepositoryContainer } from '@/lib/database/repositories';
import type { ChatEvent, ChatMetadata } from '@/lib/schemas/chat.types';
import type { Character } from '@/lib/schemas/character.types';
import type { FileEntry } from '@/lib/schemas/types';

const CHAT_ID = 'chat-1';
const CHAR_A = 'char-a';
const CHAR_B = 'char-b';
const MOUNT_VAULT = 'mount-vault-a';
const MOUNT_STORE = 'mount-store';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function file(overrides: Partial<FileEntry> & { id: string }): FileEntry {
  return {
    id: overrides.id,
    userId: 'user-1',
    sha256: `sha-${overrides.id}`,
    originalFilename: `${overrides.id}.webp`,
    mimeType: 'image/webp',
    size: 1024,
    width: null,
    height: null,
    linkedTo: [CHAT_ID],
    source: 'UPLOAD',
    category: 'IMAGE',
    tags: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as FileEntry;
}

function character(overrides: Partial<Character> & { id: string }): Character {
  return {
    id: overrides.id,
    name: overrides.id,
    avatarOverrides: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Character;
}

function message(overrides: Partial<ChatEvent> & { id: string }): ChatEvent {
  return {
    type: 'message',
    id: overrides.id,
    role: 'ASSISTANT',
    content: '',
    attachments: [],
    createdAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  } as ChatEvent;
}

function chat(overrides: Partial<ChatMetadata> = {}): ChatMetadata {
  return {
    id: CHAT_ID,
    userId: 'user-1',
    title: 'A Conversation',
    participants: [
      { id: 'p-a', type: 'CHARACTER', characterId: CHAR_A, controlledBy: 'llm', status: 'active' },
      { id: 'p-b', type: 'CHARACTER', characterId: CHAR_B, controlledBy: 'user', status: 'active' },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as ChatMetadata;
}

interface FakeWorld {
  chat?: ChatMetadata | null;
  files?: FileEntry[];
  events?: ChatEvent[];
  characters?: Character[];
  /** doc_mount_file_links rows, keyed by their own id. */
  links?: Array<{
    id: string;
    fileId: string;
    mountPointId: string;
    relativePath: string;
    fileName: string;
    originalFileName?: string;
    originalMimeType?: string;
    fileSizeBytes?: number;
    sha256?: string;
    createdAt?: string;
  }>;
  /** doc_mount_blobs rows, keyed by their doc_mount_files fileId. */
  blobs?: Array<{ fileId: string; storedMimeType: string; sizeBytes: number; sha256: string }>;
}

function makeRepos(world: FakeWorld): RepositoryContainer {
  const files = world.files ?? [];
  const links = world.links ?? [];
  const blobs = world.blobs ?? [];
  const characters = world.characters ?? [];

  return {
    chats: {
      findById: jest.fn(async (id: string) =>
        world.chat === undefined ? chat() : world.chat && world.chat.id === id ? world.chat : null,
      ),
      getMessages: jest.fn(async () => world.events ?? []),
    },
    files: {
      findByLinkedTo: jest.fn(async (entityId: string) =>
        files.filter((f) => (f.linkedTo ?? []).includes(entityId)),
      ),
      findById: jest.fn(async (id: string) => files.find((f) => f.id === id) ?? null),
    },
    characters: {
      findByIds: jest.fn(async (ids: string[]) => characters.filter((c) => ids.includes(c.id))),
      findById: jest.fn(async (id: string) => characters.find((c) => c.id === id) ?? null),
    },
    docMountFileLinks: {
      findByIdWithContent: jest.fn(async (id: string) => links.find((l) => l.id === id) ?? null),
      findByFileId: jest.fn(async (fileId: string) => links.filter((l) => l.fileId === fileId)),
      findByMountPointAndPath: jest.fn(
        async (mountPointId: string, relativePath: string) =>
          links.find((l) => l.mountPointId === mountPointId && l.relativePath === relativePath) ??
          null,
      ),
    },
    docMountBlobs: {
      findByFileId: jest.fn(async (fileId: string) => blobs.find((b) => b.fileId === fileId) ?? null),
    },
    docMountDocuments: {
      findByFileId: jest.fn(async () => null),
    },
    // Backs getPhotoLinkSummaryBySha256; an empty index means no linkers,
    // which is the ordinary case for a freshly generated image.
    docMountFiles: {
      findBySha256: jest.fn(async () => null),
    },
    docMountPoints: {
      findById: jest.fn(async (id: string) => ({ id, name: id, storeType: 'documents' })),
    },
  } as unknown as RepositoryContainer;
}

function bySource(entries: ChatGalleryEntry[], source: string): ChatGalleryEntry[] {
  return entries.filter((e) => e.source === source);
}

// ---------------------------------------------------------------------------
// The nine sources
// ---------------------------------------------------------------------------

describe('listChatGallery — the nine ways an image reaches a chat', () => {
  it('#1 a user upload, linked to the chat', async () => {
    const repos = makeRepos({ files: [file({ id: 'upload-1', source: 'UPLOAD' })] });
    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'upload-1',
      idKind: 'file',
      source: 'attachment',
      url: '/api/v1/files/upload-1',
      isCurrent: false,
      deletable: true,
    });
  });

  it('#2 a generate_image output, linked and attached to its tool message', async () => {
    const repos = makeRepos({
      files: [file({ id: 'gen-1', source: 'GENERATED' })],
      events: [message({ id: 'msg-1', role: 'TOOL', attachments: ['gen-1'] })],
    });
    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'generated',
      messageId: 'msg-1',
      deletable: true,
    });
  });

  it('#3 an image the Generate Image dialog made, linked with no message at all', async () => {
    const repos = makeRepos({ files: [file({ id: 'dialog-1', source: 'GENERATED' })] });
    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('generated');
    expect(entries[0].messageId).toBeUndefined();
  });

  it('#4 an attach_image re-show, recorded only as a link id on a message', async () => {
    const repos = makeRepos({
      events: [message({ id: 'msg-2', role: 'TOOL', attachments: ['link-kept'] })],
      links: [
        {
          id: 'link-kept',
          fileId: 'mf-kept',
          mountPointId: MOUNT_VAULT,
          relativePath: 'photos/2026-09-01-a-portrait.webp',
          fileName: 'a-portrait.webp',
          originalFileName: 'a-portrait.webp',
          sha256: 'sha-kept',
        },
      ],
      blobs: [{ fileId: 'mf-kept', storedMimeType: 'image/webp', sizeBytes: 2048, sha256: 'sha-kept' }],
    });
    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'link-kept',
      idKind: 'link',
      // It lives in a `photos/` folder, so it is an album image being shown
      // again — not a document store's file being attached.
      source: 'kept',
      messageId: 'msg-2',
      deletable: false,
      url: `/api/v1/mount-points/${MOUNT_VAULT}/blobs/photos/2026-09-01-a-portrait.webp`,
    });
  });

  it('#5 a Librarian attach from a document store', async () => {
    const repos = makeRepos({
      events: [message({ id: 'msg-3', attachments: ['link-doc'] })],
      links: [
        {
          id: 'link-doc',
          fileId: 'mf-doc',
          mountPointId: MOUNT_STORE,
          relativePath: 'maps/the-estate.webp',
          fileName: 'the-estate.webp',
          sha256: 'sha-doc',
        },
      ],
      blobs: [{ fileId: 'mf-doc', storedMimeType: 'image/webp', sizeBytes: 512, sha256: 'sha-doc' }],
    });
    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ source: 'attachment', idKind: 'link', deletable: false });
  });

  it('#6 a story background with alerts off — no message, and the current one is not deletable', async () => {
    const repos = makeRepos({
      chat: chat({ storyBackgroundImageId: 'bg-current' }),
      files: [
        file({ id: 'bg-current', source: 'GENERATED', createdAt: '2026-09-03T00:00:00.000Z' }),
        file({ id: 'bg-old', source: 'GENERATED', createdAt: '2026-09-01T00:00:00.000Z' }),
      ],
      links: [
        {
          id: 'l-bg-old',
          fileId: 'mf-bg-old',
          mountPointId: 'lantern',
          relativePath: 'generated/old.webp',
          fileName: 'old.webp',
        },
      ],
      events: [],
    });
    // The superseded background is recognised by where the Lantern stored it.
    (repos.docMountFiles.findBySha256 as jest.Mock).mockImplementation(async (sha: string) =>
      sha === 'sha-bg-old' ? { id: 'mf-bg-old' } : null,
    );

    const entries = await listChatGallery(CHAT_ID, repos);
    const backgrounds = bySource(entries, 'story-background');

    expect(backgrounds).toHaveLength(2);
    // Newest first.
    expect(backgrounds[0]).toMatchObject({ id: 'bg-current', isCurrent: true, deletable: false });
    expect(backgrounds[1]).toMatchObject({ id: 'bg-old', isCurrent: false, deletable: true });
    expect(entries.every((e) => e.messageId === undefined)).toBe(true);
  });

  it('#7 an Aurora repaint — the worn one is current, the superseded one keeps its character', async () => {
    const repos = makeRepos({
      chat: chat({
        characterAvatars: {
          [CHAR_A]: { imageId: 'av-current', generatedAt: '2026-09-04T00:00:00.000Z' },
        },
      }),
      characters: [
        character({
          id: CHAR_A,
          avatarOverrides: [
            { chatId: CHAT_ID, imageId: 'av-current' },
            { chatId: CHAT_ID, imageId: 'av-old' },
          ],
        }),
        character({ id: CHAR_B }),
      ],
      files: [
        file({
          id: 'av-current',
          source: 'GENERATED',
          linkedTo: [CHAT_ID, CHAR_A],
          createdAt: '2026-09-04T00:00:00.000Z',
        }),
        file({
          id: 'av-old',
          source: 'GENERATED',
          linkedTo: [CHAT_ID, CHAR_A],
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
      ],
    });

    const entries = await listChatGallery(CHAT_ID, repos);
    const avatars = bySource(entries, 'avatar');

    expect(avatars).toHaveLength(2);
    expect(avatars[0]).toMatchObject({
      id: 'av-current',
      isCurrent: true,
      deletable: false,
      characterId: CHAR_A,
    });
    expect(avatars[1]).toMatchObject({
      id: 'av-old',
      isCurrent: false,
      deletable: true,
      characterId: CHAR_A,
    });
  });

  it('#8 the cast portraits — one legacy file id, one vault link id, neither deletable', async () => {
    const repos = makeRepos({
      characters: [
        character({ id: CHAR_A, name: 'Amelia', defaultImageId: 'legacy-file' }),
        character({ id: CHAR_B, name: 'Bertie', defaultImageId: 'vault-link' }),
      ],
      files: [file({ id: 'legacy-file', linkedTo: [] })],
      links: [
        {
          id: 'vault-link',
          fileId: 'mf-bertie',
          mountPointId: MOUNT_VAULT,
          relativePath: 'images/avatar.webp',
          fileName: 'avatar.webp',
          originalMimeType: 'image/webp',
          sha256: 'sha-bertie',
        },
      ],
    });

    const entries = await listChatGallery(CHAT_ID, repos);
    const portraits = bySource(entries, 'portrait');

    expect(portraits).toHaveLength(2);
    expect(portraits.map((p) => p.idKind).sort()).toEqual(['file', 'link']);
    expect(portraits.every((p) => p.isCurrent && !p.deletable)).toBe(true);
    expect(portraits.map((p) => p.characterName).sort()).toEqual(['Amelia', 'Bertie']);
  });

  it('#9 an image referenced only by a Markdown link in message prose', async () => {
    const repos = makeRepos({
      files: [file({ id: 'inline-file', linkedTo: [] })],
      events: [
        message({
          id: 'msg-4',
          content: 'She unrolls it across the table. ![the map](/api/v1/files/inline-file)',
        }),
      ],
    });

    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'inline-file',
      source: 'inline',
      messageId: 'msg-4',
      deletable: false,
    });
  });

  it('#9 a relative Markdown path resolves against the author’s own vault', async () => {
    const repos = makeRepos({
      characters: [character({ id: CHAR_A, characterDocumentMountPointId: MOUNT_VAULT })],
      events: [
        message({
          id: 'msg-5',
          participantId: 'p-a',
          content: 'He holds it up. ![a sketch](images/sketch.webp)',
        }),
      ],
      links: [
        {
          id: 'link-sketch',
          fileId: 'mf-sketch',
          mountPointId: MOUNT_VAULT,
          relativePath: 'images/sketch.webp',
          fileName: 'sketch.webp',
          originalMimeType: 'image/webp',
          sha256: 'sha-sketch',
        },
      ],
    });

    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'link-sketch',
      idKind: 'link',
      source: 'inline',
      url: `/api/v1/mount-points/${MOUNT_VAULT}/blobs/images/sketch.webp`,
    });
  });

  it('skips a Markdown reference that names no record, without failing the roll', async () => {
    const repos = makeRepos({
      files: [file({ id: 'upload-2' })],
      events: [
        message({
          id: 'msg-6',
          content: '![gone](/api/v1/files/00000000-0000-4000-8000-000000000000) ![remote](https://example.com/a.png)',
        }),
      ],
    });

    const entries = await listChatGallery(CHAT_ID, repos);
    expect(entries.map((e) => e.id)).toEqual(['upload-2']);
  });
});

// ---------------------------------------------------------------------------
// The rules that cut across the sources
// ---------------------------------------------------------------------------

describe('listChatGallery — dedup, ordering and ownership', () => {
  it('shows one picture when the same bytes arrive under two ids', async () => {
    const repos = makeRepos({
      files: [file({ id: 'gen-2', source: 'GENERATED', sha256: 'shared-sha' })],
      events: [message({ id: 'msg-7', role: 'TOOL', attachments: ['link-twin'] })],
      links: [
        {
          id: 'link-twin',
          fileId: 'mf-twin',
          mountPointId: MOUNT_VAULT,
          relativePath: 'photos/twin.webp',
          fileName: 'twin.webp',
          sha256: 'shared-sha',
        },
      ],
      blobs: [{ fileId: 'mf-twin', storedMimeType: 'image/webp', sizeBytes: 10, sha256: 'shared-sha' }],
    });

    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    // Pass 1 saw it first, so it keeps the source it earned there…
    expect(entries[0].source).toBe('generated');
    // …and pass 2 may still tell it which message it hangs beneath.
    expect(entries[0].messageId).toBe('msg-7');
  });

  it('does not hang a repaint twice when it became the character default', async () => {
    const repos = makeRepos({
      chat: chat({ characterAvatars: { [CHAR_A]: { imageId: 'av-promoted' } } }),
      characters: [character({ id: CHAR_A, defaultImageId: 'av-promoted' })],
      files: [file({ id: 'av-promoted', source: 'GENERATED', sha256: 'promoted-sha' })],
    });

    const entries = await listChatGallery(CHAT_ID, repos);

    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('avatar');
  });

  it('sorts newest first and lands portraits at the end of the roll', async () => {
    const repos = makeRepos({
      characters: [character({ id: CHAR_A, defaultImageId: 'p-file', createdAt: '2026-01-01T00:00:00.000Z' })],
      files: [
        file({ id: 'p-file', linkedTo: [] }),
        file({ id: 'newer', createdAt: '2026-09-05T00:00:00.000Z' }),
        file({ id: 'older', createdAt: '2026-09-04T00:00:00.000Z' }),
      ],
    });

    const entries = await listChatGallery(CHAT_ID, repos);
    expect(entries.map((e) => e.id)).toEqual(['newer', 'older', 'p-file']);
  });

  it('skips a removed participant’s portrait', async () => {
    const repos = makeRepos({
      chat: chat({
        participants: [
          { id: 'p-a', type: 'CHARACTER', characterId: CHAR_A, controlledBy: 'llm', status: 'removed' },
        ],
      } as Partial<ChatMetadata>),
      characters: [character({ id: CHAR_A, defaultImageId: 'p-file' })],
      files: [file({ id: 'p-file', linkedTo: [] })],
    });

    expect(await listChatGallery(CHAT_ID, repos)).toEqual([]);
  });

  it('drops non-image files from the roll', async () => {
    const repos = makeRepos({
      files: [
        file({ id: 'notes', mimeType: 'text/markdown', category: 'DOCUMENT' as FileEntry['category'] }),
        file({ id: 'picture' }),
      ],
    });

    const entries = await listChatGallery(CHAT_ID, repos);
    expect(entries.map((e) => e.id)).toEqual(['picture']);
  });

  it('answers with an empty roll for a chat that does not exist', async () => {
    const repos = makeRepos({ chat: null });
    expect(await listChatGallery('no-such-chat', repos)).toEqual([]);
  });
});

describe('getChatGallery', () => {
  it('tallies the roll by source and totals it', async () => {
    const repos = makeRepos({
      characters: [character({ id: CHAR_A, defaultImageId: 'p-file' })],
      files: [
        file({ id: 'p-file', linkedTo: [] }),
        file({ id: 'upload-3' }),
        file({ id: 'gen-3', source: 'GENERATED' }),
      ],
    });

    const result = await getChatGallery(CHAT_ID, repos);

    expect(result.total).toBe(3);
    expect(result.counts).toMatchObject({
      portrait: 1,
      attachment: 1,
      generated: 1,
      'story-background': 0,
      avatar: 0,
      kept: 0,
      inline: 0,
    });
    expect(countBySource(result.entries)).toEqual(result.counts);
  });
});

describe('resolveMessageAttachmentEntries', () => {
  it('skips ids an earlier pass already accounted for', async () => {
    const repos = makeRepos({
      links: [
        {
          id: 'link-a',
          fileId: 'mf-a',
          mountPointId: MOUNT_STORE,
          relativePath: 'a.webp',
          fileName: 'a.webp',
          sha256: 'sha-a',
        },
      ],
      blobs: [{ fileId: 'mf-a', storedMimeType: 'image/webp', sizeBytes: 1, sha256: 'sha-a' }],
    });
    const events = [message({ id: 'm', attachments: ['link-a'] })];

    expect(await resolveMessageAttachmentEntries(events, repos)).toHaveLength(1);
    expect(
      await resolveMessageAttachmentEntries(events, repos, { skipIds: new Set(['link-a']) }),
    ).toHaveLength(0);
  });

  it('resolves an id given as a doc_mount_files id rather than a link id', async () => {
    const repos = makeRepos({
      links: [
        {
          id: 'link-b',
          fileId: 'mf-b',
          mountPointId: MOUNT_STORE,
          relativePath: 'b.webp',
          fileName: 'b.webp',
          sha256: 'sha-b',
        },
      ],
      blobs: [{ fileId: 'mf-b', storedMimeType: 'image/webp', sizeBytes: 1, sha256: 'sha-b' }],
    });

    const resolved = await resolveMessageAttachmentEntries(
      [message({ id: 'm', attachments: ['mf-b'] })],
      repos,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe('link-b');
  });

  it('returns what it has when the walk throws', async () => {
    const repos = makeRepos({});
    (repos.docMountFileLinks.findByIdWithContent as jest.Mock).mockRejectedValue(
      new Error('mount index unavailable'),
    );

    await expect(
      resolveMessageAttachmentEntries([message({ id: 'm', attachments: ['x'] })], repos),
    ).resolves.toEqual([]);
  });
});
