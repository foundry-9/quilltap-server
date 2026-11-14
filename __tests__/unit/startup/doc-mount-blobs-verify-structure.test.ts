/**
 * @jest-environment node
 *
 * The blob table joins the boot-time structural check. The link repository
 * inserts into `doc_mount_blobs` with raw SQL, so on a brand-new instance
 * nothing had created the table before first-startup seeding linked the
 * sample characters' avatars, and both failed with "no such table".
 *
 * Guards: lib/database/repositories/doc-mount-blobs.repository.ts (`verifyStructure`)
 */

import path from 'path';

jest.mock('@/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...log, child: () => log } };
});

let currentDb: unknown = null;
jest.mock('@/lib/database/backends/sqlite/mount-index-guard', () => ({
  requireMountIndexDb: () => {
    if (!currentDb) throw new Error('Mount index database is in degraded mode');
    return currentDb;
  },
}));

import { DocMountBlobsRepository } from '@/lib/database/repositories/doc-mount-blobs.repository';

// The jest moduleNameMapper replaces the bare better-sqlite3 name with a
// no-op mock; require the real binding by absolute path.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

describe('DocMountBlobsRepository.verifyStructure', () => {
  afterEach(() => {
    currentDb = null;
  });

  it('creates the table on a fresh database and passes', async () => {
    const db = new Database(':memory:');
    currentDb = db;
    expect(await new DocMountBlobsRepository().verifyStructure()).toBeNull();
    const table = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='doc_mount_blobs'`).get();
    expect(table).toEqual({ name: 'doc_mount_blobs' });
    db.close();
  });

  it('names a column the IF NOT EXISTS DDL walked past', async () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE doc_mount_blobs (id TEXT, fileId TEXT, sha256 TEXT, sizeBytes INTEGER, storedMimeType TEXT, createdAt TEXT, updatedAt TEXT)');
    currentDb = db;
    expect(await new DocMountBlobsRepository().verifyStructure()).toBe(
      'doc_mount_blobs in mount-index database is missing columns: data',
    );
    db.close();
  });

  it('reports an unavailable database instead of throwing', async () => {
    expect(await new DocMountBlobsRepository().verifyStructure()).toBe(
      'doc_mount_blobs in mount-index database: Mount index database is in degraded mode',
    );
  });
});
