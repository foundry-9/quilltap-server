/**
 * @jest-environment node
 *
 * End-to-end exercise of the `collapse-duplicate-avatar-rolls-v1` migration
 * against real SQLite databases.
 *
 * This migration deletes user data — duplicate rolls are not redundant bytes,
 * they are different seeds of one prompt — so the things worth proving are the
 * ones that would be expensive to discover in the field: that the survivor is
 * the newest roll, that every reference to a deleted roll is repointed before
 * the bytes go (chats, character overrides, and the Lantern announcement that
 * both attaches the file and quotes its uuid inline), that a character's
 * canonical portrait is never collateral, and that an interrupted pass can be
 * re-run.
 *
 * Guards:
 *   - migrations/scripts/collapse-duplicate-avatar-rolls-v1.ts
 */

import path from 'path';
import fs from 'fs';
import os from 'os';

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
  sqliteTableExists: jest.fn(() => true),
  sqliteColumnExists: jest.fn(() => true),
  getSQLiteDatabase: jest.fn(() => (global as Record<string, unknown>).__testMainDb),
  openMountIndexDbIfPresent: jest.requireActual('../../../migrations/lib/database-utils')
    .openMountIndexDbIfPresent,
}));

jest.mock('../../../lib/paths', () => ({
  getMountIndexDatabasePath: jest.fn(
    () => (global as Record<string, unknown>).__testMountIndexPath as string
  ),
}));

// The root package.json aliases better-sqlite3-multiple-ciphers as
// better-sqlite3, and the jest moduleNameMapper replaces both bare names with a
// no-op mock. Hand the migration the real binding by absolute path (which the
// mapper's `^name$` patterns don't match).
jest.mock('better-sqlite3', () =>
  require(require('path').join(process.cwd(), 'node_modules', 'better-sqlite3'))
);

import { collapseDuplicateAvatarRollsMigration } from '../../../migrations/scripts/collapse-duplicate-avatar-rolls-v1';
import { deriveLegacyAvatarCacheKey } from '../../../lib/wardrobe/avatar-cache';
import { logger as migrationLogger } from '../../../migrations/lib/logger';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const MOUNT = 'mount-1';
/** The character's own vault, where the photo album lives — a different mount. */
const VAULT_MOUNT = 'vault-1';
const CHARACTER = 'char-1';
const PROMPT_A = 'Solo portrait of a single woman: Friday. Wearing a green coat.';
const PROMPT_B = 'Solo portrait of a single woman: Friday. Wearing a red scarf.';
const MODEL = 'flux-dev';

let tmpDir: string;
let mainDb: any;
let mountDb: any;

function makeMainDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "files" (
      "id" TEXT PRIMARY KEY,
      "originalFilename" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "generationPrompt" TEXT,
      "generationModel" TEXT,
      "generationKey" TEXT,
      "storageKey" TEXT,
      "createdAt" TEXT NOT NULL
    );
    CREATE TABLE "chats" ("id" TEXT PRIMARY KEY, "characterAvatars" TEXT);
    CREATE TABLE "characters" (
      "id" TEXT PRIMARY KEY,
      "avatarOverrides" TEXT,
      "defaultImageId" TEXT
    );
    CREATE TABLE "chat_messages" (
      "id" TEXT PRIMARY KEY,
      "attachments" TEXT,
      "content" TEXT,
      "opaqueContent" TEXT
    );
  `);
  return db;
}

/**
 * The real mount-index database is SQLCipher-encrypted under
 * `ENCRYPTION_MASTER_PEPPER` and the migration opens it with that key, so this
 * one is created the same way — otherwise the test would exercise the abort
 * path rather than the collapse.
 */
function makeMountDb(file: string) {
  const db = new Database(file);
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }
  db.exec(`
    CREATE TABLE "doc_mount_files" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "doc_mount_blobs" ("id" TEXT PRIMARY KEY, "fileId" TEXT NOT NULL);
    CREATE TABLE "doc_mount_documents" ("id" TEXT PRIMARY KEY, "fileId" TEXT NOT NULL);
    CREATE TABLE "doc_mount_file_links" (
      "id" TEXT PRIMARY KEY,
      "fileId" TEXT NOT NULL,
      "mountPointId" TEXT NOT NULL,
      "relativePath" TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE "doc_mount_chunks" ("id" TEXT PRIMARY KEY, "linkId" TEXT NOT NULL);
  `);
  return db;
}

/** Seed one avatar roll: a files row plus its vault link/blob/file/chunk. */
function seedRoll(id: string, prompt: string, createdAt: string, opts: { model?: string } = {}) {
  const blobId = `blob-${id}`;
  mainDb
    .prepare(
      `INSERT INTO "files" (id, originalFilename, category, generationPrompt, generationModel, generationKey, storageKey, createdAt)
       VALUES (?, ?, 'IMAGE', ?, ?, NULL, ?, ?)`
    )
    .run(
      id,
      `avatar_Friday_${id}.webp`,
      prompt,
      opts.model ?? MODEL,
      `mount-blob:${MOUNT}:${blobId}`,
      createdAt
    );

  const contentId = `content-${id}`;
  mountDb.prepare('INSERT INTO "doc_mount_files" (id) VALUES (?)').run(contentId);
  mountDb.prepare('INSERT INTO "doc_mount_blobs" (id, fileId) VALUES (?, ?)').run(blobId, contentId);
  mountDb
    .prepare(
      'INSERT INTO "doc_mount_file_links" (id, fileId, mountPointId, relativePath) VALUES (?, ?, ?, ?)'
    )
    .run(`link-${id}`, contentId, MOUNT, `character-avatars/avatar_Friday_${id}.webp`);
  mountDb
    .prepare('INSERT INTO "doc_mount_chunks" (id, linkId) VALUES (?, ?)')
    .run(`chunk-${id}`, `link-${id}`);
}

/**
 * Copy a seeded roll into a character's album: a second link, in the
 * character's own vault, over the *same* content row. This is what "the
 * operator kept this plate" looks like in the mount index.
 */
function keepInAlbum(id: string, mountPointId = VAULT_MOUNT) {
  mountDb
    .prepare(
      'INSERT INTO "doc_mount_file_links" (id, fileId, mountPointId, relativePath) VALUES (?, ?, ?, ?)'
    )
    .run(`album-${id}`, `content-${id}`, mountPointId, `photos/kept-${id}.webp`);
}

const fileIds = (): string[] =>
  (mainDb.prepare('SELECT id FROM files ORDER BY id').all() as Array<{ id: string }>).map(
    (r) => r.id
  );

const keyOf = (id: string): string | null =>
  (mainDb.prepare('SELECT generationKey FROM files WHERE id = ?').get(id) as
    | { generationKey: string | null }
    | undefined)?.generationKey ?? null;

beforeEach(() => {
  jest.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collapse-avatars-'));
  const mountPath = path.join(tmpDir, 'quilltap-mount-index.db');

  mainDb = makeMainDb();
  mountDb = makeMountDb(mountPath);

  (global as Record<string, unknown>).__testMainDb = mainDb;
  (global as Record<string, unknown>).__testMountIndexPath = mountPath;
});

afterEach(() => {
  mainDb?.close();
  mountDb?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('collapse-duplicate-avatar-rolls-v1', () => {
  it('keeps the newest roll of a configuration and deletes the rest', async () => {
    seedRoll('old', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('mid', PROMPT_A, '2026-03-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    const result = await collapseDuplicateAvatarRollsMigration.run();

    expect(result.success).toBe(true);
    expect(fileIds()).toEqual(['new']);
    expect(keyOf('new')).toBe(
      deriveLegacyAvatarCacheKey({ modelName: MODEL, prompt: PROMPT_A })
    );
  });

  it('keeps configurations apart — a different outfit is a different key', async () => {
    seedRoll('coat-old', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('coat-new', PROMPT_A, '2026-06-01T00:00:00.000Z');
    seedRoll('scarf', PROMPT_B, '2026-02-01T00:00:00.000Z');

    await collapseDuplicateAvatarRollsMigration.run();

    expect(fileIds()).toEqual(['coat-new', 'scarf']);
    expect(keyOf('coat-new')).not.toBe(keyOf('scarf'));
  });

  it('treats the same prompt on a different model as a different configuration', async () => {
    seedRoll('flux', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('sdxl', PROMPT_A, '2026-06-01T00:00:00.000Z', { model: 'sdxl' });

    await collapseDuplicateAvatarRollsMigration.run();

    expect(fileIds()).toEqual(['flux', 'sdxl']);
  });

  it('keys a lone roll without deleting it, referenced or not', async () => {
    // An orphaned roll is a perfectly good cache entry for its configuration.
    seedRoll('only', PROMPT_A, '2026-01-01T00:00:00.000Z');

    const result = await collapseDuplicateAvatarRollsMigration.run();

    expect(fileIds()).toEqual(['only']);
    expect(keyOf('only')).not.toBeNull();
    expect(result.itemsAffected).toBe(1);
  });

  it('repoints chat avatars and character overrides to the survivor', async () => {
    seedRoll('old', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    mainDb
      .prepare('INSERT INTO "chats" (id, characterAvatars) VALUES (?, ?)')
      .run(
        'chat-1',
        JSON.stringify({ [CHARACTER]: { imageId: 'old', generatedAt: 'x', afterMessageCount: 4 } })
      );
    mainDb
      .prepare('INSERT INTO "characters" (id, avatarOverrides, defaultImageId) VALUES (?, ?, NULL)')
      .run(CHARACTER, JSON.stringify([{ chatId: 'chat-1', imageId: 'old' }]));

    await collapseDuplicateAvatarRollsMigration.run();

    const chat = JSON.parse(
      (mainDb.prepare('SELECT characterAvatars FROM chats WHERE id = ?').get('chat-1') as any)
        .characterAvatars
    );
    expect(chat[CHARACTER].imageId).toBe('new');
    // Sibling fields survive the rewrite.
    expect(chat[CHARACTER].afterMessageCount).toBe(4);

    const character = JSON.parse(
      (mainDb.prepare('SELECT avatarOverrides FROM characters WHERE id = ?').get(CHARACTER) as any)
        .avatarOverrides
    );
    expect(character).toEqual([{ chatId: 'chat-1', imageId: 'new' }]);
  });

  it('repoints a Lantern announcement and the uuid it quotes inline', async () => {
    seedRoll('old', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    mainDb
      .prepare(
        'INSERT INTO "chat_messages" (id, attachments, content, opaqueContent) VALUES (?, ?, ?, ?)'
      )
      .run(
        'msg-1',
        JSON.stringify(['old']),
        'The new one is attached here, catalogued under uuid `old`, should anyone care to look.',
        'A new portrait has been commissioned, catalogued under uuid `old`.'
      );

    await collapseDuplicateAvatarRollsMigration.run();

    const msg = mainDb.prepare('SELECT * FROM chat_messages WHERE id = ?').get('msg-1') as any;
    expect(JSON.parse(msg.attachments)).toEqual(['new']);
    expect(msg.content).toContain('uuid `new`');
    expect(msg.content).not.toContain('`old`');
    expect(msg.opaqueContent).toContain('uuid `new`');
  });

  it('leaves unrelated attachments and messages alone', async () => {
    seedRoll('old', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    mainDb
      .prepare(
        'INSERT INTO "chat_messages" (id, attachments, content, opaqueContent) VALUES (?, ?, ?, NULL)'
      )
      .run('msg-other', JSON.stringify(['some-other-file']), 'untouched');

    await collapseDuplicateAvatarRollsMigration.run();

    const msg = mainDb.prepare('SELECT * FROM chat_messages WHERE id = ?').get('msg-other') as any;
    expect(JSON.parse(msg.attachments)).toEqual(['some-other-file']);
    expect(msg.content).toBe('untouched');
  });

  it('takes the deleted roll\'s chunks, link, blob and content row with it', async () => {
    seedRoll('old', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    await collapseDuplicateAvatarRollsMigration.run();

    const count = (table: string, column: string, value: string) =>
      (mountDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as any).n;

    expect(count('doc_mount_blobs', 'id', 'blob-old')).toBe(0);
    expect(count('doc_mount_file_links', 'id', 'link-old')).toBe(0);
    expect(count('doc_mount_chunks', 'linkId', 'link-old')).toBe(0);
    expect(count('doc_mount_files', 'id', 'content-old')).toBe(0);

    // The survivor's vault rows are untouched.
    expect(count('doc_mount_blobs', 'id', 'blob-new')).toBe(1);
    expect(count('doc_mount_chunks', 'linkId', 'link-new')).toBe(1);
  });

  // A roll the operator copied into a character's album is two links over one
  // set of bytes. Collapsing the roll is not a reason to take the copy they
  // kept — and nothing in the main DB records an album link, so the loss would
  // leave no trace to notice or undo.
  describe('an album copy is never collateral', () => {
    it('keeps the album photo and its bytes when the roll it came from is collapsed', async () => {
      seedRoll('old', PROMPT_A, '2026-01-01T00:00:00.000Z');
      seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');
      keepInAlbum('old');

      await collapseDuplicateAvatarRollsMigration.run();

      const count = (table: string, column: string, value: string) =>
        (mountDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as any)
          .n;

      // The roll's own link and its chunks go.
      expect(count('doc_mount_file_links', 'id', 'link-old')).toBe(0);
      expect(count('doc_mount_chunks', 'linkId', 'link-old')).toBe(0);

      // The album's link, and the bytes behind it, stay.
      expect(count('doc_mount_file_links', 'id', 'album-old')).toBe(1);
      expect(count('doc_mount_blobs', 'id', 'blob-old')).toBe(1);
      expect(count('doc_mount_files', 'id', 'content-old')).toBe(1);

      // The duplicate cache row is still gone — this is about the bytes, not
      // about keeping a redundant configuration.
      expect(fileIds()).toEqual(['new']);
    });

    it('still frees the bytes of a roll nobody kept', async () => {
      seedRoll('kept', PROMPT_A, '2026-01-01T00:00:00.000Z');
      seedRoll('unkept', PROMPT_A, '2026-02-01T00:00:00.000Z');
      seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');
      keepInAlbum('kept');

      const result = await collapseDuplicateAvatarRollsMigration.run();

      const blobs = (id: string) =>
        (mountDb.prepare('SELECT COUNT(*) AS n FROM doc_mount_blobs WHERE id = ?').get(id) as any).n;

      expect(blobs('blob-kept')).toBe(1);
      expect(blobs('blob-unkept')).toBe(0);
      // Only the roll whose bytes actually went is counted as an image freed.
      expect(result.message).toContain('1 images freed');
    });

    it('drops the files row of a roll whose only surviving link is the album copy', async () => {
      seedRoll('orphaned', PROMPT_A, '2026-01-01T00:00:00.000Z');
      seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');
      keepInAlbum('orphaned');
      // The roll's own link is already gone; only the kept copy remains.
      mountDb.prepare('DELETE FROM "doc_mount_file_links" WHERE id = ?').run('link-orphaned');

      await collapseDuplicateAvatarRollsMigration.run();

      expect(fileIds()).toEqual(['new']);
      expect(
        (mountDb.prepare('SELECT COUNT(*) AS n FROM doc_mount_file_links WHERE id = ?').get('album-orphaned') as any).n
      ).toBe(1);
      expect(
        (mountDb.prepare('SELECT COUNT(*) AS n FROM doc_mount_blobs WHERE id = ?').get('blob-orphaned') as any).n
      ).toBe(1);
    });
  });

  it('reports the rolls it kept, not only the ones it collapsed', async () => {
    seedRoll('portrait', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    mainDb
      .prepare('INSERT INTO "characters" (id, avatarOverrides, defaultImageId) VALUES (?, NULL, ?)')
      .run(CHARACTER, 'link-portrait');

    const result = await collapseDuplicateAvatarRollsMigration.run();

    // The count outlives the logs in `migrations_state`; without it a later
    // reader has to rediscover the protected branch from the residue.
    expect(result.message).toContain('kept 1 roll still serving as a character portrait');
  });

  // The invariant is only checkable in-pass. `characters.defaultImageId` is
  // mutable, so reconstructing "was this keep legitimate?" from a later
  // snapshot reports a false positive for every portrait that has since moved.
  describe('the duplicate-key census', () => {
    const censusWarnings = () =>
      (migrationLogger.warn as jest.Mock).mock.calls.filter(([message]) =>
        String(message).includes('share a generation key')
      );

    it('says nothing about a duplicate it chose to keep', async () => {
      seedRoll('portrait', PROMPT_A, '2026-01-01T00:00:00.000Z');
      seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

      mainDb
        .prepare('INSERT INTO "characters" (id, avatarOverrides, defaultImageId) VALUES (?, NULL, ?)')
        .run(CHARACTER, 'link-portrait');

      await collapseDuplicateAvatarRollsMigration.run();

      expect(censusWarnings()).toHaveLength(0);
    });

    it('names a duplicate key this pass did not double up on purpose', async () => {
      seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

      // Already carrying the survivor's key, but outside the pass's own
      // predicate — so it is never grouped, never a victim, and survives
      // sharing a key with nothing to excuse it.
      mainDb
        .prepare(
          `INSERT INTO "files" (id, originalFilename, category, generationPrompt, generationModel, generationKey, storageKey, createdAt)
           VALUES ('stowaway', 'background_scene.webp', 'IMAGE', ?, ?, ?, NULL, '2026-01-01T00:00:00.000Z')`
        )
        .run(PROMPT_A, MODEL, deriveLegacyAvatarCacheKey({ modelName: MODEL, prompt: PROMPT_A }));

      await collapseDuplicateAvatarRollsMigration.run();

      const warnings = censusWarnings();
      expect(warnings).toHaveLength(1);
      expect(warnings[0][1].unexplainedCount).toBe(1);
      expect(warnings[0][1].fileIds).toEqual(['stowaway']);
    });
  });

  it('never deletes a roll a character still names as its portrait', async () => {
    seedRoll('portrait', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    mainDb
      .prepare('INSERT INTO "characters" (id, avatarOverrides, defaultImageId) VALUES (?, NULL, ?)')
      .run(CHARACTER, 'link-portrait');

    await collapseDuplicateAvatarRollsMigration.run();

    // Both the files row and its vault rows stay: a blob that refuses to go
    // keeps its file row, so the pair never drifts apart.
    expect(fileIds()).toEqual(['new', 'portrait']);
    expect(
      (mountDb.prepare('SELECT COUNT(*) AS n FROM doc_mount_blobs WHERE id = ?').get('blob-portrait') as any).n
    ).toBe(1);
  });

  it('ignores rows with no prompt to key on', async () => {
    mainDb
      .prepare(
        `INSERT INTO "files" (id, originalFilename, category, generationPrompt, generationModel, generationKey, storageKey, createdAt)
         VALUES ('no-prompt', 'avatar_Friday_x.webp', 'IMAGE', '', ?, NULL, 'mount-blob:m:b', '2026-01-01T00:00:00.000Z')`
      )
      .run(MODEL);

    await collapseDuplicateAvatarRollsMigration.run();

    expect(fileIds()).toEqual(['no-prompt']);
    expect(keyOf('no-prompt')).toBeNull();
  });

  it('ignores files that are not avatars', async () => {
    mainDb
      .prepare(
        `INSERT INTO "files" (id, originalFilename, category, generationPrompt, generationModel, generationKey, storageKey, createdAt)
         VALUES ('backdrop', 'background_scene.webp', 'IMAGE', ?, ?, NULL, 'mount-blob:m:b', '2026-01-01T00:00:00.000Z')`
      )
      .run(PROMPT_A, MODEL);

    await collapseDuplicateAvatarRollsMigration.run();

    expect(fileIds()).toEqual(['backdrop']);
    expect(keyOf('backdrop')).toBeNull();
  });

  it('is idempotent — a second pass finds nothing left to do', async () => {
    seedRoll('old', PROMPT_A, '2026-01-01T00:00:00.000Z');
    seedRoll('new', PROMPT_A, '2026-06-01T00:00:00.000Z');

    await collapseDuplicateAvatarRollsMigration.run();
    const afterFirst = fileIds();
    const keyAfterFirst = keyOf('new');

    expect(await collapseDuplicateAvatarRollsMigration.shouldRun()).toBe(false);

    const second = await collapseDuplicateAvatarRollsMigration.run();
    expect(second.success).toBe(true);
    expect(fileIds()).toEqual(afterFirst);
    expect(keyOf('new')).toBe(keyAfterFirst);
  });

  it('shouldRun is true while an unkeyed avatar remains', async () => {
    seedRoll('only', PROMPT_A, '2026-01-01T00:00:00.000Z');
    expect(await collapseDuplicateAvatarRollsMigration.shouldRun()).toBe(true);
  });
});
