/**
 * @jest-environment node
 *
 * Unit tests for the NDJSON export writer.
 *
 * Approach: mock only the repositories the writer actually touches for the
 * scenarios under test, then assert on the tagged records that come out of
 * the generator / ReadableStream. Framing (envelope/footer), ordering
 * (character → memories), blob chunking, and error propagation are the
 * bug-prone bits we care about.
 *
 * Node environment (not jsdom) — ReadableStream is a Node global but not a
 * jsdom global.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { generateId, createMockCharacter, createMockMemory } from '../fixtures/test-factories';

// Mock the repository factory before importing the module under test.
jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

// Mock the logger so we don't print noise.
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import {
  streamExportRecords,
  createNdjsonStream,
  QTAP_NDJSON_CONTENT_TYPE,
} from '@/lib/export/ndjson-writer';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';

// ============================================================================
// REPO SHAPES
// ============================================================================
// The writer uses a subset of the real repository methods. Building a tiny
// ad-hoc mock (rather than reusing the large createMockUserRepositories()
// fixture) keeps each test's setup obvious.

interface WriterUserRepos {
  characters: {
    findById: jest.Mock;
    findAll: jest.Mock;
    findByIdRaw: jest.Mock;
    findAllRaw: jest.Mock;
  };
  chats: { findById: jest.Mock; findAll: jest.Mock; getMessages: jest.Mock };
  tags: { findById: jest.Mock; findAll: jest.Mock };
  memories: { findByCharacterId: jest.Mock };
  connections: {
    findById: jest.Mock;
    findAll: jest.Mock;
    findApiKeyById: jest.Mock;
  };
  imageProfiles: { findById: jest.Mock; findAll: jest.Mock };
  embeddingProfiles: { findById: jest.Mock; findAll: jest.Mock };
  projects: { findById: jest.Mock; findAll: jest.Mock };
  files: { findAll: jest.Mock };
}

interface WriterGlobalRepos {
  wardrobe: { findByCharacterId: jest.Mock };
  characterPluginData: { getPluginDataMap: jest.Mock };
  roleplayTemplates: { findById: jest.Mock; findAll: jest.Mock };
  docMountPoints: { findById: jest.Mock; findAll: jest.Mock };
  docMountFolders: { findByMountPointId: jest.Mock };
  docMountDocuments: { findByMountPointId: jest.Mock };
  docMountBlobs: { listByMountPoint: jest.Mock; readData: jest.Mock };
  projectDocMountLinks: { findByMountPointId: jest.Mock };
}

function makeUserRepos(): WriterUserRepos {
  return {
    characters: (() => {
      const findById = jest.fn<() => Promise<unknown>>().mockResolvedValue(null);
      const findAll = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
      // Raw variants delegate to the non-raw mocks so existing test setups
      // that configure findById / findAll automatically apply to findByIdRaw
      // and findAllRaw as well.
      const findByIdRaw = jest.fn<(id: string) => Promise<unknown>>()
        .mockImplementation((id: string) => (findById as unknown as (id: string) => Promise<unknown>)(id));
      const findAllRaw = jest.fn<() => Promise<unknown[]>>()
        .mockImplementation(() => (findAll as unknown as () => Promise<unknown[]>)());
      return { findById, findAll, findByIdRaw, findAllRaw };
    })(),
    chats: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      getMessages: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    tags: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    memories: {
      findByCharacterId: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
    connections: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      findApiKeyById: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue(null),
    },
    imageProfiles: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    embeddingProfiles: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    projects: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    files: {
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
  };
}

function makeGlobalRepos(): WriterGlobalRepos {
  return {
    wardrobe: {
      findByCharacterId: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
    characterPluginData: {
      getPluginDataMap: jest
        .fn<() => Promise<Record<string, unknown>>>()
        .mockResolvedValue({}),
    },
    roleplayTemplates: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    docMountPoints: {
      findById: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      findAll: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    },
    docMountFolders: {
      findByMountPointId: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
    docMountDocuments: {
      findByMountPointId: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
    docMountBlobs: {
      listByMountPoint: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([]),
      readData: jest
        .fn<() => Promise<Buffer | null>>()
        .mockResolvedValue(null),
    },
    projectDocMountLinks: {
      findByMountPointId: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
  };
}

// ============================================================================
// HELPERS
// ============================================================================

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

async function readAllBytes(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// ============================================================================
// TESTS
// ============================================================================

describe('ndjson-writer', () => {
  const testUserId = 'user-abc';
  let userRepos: WriterUserRepos;
  let globalRepos: WriterGlobalRepos;

  beforeEach(() => {
    jest.clearAllMocks();
    userRepos = makeUserRepos();
    globalRepos = makeGlobalRepos();
    (getUserRepositories as jest.Mock).mockReturnValue(userRepos);
    (getRepositories as jest.Mock).mockReturnValue(globalRepos);
  });

  describe('QTAP_NDJSON_CONTENT_TYPE', () => {
    it('matches the de-facto NDJSON MIME type', () => {
      expect(QTAP_NDJSON_CONTENT_TYPE).toBe('application/x-ndjson');
    });
  });

  // ==========================================================================
  // Envelope + footer framing (works with empty selection)
  // ==========================================================================

  describe('streamExportRecords() framing', () => {
    it('emits __envelope__ first and __footer__ last for an empty selection', async () => {
      const records = await drain(
        streamExportRecords(testUserId, {
          type: 'tags',
          scope: 'selected',
          selectedIds: [],
        })
      );

      expect(records.length).toBeGreaterThanOrEqual(2);

      const first = records[0] as Record<string, unknown>;
      const last = records[records.length - 1] as Record<string, unknown>;

      expect(first.kind).toBe('__envelope__');
      expect(first.format).toBe('qtap-ndjson');
      expect(first.version).toBe(1);
      expect(first.manifest).toMatchObject({
        format: 'quilltap-export',
        exportType: 'tags',
      });

      expect(last).toMatchObject({ kind: '__footer__', counts: {} });
    });

    it('puts the correct exportType on the envelope manifest', async () => {
      const records = await drain(
        streamExportRecords(testUserId, {
          type: 'characters',
          scope: 'selected',
          selectedIds: [],
        })
      );

      const envelope = records[0] as {
        kind: string;
        manifest: { exportType: string };
      };
      expect(envelope.manifest.exportType).toBe('characters');
    });

    it('populates the footer counts with the emitted record counts', async () => {
      const character = createMockCharacter({ userId: testUserId });
      userRepos.characters.findById.mockImplementation(async (id: string) =>
        id === character.id ? character : null
      );

      const records = await drain(
        streamExportRecords(testUserId, {
          type: 'characters',
          scope: 'selected',
          selectedIds: [character.id],
          includeMemories: false,
        })
      );

      const footer = records[records.length - 1] as {
        kind: string;
        counts: Record<string, number>;
      };
      expect(footer.kind).toBe('__footer__');
      expect(footer.counts.characters).toBe(1);
    });

    it('throws on an unknown export type', async () => {
      await expect(
        drain(
          streamExportRecords(testUserId, {
            // deliberately invalid
            type: 'bogus' as unknown as never,
            scope: 'selected',
            selectedIds: [],
          })
        )
      ).rejects.toThrow(/Unknown export type/);
    });
  });

  // ==========================================================================
  // Character → memory ordering
  // ==========================================================================

  describe('streamExportRecords() - characters with memories', () => {
    it('emits the character record before its memory records', async () => {
      const character = createMockCharacter({ userId: testUserId });
      const mem1 = createMockMemory({ characterId: character.id });
      const mem2 = createMockMemory({ characterId: character.id });

      userRepos.characters.findById.mockImplementation(async (id: string) =>
        id === character.id ? character : null
      );
      userRepos.memories.findByCharacterId.mockResolvedValue([mem1, mem2]);

      const records = (await drain(
        streamExportRecords(testUserId, {
          type: 'characters',
          scope: 'selected',
          selectedIds: [character.id],
          includeMemories: true,
        })
      )) as Array<Record<string, unknown>>;

      const kinds = records.map((r) => r.kind);
      const charIdx = kinds.indexOf('character');
      const firstMemIdx = kinds.indexOf('memory');
      const lastMemIdx = kinds.lastIndexOf('memory');

      expect(charIdx).toBeGreaterThanOrEqual(0);
      expect(firstMemIdx).toBeGreaterThan(charIdx);
      expect(lastMemIdx - firstMemIdx).toBe(1);

      const footer = records[records.length - 1] as {
        counts: Record<string, number>;
      };
      expect(footer.counts.characters).toBe(1);
      expect(footer.counts.memories).toBe(2);
    });
  });

  // ==========================================================================
  // Round-trip via createNdjsonStream()
  // ==========================================================================

  describe('createNdjsonStream()', () => {
    it('returns bytes that round-trip line-by-line back to the generator output', async () => {
      const character = createMockCharacter({ userId: testUserId });
      userRepos.characters.findById.mockImplementation(async (id: string) =>
        id === character.id ? character : null
      );

      const stream = createNdjsonStream(testUserId, {
        type: 'characters',
        scope: 'selected',
        selectedIds: [character.id],
        includeMemories: false,
      });

      const bytes = await readAllBytes(stream);
      const text = new TextDecoder().decode(bytes);

      // Every line must end with a newline.
      expect(text.endsWith('\n')).toBe(true);

      const lines = text.split('\n').filter((l) => l.length > 0);
      const parsed = lines.map((l) => JSON.parse(l));

      expect(parsed.length).toBeGreaterThanOrEqual(3); // envelope + char + footer
      expect(parsed[0].kind).toBe('__envelope__');
      expect(parsed[parsed.length - 1].kind).toBe('__footer__');

      // There should be exactly one character record in the middle.
      const charRecords = parsed.filter((r) => r.kind === 'character');
      expect(charRecords).toHaveLength(1);
      expect(charRecords[0].data.id).toBe(character.id);
    });

    it('propagates generator errors as stream errors', async () => {
      userRepos.characters.findAll.mockRejectedValue(
        new Error('database is on fire')
      );

      const stream = createNdjsonStream(testUserId, {
        type: 'characters',
        scope: 'all',
      });

      await expect(readAllBytes(stream)).rejects.toThrow(
        /database is on fire/
      );
    });
  });

  // ==========================================================================
  // Document store blob chunking
  // ==========================================================================

  describe('streamExportRecords() - document-stores blob chunking', () => {
    // The writer's private BLOB_CHUNK_BYTES is 3 MB. We don't want to hold a
    // 3+ MB Buffer in a unit test, so we stub out Buffer#subarray + length so
    // we can drive the chunking math with a much smaller logical size.
    //
    // Strategy: build a real Buffer whose apparent `length` is larger than
    // BLOB_CHUNK_BYTES but whose underlying bytes are a short repeating
    // pattern. We patch `length` and `subarray` so the writer sees a big
    // blob but the test runs fast.

    function makeFakeLargeBuffer(
      totalBytes: number,
      realBytes: Buffer
    ): Buffer {
      // The writer uses: data.length, data.subarray(start, end), and
      // passes the subarray's .toString('base64') to the NDJSON line.
      const fake = Object.create(Buffer.prototype) as Buffer;
      Object.defineProperty(fake, 'length', { value: totalBytes });
      (fake as unknown as { subarray: (s: number, e: number) => Buffer }).subarray = (
        start: number,
        end: number
      ) => {
        // Return a deterministic slice so the test can reassemble bytes.
        const size = Math.max(0, end - start);
        const out = Buffer.alloc(size);
        for (let i = 0; i < size; i++) {
          out[i] = realBytes[(start + i) % realBytes.length];
        }
        return out;
      };
      return fake;
    }

    it('splits a blob larger than the chunk size into multiple chunk records', async () => {
      const mountPointId = generateId();
      const mountPoint = {
        id: mountPointId,
        name: 'Scraps',
        basePath: '/ignored',
        mountType: 'database' as const,
        includePatterns: [],
        excludePatterns: [],
        enabled: true,
      };
      const blobMeta = {
        id: generateId(),
        mountPointId,
        relativePath: 'art/foo.png',
        originalFileName: 'foo.png',
        originalMimeType: 'image/png',
        storedMimeType: 'image/png',
        sizeBytes: 7 * 1024 * 1024, // 7 MB — will split into 3 chunks of 3 MB
        sha256: 'abc123',
        description: '',
      };

      // 7 MB logical size → chunkCount = ceil(7 MB / 3 MB) = 3.
      const realBytes = Buffer.from('quilltap-blob-pattern');
      const fakeData = makeFakeLargeBuffer(7 * 1024 * 1024, realBytes);

      globalRepos.docMountPoints.findById.mockResolvedValue(mountPoint);
      globalRepos.docMountDocuments.findByMountPointId.mockResolvedValue([]);
      globalRepos.docMountBlobs.listByMountPoint.mockResolvedValue([blobMeta]);
      globalRepos.docMountBlobs.readData.mockResolvedValue(fakeData);
      globalRepos.projectDocMountLinks.findByMountPointId.mockResolvedValue([]);

      const records = (await drain(
        streamExportRecords(testUserId, {
          type: 'document-stores',
          scope: 'selected',
          selectedIds: [mountPointId],
        })
      )) as Array<Record<string, unknown>>;

      const kinds = records.map((r) => r.kind as string);

      // Mount point record precedes the blob metadata record.
      const mpIdx = kinds.indexOf('doc_mount_point');
      const blobIdx = kinds.indexOf('doc_mount_blob');
      expect(mpIdx).toBeGreaterThanOrEqual(0);
      expect(blobIdx).toBeGreaterThan(mpIdx);

      // Blob metadata reports chunkCount > 1.
      const blobRecord = records[blobIdx] as {
        data: { chunkCount: number; sha256: string };
      };
      expect(blobRecord.data.chunkCount).toBeGreaterThan(1);
      expect(blobRecord.data.chunkCount).toBe(3);

      // Exactly chunkCount chunk records immediately follow the blob.
      const chunkRecords = records.filter(
        (r) => (r.kind as string) === 'doc_mount_blob_chunk'
      ) as Array<{
        index: number;
        total: number;
        dataBase64: string;
        sha256: string;
        mountPointId: string;
      }>;
      expect(chunkRecords).toHaveLength(3);
      expect(chunkRecords[0].index).toBe(0);
      expect(chunkRecords[1].index).toBe(1);
      expect(chunkRecords[2].index).toBe(2);
      for (const c of chunkRecords) {
        expect(c.total).toBe(3);
        expect(c.sha256).toBe('abc123');
        expect(c.mountPointId).toBe(mountPointId);
      }

      // Reassembling all base64 chunks yields the original bytes.
      const reassembled = Buffer.concat(
        chunkRecords.map((c) => Buffer.from(c.dataBase64, 'base64'))
      );
      expect(reassembled.length).toBe(7 * 1024 * 1024);

      // Sanity: first byte of reassembled matches our pattern.
      expect(reassembled[0]).toBe(realBytes[0]);
      // And the byte at an arbitrary offset matches the pattern too.
      const offset = 4 * 1024 * 1024 + 5;
      expect(reassembled[offset]).toBe(realBytes[offset % realBytes.length]);
    });

    it('emits exactly one chunk for a small blob', async () => {
      const mountPointId = generateId();
      const mountPoint = {
        id: mountPointId,
        name: 'Tiny',
        basePath: '/ignored',
        mountType: 'database' as const,
        includePatterns: [],
        excludePatterns: [],
        enabled: true,
      };
      const blobMeta = {
        id: generateId(),
        mountPointId,
        relativePath: 'notes/small.bin',
        originalFileName: 'small.bin',
        originalMimeType: 'application/octet-stream',
        storedMimeType: 'application/octet-stream',
        sizeBytes: 16,
        sha256: 'deadbeef',
        description: '',
      };
      const realData = Buffer.from('hello quilltap!!');

      globalRepos.docMountPoints.findById.mockResolvedValue(mountPoint);
      globalRepos.docMountDocuments.findByMountPointId.mockResolvedValue([]);
      globalRepos.docMountBlobs.listByMountPoint.mockResolvedValue([blobMeta]);
      globalRepos.docMountBlobs.readData.mockResolvedValue(realData);
      globalRepos.projectDocMountLinks.findByMountPointId.mockResolvedValue([]);

      const records = (await drain(
        streamExportRecords(testUserId, {
          type: 'document-stores',
          scope: 'selected',
          selectedIds: [mountPointId],
        })
      )) as Array<Record<string, unknown>>;

      const blobMetaRec = records.find(
        (r) => (r.kind as string) === 'doc_mount_blob'
      ) as { data: { chunkCount: number } };
      expect(blobMetaRec.data.chunkCount).toBe(1);

      const chunkRecords = records.filter(
        (r) => (r.kind as string) === 'doc_mount_blob_chunk'
      ) as Array<{ dataBase64: string; index: number; total: number }>;
      expect(chunkRecords).toHaveLength(1);
      expect(chunkRecords[0].index).toBe(0);
      expect(chunkRecords[0].total).toBe(1);
      expect(Buffer.from(chunkRecords[0].dataBase64, 'base64').equals(realData))
        .toBe(true);
    });
  });
});
