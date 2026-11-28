/**
 * @jest-environment node
 *
 * `migrate-remaining-general-to-uploads-v1` is a 4.4 sweep that writes the
 * mount index as it was before the content/link split. `files/_general/` is
 * still where General-scope documents live, so on a database that never ran
 * the sweep, one new General document used to arm it, and its insert into the
 * split `doc_mount_blobs` failed startup on every boot.
 *
 * Guards:
 *   - migrations/scripts/migrate-remaining-general-to-uploads.ts
 *   - migrations/scripts/provision-user-uploads-mount.ts (version label)
 */

import path from 'path';
import fs from 'fs';
import os from 'os';

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../migrations/lib/progress', () => ({
  reportProgress: jest.fn(),
}));

jest.mock('../../../migrations/lib/database-utils', () => ({
  isSQLiteBackend: jest.fn(() => true),
  sqliteTableExists: jest.fn(() => true),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
  tableExists: jest.requireActual('../../../migrations/lib/database-utils').tableExists,
  columnExists: jest.requireActual('../../../migrations/lib/database-utils').columnExists,
}));

jest.mock('../../../lib/paths', () => ({
  getFilesDir: jest.fn(() => (global as Record<string, unknown>).__testFilesDir as string),
  getMountIndexDatabasePath: jest.fn(
    () => (global as Record<string, unknown>).__testMountIndexPath as string
  ),
}));

// Hand the migration the real driver by absolute path (the jest mapper only
// replaces the bare `better-sqlite3` specifier).
jest.mock('better-sqlite3', () =>
  require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
);

import { migrateRemainingGeneralToUploadsMigration } from '../../../migrations/scripts/migrate-remaining-general-to-uploads';
import { provisionUserUploadsMountMigration } from '../../../migrations/scripts/provision-user-uploads-mount';
import { baselineReason } from '../../../migrations/lib/baseline';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

/** `doc_mount_blobs` as it was at 4.4, when the sweep was written. */
const PRE_SPLIT_BLOBS = `
  CREATE TABLE "doc_mount_blobs" (
    "id" TEXT PRIMARY KEY,
    "mountPointId" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BLOB
  );`;

/** `doc_mount_blobs` after `add-doc-mount-file-links-v1`. */
const SPLIT_BLOBS = `
  CREATE TABLE "doc_mount_blobs" (
    "id" TEXT PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storedMimeType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
  );`;

let tmpDir: string;
let mainDb: any;

function makeMountDb(ddl: string): void {
  const file = path.join(tmpDir, 'mount-index.db');
  const db = new Database(file);
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }
  db.exec(ddl);
  db.close();
  (global as Record<string, unknown>).__testMountIndexPath = file;
}

function writeGeneralDocument(): void {
  const generalDir = path.join(tmpDir, 'files', '_general');
  fs.mkdirSync(generalDir, { recursive: true });
  fs.writeFileSync(path.join(generalDir, 'Untitled Document.md'), '');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-general-sweep-'));
  fs.mkdirSync(path.join(tmpDir, 'files'), { recursive: true });
  mainDb = new Database(':memory:');
  mainDb.exec(`CREATE TABLE "files" ("id" TEXT PRIMARY KEY, "storageKey" TEXT);`);
  (global as Record<string, unknown>).__testMainDb = mainDb;
  (global as Record<string, unknown>).__testFilesDir = path.join(tmpDir, 'files');
  (global as Record<string, unknown>).__testMountIndexPath = path.join(tmpDir, 'mount-index.db');
});

afterEach(() => {
  mainDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('migrate-remaining-general-to-uploads-v1 shouldRun', () => {
  it('stands down on the split schema even with a document in _general/', async () => {
    makeMountDb(SPLIT_BLOBS);
    writeGeneralDocument();
    mainDb
      .prepare(`INSERT INTO "files" (id, storageKey) VALUES (?, ?)`)
      .run('f1', '_general/Untitled Document.md');

    await expect(migrateRemainingGeneralToUploadsMigration.shouldRun()).resolves.toBe(false);
  });

  it('still runs on the pre-split schema when _general/ holds a file', async () => {
    makeMountDb(PRE_SPLIT_BLOBS);
    writeGeneralDocument();

    await expect(migrateRemainingGeneralToUploadsMigration.shouldRun()).resolves.toBe(true);
  });

  it('has nothing to do without a _general/ folder', async () => {
    makeMountDb(PRE_SPLIT_BLOBS);

    await expect(migrateRemainingGeneralToUploadsMigration.shouldRun()).resolves.toBe(false);
  });
});

describe('version labels', () => {
  it.each([
    ['migrate-remaining-general-to-uploads-v1', migrateRemainingGeneralToUploadsMigration],
    ['provision-user-uploads-mount-v1', provisionUserUploadsMountMigration],
  ])('%s is labelled with the release it shipped in (4.4.0)', (_id, migration) => {
    expect(migration.introducedInVersion).toBe('4.4.0');
  });

  it('is baselined on a database born after 4.4', () => {
    const reason = baselineReason(migrateRemainingGeneralToUploadsMigration, {
      freshDatabase: false,
      bornVersion: '4.8.1',
      isSettled: () => true,
    });
    expect(reason).toMatch(/introduced in 4\.4\.0/);
  });
});
