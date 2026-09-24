/**
 * @jest-environment node
 *
 * A doc-mount chunk's embedding must round-trip as a Float32 BLOB.
 *
 * `DocMountChunksRepository` names `embedding` as a blob column so the
 * collection writes a `Float32Array` as raw bytes and reads it back as one.
 * Without that declaration the collection JSON-serializes the vector into an
 * index-keyed object (`{"0":0.1,"1":0.2,…}`) that no later read can decode:
 * the row fails the chunk schema, is dropped from every `find*`, and semantic
 * retrieval silently loses the chunk. The dedicated-db base class refactor
 * dropped the declaration once (PR #70 review); this pins it against the real
 * repository on a real in-memory SQLite database.
 */

import path from 'path';
import { randomUUID } from 'crypto';

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

// Root package.json aliases better-sqlite3-multiple-ciphers as better-sqlite3,
// and the jest moduleNameMapper replaces both bare names with a no-op mock.
// Require the real binding by absolute path (which the mapper's `^name$`
// patterns don't match) so this suite exercises actual SQL.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

import { DocMountChunksRepository } from '@/lib/database/repositories/doc-mount-chunks.repository';

let db: any;
let repo: DocMountChunksRepository;

/**
 * The on-disk BLOB is the self-describing quantized format
 * (`lib/embedding/float32-conversion.ts`), so a read-back vector matches the
 * written one to within the quantization step, not bit for bit.
 */
function expectVectorClose(actual: unknown, expected: Float32Array): void {
  expect(actual).toBeInstanceOf(Float32Array);
  const got = Array.from(actual as Float32Array);
  expect(got).toHaveLength(expected.length);
  got.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThan(0.01));
}

const MOUNT = randomUUID();
const LINK = randomUUID();

beforeEach(() => {
  db = new Database(':memory:');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;
  repo = new DocMountChunksRepository();
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

async function seedChunk(chunkIndex = 0) {
  return repo.create({
    linkId: LINK,
    mountPointId: MOUNT,
    chunkIndex,
    content: `chunk ${chunkIndex}`,
    tokenCount: 2,
    headingContext: null,
    embedding: null,
  });
}

describe('doc_mount_chunks embedding round-trip', () => {
  it('stores a Float32Array set through updateEmbedding as a BLOB and reads it back', async () => {
    const chunk = await seedChunk();
    const vector = new Float32Array([0.25, -0.5, 0.75, 1]);

    await repo.updateEmbedding(chunk.id, vector);

    const raw = db.prepare('SELECT embedding FROM doc_mount_chunks WHERE id = ?').get(chunk.id);
    expect(Buffer.isBuffer(raw.embedding)).toBe(true);

    const [read] = await repo.findByLinkId(LINK);
    expect(read).toBeDefined();
    expectVectorClose(read.embedding, vector);
  });

  it('stores a Float32Array supplied at create time as a BLOB', async () => {
    const vector = new Float32Array([0.1, 0.2, 0.3]);
    const chunk = await repo.create({
      linkId: LINK,
      mountPointId: MOUNT,
      chunkIndex: 0,
      content: 'embedded at birth',
      tokenCount: 3,
      headingContext: null,
      embedding: vector,
    });

    const raw = db.prepare('SELECT embedding FROM doc_mount_chunks WHERE id = ?').get(chunk.id);
    expect(Buffer.isBuffer(raw.embedding)).toBe(true);

    const found = await repo.findById(chunk.id);
    expectVectorClose(found?.embedding, vector);
  });

  it('surfaces the embedded chunk to the retrieval walk and counts it', async () => {
    const embedded = await seedChunk(0);
    await seedChunk(1);
    await repo.updateEmbedding(embedded.id, new Float32Array([1, 0, 0]));

    const withEmbeddings = await repo.findAllWithEmbeddingsByMountPointIds([MOUNT]);
    expect(withEmbeddings.map(c => c.id)).toEqual([embedded.id]);

    const counts = await repo.countEmbeddedByMountPointIds([MOUNT]);
    expect(counts.get(MOUNT)).toBe(1);
  });
});
