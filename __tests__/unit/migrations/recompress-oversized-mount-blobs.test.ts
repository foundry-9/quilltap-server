/**
 * @jest-environment node
 *
 * The `recompress-oversized-mount-blobs-v1` migration re-encodes a bitmap blob
 * to WebP. The `files` row pointing at it must follow the bytes on all three
 * columns — `sha256`, `mimeType` and `size`. The first release wrote only
 * `sha256`, leaving rows that claimed PNG/JPEG at the pre-encode size
 * (repaired after the fact by `repair-files-mime-and-size-from-mount-blob-v2`).
 *
 * Guards:
 *   - migrations/scripts/recompress-oversized-mount-blobs.ts
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { createHash, randomBytes } from 'crypto';
import sharp from 'sharp';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}));

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: jest.fn(() => true),
  tableExists: jest.requireActual('../../../migrations/lib/database-utils').tableExists,
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
  openMountIndexDbIfPresent: jest.requireActual('../../../migrations/lib/database-utils')
    .openMountIndexDbIfPresent,
}));

jest.mock('../../../lib/paths', () => ({
  getMountIndexDatabasePath: jest.fn(
    () => (global as Record<string, unknown>).__testMountIndexPath as string
  ),
}));

// Hand the migration the real driver by absolute path (the jest mapper only
// replaces the bare `better-sqlite3` specifier).
jest.mock('better-sqlite3', () =>
  require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
);

import { recompressOversizedMountBlobsMigration } from '../../../migrations/scripts/recompress-oversized-mount-blobs';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const NOW = '2026-01-01T00:00:00.000Z';

let tmpDir: string;
let mainDb: any;
let mountDb: any;

function makeMountDb(file: string) {
  const db = new Database(file);
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }
  db.exec(`
    CREATE TABLE "doc_mount_blobs" (
      "id" TEXT PRIMARY KEY,
      "fileId" TEXT NOT NULL,
      "sha256" TEXT NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "storedMimeType" TEXT NOT NULL,
      "data" BLOB,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
    CREATE TABLE "doc_mount_files" (
      "id" TEXT PRIMARY KEY,
      "sha256" TEXT NOT NULL,
      "fileSizeBytes" INTEGER NOT NULL,
      "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

function makeMainDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "files" (
      "id" TEXT PRIMARY KEY,
      "sha256" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "storageKey" TEXT
    );
  `);
  return db;
}

/**
 * A noisy PNG: lossless PNG cannot compress noise, lossy WebP can, so the
 * re-encode is reliably smaller and the migration takes it.
 */
async function makePng(): Promise<Buffer> {
  const width = 256;
  const height = 256;
  const raw = randomBytes(width * height * 3);
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-recompress-'));
  const mountPath = path.join(tmpDir, 'quilltap-mount-index.db');
  mainDb = makeMainDb();
  mountDb = makeMountDb(mountPath);
  (global as Record<string, unknown>).__testMainDb = mainDb;
  (global as Record<string, unknown>).__testMountIndexPath = mountPath;
});

afterEach(() => {
  try { mainDb?.close(); } catch { /* ignore */ }
  try { mountDb?.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete (global as Record<string, unknown>).__testMainDb;
  delete (global as Record<string, unknown>).__testMountIndexPath;
});

describe('recompress-oversized-mount-blobs-v1', () => {
  it('moves the files row to the WebP hash, type and size together', async () => {
    const png = await makePng();
    const pngSha = createHash('sha256').update(png).digest('hex');

    mountDb
      .prepare(
        `INSERT INTO doc_mount_blobs (id, fileId, sha256, sizeBytes, storedMimeType, data, createdAt, updatedAt)
         VALUES ('blob-1', 'mf-1', ?, ?, 'image/png', ?, ?, ?)`
      )
      .run(pngSha, png.length, png, NOW, NOW);
    mountDb
      .prepare(`INSERT INTO doc_mount_files (id, sha256, fileSizeBytes, updatedAt) VALUES ('mf-1', ?, ?, ?)`)
      .run(pngSha, png.length, NOW);
    mainDb
      .prepare(`INSERT INTO files (id, sha256, mimeType, size, storageKey) VALUES ('file-1', ?, 'image/png', ?, 'mount-blob:m:blob-1')`)
      .run(pngSha, png.length);

    const result = await recompressOversizedMountBlobsMigration.run();
    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(1);

    // The migration closes its own mount handle; read through ours.
    const blob = mountDb
      .prepare(`SELECT sha256, sizeBytes, storedMimeType FROM doc_mount_blobs WHERE id = 'blob-1'`)
      .get() as { sha256: string; sizeBytes: number; storedMimeType: string };
    expect(blob.storedMimeType).toBe('image/webp');
    expect(blob.sizeBytes).toBeLessThan(png.length);

    const file = mainDb
      .prepare(`SELECT sha256, mimeType, size FROM files WHERE id = 'file-1'`)
      .get() as { sha256: string; mimeType: string; size: number };
    expect(file).toEqual({
      sha256: blob.sha256,
      mimeType: 'image/webp',
      size: blob.sizeBytes,
    });
  });
});
