/**
 * @jest-environment node
 *
 * #189 — deleting a document must take its chunks (and their embeddings) with
 * it on a mount index whose tables came from the schema translator, which emits
 * no foreign keys, so the `ON DELETE CASCADE` the delete path used to rely on is
 * not there.
 *
 * #191 — clearing one store's documents by mount point must not destroy content
 * rows another store still links. Content is content-addressed and shared
 * across stores by design.
 *
 * Strategy mirrors doc-mount-file-links-blobless-gc.test.ts: the real
 * repositories against a real in-memory SQLite DB whose tables they mint
 * lazily from their Zod schemas (generateDDL — the no-FK shape).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

// Load the real binding by ABSOLUTE root path (see project_jest_real_sqlite_driver_load).
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

import { logger } from '@/lib/logger';
import { DocMountFileLinksRepository } from '@/lib/database/repositories/doc-mount-file-links.repository';
import { DocMountFilesRepository } from '@/lib/database/repositories/doc-mount-files.repository';
import { DocMountFoldersRepository } from '@/lib/database/repositories/doc-mount-folders.repository';
import { DocMountDocumentsRepository } from '@/lib/database/repositories/doc-mount-documents.repository';
import { DocMountChunksRepository } from '@/lib/database/repositories/doc-mount-chunks.repository';
import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';
import { reapOrphanedStoreChildren } from '@/lib/mount-index/orphan-store-reaper';

const sha = (s: string) => createHash('sha256').update(s, 'utf-8').digest('hex');

const SHARED = '# Lore\nThe same words, in two stores.';
const MP_A = randomUUID();
const MP_B = randomUUID();

let db: any;
let links: DocMountFileLinksRepository;

async function writeDoc(mountPointId: string, relativePath: string, content: string) {
  const { link } = await links.linkDocumentContent({
    mountPointId,
    relativePath,
    fileName: path.posix.basename(relativePath),
    folderId: null,
    fileType: 'markdown',
    content,
    contentSha256: sha(content),
    plainTextLength: content.length,
    fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
  });
  return link;
}

function addChunk(linkId: string, mountPointId: string): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO doc_mount_chunks (id, linkId, mountPointId, chunkIndex, content, tokenCount, embedding, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, 'chunk text', 2, ?, ?, ?)`
  ).run(id, linkId, mountPointId, Buffer.from([1, 2, 3, 4]), now, now);
  return id;
}

const count = (sql: string, ...params: unknown[]): number =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${sql}`).get(...params) as { c: number }).c;

function contentOf(linkId: string): string | undefined {
  const row = db.prepare(
    `SELECT d.content AS content FROM doc_mount_file_links l
     JOIN doc_mount_documents d ON d.fileId = l.fileId
     WHERE l.id = ?`
  ).get(linkId) as { content: string } | undefined;
  return row?.content;
}

beforeEach(async () => {
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});

  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = db;
  (globalThis as Record<string, unknown>).__quilltapMountIndexDegraded = false;

  links = new DocMountFileLinksRepository();
  await new DocMountFilesRepository().findBySha256('seed');
  await new DocMountFoldersRepository().findByMountPointId('seed');
  await new DocMountDocumentsRepository().findByFileId('seed');
  await new DocMountChunksRepository().findByLinkId('seed');
  await links.findByMountPointId('seed');
});

afterEach(() => {
  jest.restoreAllMocks();
  try { db.close(); } catch { /* ignore */ }
  (globalThis as Record<string, unknown>).__quilltapMountIndexDatabase = undefined;
});

describe('#189 — chunks leave with their document', () => {
  it('the generated chunks table carries no foreign key (the precondition)', () => {
    expect(db.prepare('PRAGMA foreign_key_list(doc_mount_chunks)').all()).toEqual([]);
  });

  it('deleteWithGC removes the link\'s chunks', async () => {
    const link = await writeDoc(MP_A, 'gone.md', SHARED);
    addChunk(link.id, MP_A);
    expect(count('doc_mount_chunks WHERE linkId = ?', link.id)).toBe(1);

    await links.deleteWithGC(link.id);

    expect(count('doc_mount_chunks WHERE linkId = ?', link.id)).toBe(0);
  });

  it('the reaper collects chunks already orphaned by an earlier delete', async () => {
    db.exec('CREATE TABLE IF NOT EXISTS doc_mount_points (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO doc_mount_points (id) VALUES (?)').run(MP_A);
    db.exec('CREATE TABLE IF NOT EXISTS doc_mount_folders (id TEXT PRIMARY KEY, mountPointId TEXT)');
    const live = await writeDoc(MP_A, 'live.md', SHARED);
    addChunk(live.id, MP_A);
    addChunk(randomUUID(), MP_A); // its link was deleted before the fix

    const swept = reapOrphanedStoreChildren(db);

    expect(swept.chunks).toBe(1);
    expect(count('doc_mount_chunks')).toBe(1);
    expect(count('doc_mount_chunks WHERE linkId = ?', live.id)).toBe(1);
  });
});

describe('#191 — clearing one store keeps content another store links', () => {
  async function seedShared() {
    const a = await writeDoc(MP_A, 'lore.md', SHARED);
    const b = await writeDoc(MP_B, 'lore.md', SHARED);
    expect(a.fileId).toBe(b.fileId); // content-addressed → one shared row
    addChunk(a.id, MP_A);
    addChunk(b.id, MP_B);
    return { a, b };
  }

  it.each([
    ['docMountFileLinks', () => links.deleteByMountPointId(MP_A)],
    ['docMountFiles', () => new DocMountFilesRepository().deleteByMountPointId(MP_A)],
    ['docMountBlobs', () => new DocMountBlobsRepository().deleteByMountPointId(MP_A)],
    ['docMountDocuments', () => new DocMountDocumentsRepository().deleteByMountPointId(MP_A)],
  ])('%s.deleteByMountPointId leaves the other store readable', async (_name, run) => {
    const { b } = await seedShared();

    await run();

    expect(contentOf(b.id)).toBe(SHARED);
    expect(count('doc_mount_chunks WHERE linkId = ?', b.id)).toBe(1);
  });

  it('clearing a store\'s links drops its chunks and its exclusive content', async () => {
    const { a } = await seedShared();
    const solo = await writeDoc(MP_A, 'solo.md', '# Mine alone');

    await links.deleteByMountPointId(MP_A);

    expect(count('doc_mount_chunks WHERE mountPointId = ?', MP_A)).toBe(0);
    expect(count('doc_mount_file_links WHERE mountPointId = ?', MP_A)).toBe(0);
    expect(count('doc_mount_files WHERE id = ?', solo.fileId)).toBe(0);
    expect(count('doc_mount_documents WHERE fileId = ?', solo.fileId)).toBe(0);
    expect(count('doc_mount_files WHERE id = ?', a.fileId)).toBe(1);
  });
});
