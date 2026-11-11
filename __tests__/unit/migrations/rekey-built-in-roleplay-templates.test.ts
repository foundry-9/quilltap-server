/**
 * @jest-environment node
 *
 * rekey-built-in-roleplay-templates-v1 — gives each built-in roleplay template
 * its fixed UUIDv5 id and re-points every main-database pointer to it (#190).
 * Real SQLite, so the UPDATEs and the participants JSON rewrite are exercised.
 */

import path from 'path';

jest.mock('../../../migrations/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../migrations/lib/database-utils', () => {
  const db = () => (global as Record<string, unknown>).__testMainDb as any;
  const tableExists = (d: any, table: string) =>
    !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  const columnExists = (d: any, table: string, column: string) =>
    d.prepare(`PRAGMA table_info("${table}")`).all().some((c: { name: string }) => c.name === column);
  return {
    isSQLiteBackend: jest.fn(() => true),
    getSQLiteDatabase: jest.fn(() => db()),
    sqliteTableExists: jest.fn((table: string) => tableExists(db(), table)),
    tableExists: jest.fn(tableExists),
    columnExists: jest.fn(columnExists),
  };
});

import { rekeyBuiltInRoleplayTemplatesMigration as migration } from '../../../migrations/scripts/rekey-built-in-roleplay-templates-v1';
import { migrations } from '../../../migrations/scripts';
import { prettify } from '@/lib/startup/prettify';
import { builtInRoleplayTemplateId } from '@/lib/roleplay-templates/built-in-ids';

const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'));

const OLD_STANDARD = '11111111-1111-4111-8111-111111111111';
const OLD_NOVEL = '22222222-2222-4222-8222-222222222222';
const USER_TEMPLATE = '33333333-3333-4333-8333-333333333333';
const STANDARD = builtInRoleplayTemplateId('Standard');
const NOVEL = builtInRoleplayTemplateId('Novel');

let db: any;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE "roleplay_templates" ("id" TEXT PRIMARY KEY, "name" TEXT, "isBuiltIn" INTEGER);
    CREATE TABLE "characters" ("id" TEXT PRIMARY KEY, "defaultRoleplayTemplateId" TEXT);
    CREATE TABLE "chats" ("id" TEXT PRIMARY KEY, "roleplayTemplateId" TEXT, "participants" TEXT);
    CREATE TABLE "chat_settings" ("id" TEXT PRIMARY KEY, "defaultRoleplayTemplateId" TEXT);
    CREATE TABLE "instance_settings" ("key" TEXT PRIMARY KEY, "value" TEXT);
  `);
  db.prepare('INSERT INTO roleplay_templates VALUES (?,?,?), (?,?,?), (?,?,?)').run(
    OLD_STANDARD, 'Standard', 1, OLD_NOVEL, 'Novel', 1, USER_TEMPLATE, 'Standard', 0,
  );
  db.prepare('INSERT INTO characters VALUES (?,?), (?,?)').run('c1', OLD_STANDARD, 'c2', USER_TEMPLATE);
  db.prepare('INSERT INTO chats VALUES (?,?,?)').run(
    'chat1', OLD_NOVEL,
    JSON.stringify([{ id: 's1', roleplayTemplateId: OLD_STANDARD }, { id: 's2', roleplayTemplateId: USER_TEMPLATE }]),
  );
  db.prepare('INSERT INTO chat_settings VALUES (?,?)').run('cs1', OLD_STANDARD);
  (global as Record<string, unknown>).__testMainDb = db;
});

afterEach(() => db?.close());

describe('rekey-built-in-roleplay-templates-v1', () => {
  it('is registered and has a loading-screen label', () => {
    expect(migrations.map((m: { id: string }) => m.id)).toContain(migration.id);
    expect(prettify(migration.id)).not.toBe(migration.id);
  });

  it('re-keys the built-ins and every pointer to them, leaving user templates alone', async () => {
    expect(await migration.shouldRun()).toBe(true);
    const result = await migration.run();
    expect(result.success).toBe(true);

    const ids = db.prepare('SELECT id FROM roleplay_templates ORDER BY name, isBuiltIn').all().map((r: { id: string }) => r.id);
    expect(new Set(ids)).toEqual(new Set([STANDARD, NOVEL, USER_TEMPLATE]));
    expect(db.prepare('SELECT defaultRoleplayTemplateId AS t FROM characters WHERE id = ?').get('c1').t).toBe(STANDARD);
    expect(db.prepare('SELECT defaultRoleplayTemplateId AS t FROM characters WHERE id = ?').get('c2').t).toBe(USER_TEMPLATE);
    const chat = db.prepare('SELECT * FROM chats').get();
    expect(chat.roleplayTemplateId).toBe(NOVEL);
    expect(JSON.parse(chat.participants).map((p: { roleplayTemplateId: string }) => p.roleplayTemplateId)).toEqual([STANDARD, USER_TEMPLATE]);
    expect(db.prepare('SELECT defaultRoleplayTemplateId AS t FROM chat_settings').get().t).toBe(STANDARD);

    // Project pointers are left for the boot step.
    const map = JSON.parse(db.prepare("SELECT value FROM instance_settings WHERE key = 'builtInRoleplayTemplateRekeys'").get().value);
    expect(map).toEqual({ [OLD_STANDARD]: STANDARD, [OLD_NOVEL]: NOVEL });

    expect(await migration.shouldRun()).toBe(false);
  });

  it('folds a second row for the same built-in into the first', async () => {
    db.prepare('INSERT INTO roleplay_templates VALUES (?,?,?)').run(STANDARD, 'Standard', 1);
    await migration.run();
    const standards = db.prepare("SELECT id FROM roleplay_templates WHERE name = 'Standard' AND isBuiltIn = 1").all();
    expect(standards).toEqual([{ id: STANDARD }]);
    expect(db.prepare('SELECT defaultRoleplayTemplateId AS t FROM characters WHERE id = ?').get('c1').t).toBe(STANDARD);
  });
});
