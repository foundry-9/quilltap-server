/**
 * @jest-environment node
 *
 * Exercise of the `clear-generated-image-placeholder-descriptions-v1` migration
 * against in-memory SQLite databases (bug 132).
 *
 * The story-background and wardrobe-portrait jobs stamped a label onto the
 * `description` column of every image they produced — the column describe_image
 * reads first — so a character asking what a backdrop showed was told its chat
 * title. This migration clears those labels so the rows fall through to the
 * generation prompt, and to a vision call where there is none.
 *
 * Guards:
 *   - migrations/scripts/clear-generated-image-placeholder-descriptions.ts
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
  getSQLiteTableColumns: jest.fn(() => [{ name: 'description' }, { name: 'source' }]),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
  // The migration owns and closes the connection it is handed, exactly as it
  // would a real file — so each call opens a fresh one against the temp file.
  openMountIndexDbIfPresent: jest.fn(() => {
    const file = (global as Record<string, unknown>).__testMountPath as string | undefined;
    if (!file) return null;
    const Db = require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'));
    return new Db(file);
  }),
}));

import { clearGeneratedImagePlaceholderDescriptionsMigration as migration } from '../../../migrations/scripts/clear-generated-image-placeholder-descriptions';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const NOW = '2026-01-01T00:00:00.000Z';

let tmpDir: string;
let mountPath: string;
let mainDb: any;

function makeMainDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "files" (
      "id" TEXT PRIMARY KEY,
      "source" TEXT NOT NULL,
      "description" TEXT,
      "generationPrompt" TEXT,
      "updatedAt" TEXT NOT NULL
    );
  `);
  return db;
}

function makeMountDb(file: string) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE "doc_mount_file_links" (
      "id" TEXT PRIMARY KEY,
      "originalMimeType" TEXT,
      "description" TEXT NOT NULL DEFAULT ''
    );
  `);
  db.close();
}

/** A short-lived handle on the mount file; the migration closes the ones it opens. */
function withMountDb<T>(fn: (db: any) => T): T {
  const db = new Database(mountPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function seedFile(id: string, source: string, description: string | null) {
  mainDb
    .prepare(`INSERT INTO "files" (id, source, description, generationPrompt, updatedAt) VALUES (?, ?, ?, 'a prompt', ?)`)
    .run(id, source, description, NOW);
}

function seedLink(id: string, mime: string, description: string) {
  withMountDb((db) =>
    db
      .prepare(`INSERT INTO "doc_mount_file_links" (id, originalMimeType, description) VALUES (?, ?, ?)`)
      .run(id, mime, description)
  );
}

const fileDescription = (id: string): string | null =>
  (mainDb.prepare(`SELECT description FROM "files" WHERE id = ?`).get(id) as { description: string | null }).description;

const fileUpdatedAt = (id: string): string =>
  (mainDb.prepare(`SELECT updatedAt FROM "files" WHERE id = ?`).get(id) as { updatedAt: string }).updatedAt;

const linkDescription = (id: string): string =>
  withMountDb(
    (db) =>
      (db.prepare(`SELECT description FROM "doc_mount_file_links" WHERE id = ?`).get(id) as { description: string })
        .description
  );

beforeEach(() => {
  jest.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-clear-placeholders-'));
  mountPath = path.join(tmpDir, 'quilltap-mount-index.db');
  mainDb = makeMainDb();
  makeMountDb(mountPath);
  (global as Record<string, unknown>).__testMainDb = mainDb;
  (global as Record<string, unknown>).__testMountPath = mountPath;
});

afterEach(() => {
  try { mainDb?.close(); } catch { /* ignore */ }
  delete (global as Record<string, unknown>).__testMainDb;
  delete (global as Record<string, unknown>).__testMountPath;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('clear-generated-image-placeholder-descriptions-v1', () => {
  it('clears both label shapes from generated files and their links', async () => {
    seedFile('bg', 'GENERATED', 'Story background for: Bite Order and Kisses');
    seedFile('portrait', 'GENERATED', 'Lady Ashcombe — wardrobe portrait');
    seedLink('bg-link', 'image/webp', 'Story background for: Bite Order and Kisses');
    seedLink('portrait-link', 'image/webp', 'Lady Ashcombe — wardrobe portrait');

    expect(await migration.shouldRun()).toBe(true);
    const result = await migration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(4);
    expect(fileDescription('bg')).toBeNull();
    expect(fileDescription('portrait')).toBeNull();
    expect(fileUpdatedAt('bg')).not.toBe(NOW);
    expect(linkDescription('bg-link')).toBe('');
    expect(linkDescription('portrait-link')).toBe('');
  });

  it('leaves real descriptions, uploads, and non-image links alone', async () => {
    seedFile('real', 'GENERATED', 'A dim, amber-lit bedroom in an Art Deco lodge.');
    seedFile('upload', 'UPLOADED', 'Story background for: a user who titled their upload this way');
    seedFile('blank', 'GENERATED', null);
    seedLink('doc', 'text/markdown', 'Story background for: the chapter about the backdrop');
    seedLink('real-link', 'image/webp', 'Two women beside a pool.');

    expect(await migration.shouldRun()).toBe(false);
    const result = await migration.run();

    expect(result.itemsAffected).toBe(0);
    expect(fileDescription('real')).toBe('A dim, amber-lit bedroom in an Art Deco lodge.');
    expect(fileDescription('upload')).toMatch(/^Story background for/);
    expect(fileUpdatedAt('upload')).toBe(NOW);
    expect(linkDescription('doc')).toMatch(/^Story background for/);
    expect(linkDescription('real-link')).toBe('Two women beside a pool.');
  });

  it('runs for a label that survives only on the link side', async () => {
    seedFile('bg', 'GENERATED', null);
    seedLink('bg-link', 'image/webp', 'Story background for: Bite Order and Kisses');

    expect(await migration.shouldRun()).toBe(true);
    const result = await migration.run();

    expect(result.itemsAffected).toBe(1);
    expect(linkDescription('bg-link')).toBe('');
  });

  it('clears the files side even when there is no mount index yet', async () => {
    delete (global as Record<string, unknown>).__testMountPath;
    seedFile('bg', 'GENERATED', 'Story background for: Bite Order and Kisses');

    const result = await migration.run();

    expect(result.success).toBe(true);
    expect(result.itemsAffected).toBe(1);
    expect(result.message).toMatch(/mount index not inspected/);
    expect(fileDescription('bg')).toBeNull();
  });

  it('is idempotent', async () => {
    seedFile('bg', 'GENERATED', 'Story background for: Bite Order and Kisses');
    await migration.run();

    expect(await migration.shouldRun()).toBe(false);
    const second = await migration.run();
    expect(second.itemsAffected).toBe(0);
  });
});
