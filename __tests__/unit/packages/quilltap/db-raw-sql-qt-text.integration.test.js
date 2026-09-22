/**
 * @jest-environment node
 *
 * Regression test for bug 162 — the CLI's low-level `db` path (raw SQL,
 * `--repl`, `--tables`, `--count`) opened its own connection and never
 * registered `qt_text()`, so it could neither read inside a compressed text
 * column nor write a `chat_messages` row (the FTS5 sync triggers call the
 * function, so the write failed loudly).
 *
 * These drive the bin itself, because the defect lived in the bin's private
 * opener and not in `openEncryptedDb`, which had the registration all along.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');
const BIN = path.join(QUILLTAP_PKG, 'bin', 'quilltap.js');

function loadDriver() {
  try {
    return require(path.join(QUILLTAP_PKG, 'node_modules', 'better-sqlite3-multiple-ciphers'));
  } catch {
    try {
      return require('better-sqlite3-multiple-ciphers');
    } catch {
      return require(path.join(QUILLTAP_PKG, '..', '..', 'node_modules', 'better-sqlite3'));
    }
  }
}

/** Mirror of the server's compressed-text header: 'Q', version 1, brotli. */
function compressText(text) {
  return Buffer.concat([
    Buffer.from([0x51, 0x01, 0x01]),
    zlib.brotliCompressSync(Buffer.from(text, 'utf-8')),
  ]);
}

const LONG_TEXT =
  'The Tuesday-night pie was, as ever, an act of considerable optimism. ' +
  'x'.repeat(600);

/** Run the bin's `db` command against the fixture dir; returns stdout. */
function runDb(tempDir, extraArgs) {
  return execFileSync(process.execPath, [BIN, 'db', '--data-dir', tempDir, ...extraArgs], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('quilltap db — low-level path registers qt_text() (bug 162)', () => {
  let tempDir;

  beforeEach(() => {
    const Database = loadDriver();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-rawsql-test-'));
    // `--data-dir` names an instance base; the databases live under `data/`.
    const dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // No .dbkey file, so loadDbKey returns null and the fixture stays plain —
    // the registration under test is independent of the cipher.
    const db = new Database(path.join(dataDir, 'quilltap.db'));
    db.exec(`
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        chatId TEXT,
        content TEXT,
        updatedAt TEXT
      );
      CREATE VIRTUAL TABLE chat_messages_fts USING fts5(content);
      CREATE TABLE chat_messages_fts_map (rowid INTEGER PRIMARY KEY, messageId TEXT);
    `);
    // The real schema's update trigger calls qt_text() on the new row. A
    // connection without the function fails every UPDATE here, which is the
    // write half of the bug.
    db.exec(`
      CREATE TRIGGER chat_messages_fts_update AFTER UPDATE ON chat_messages
      BEGIN
        INSERT INTO chat_messages_fts (rowid, content)
        VALUES (new.rowid, qt_text(new.content));
      END;
    `);
    db.prepare('INSERT INTO chat_messages (id, chatId, content, updatedAt) VALUES (?, ?, ?, ?)')
      .run('m-1', 'c-1', compressText(LONG_TEXT), '2026-09-21T23:30:00.000Z');
    db.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads inside a compressed column through raw SQL', () => {
    const out = runDb(tempDir, [
      '--json',
      "SELECT substr(qt_text(content), 1, 40) AS s FROM chat_messages LIMIT 1",
    ]);
    const rows = JSON.parse(out);
    expect(rows).toHaveLength(1);
    expect(rows[0].s).toBe(LONG_TEXT.slice(0, 40));
  });

  it('returns the raw BLOB without qt_text(), so the decode is the function talking', () => {
    const out = runDb(tempDir, ['--json', 'SELECT content FROM chat_messages LIMIT 1']);
    const rows = JSON.parse(out);
    expect(rows[0].content).not.toBe(LONG_TEXT);
  });

  it('completes a --write UPDATE whose index trigger calls qt_text()', () => {
    const out = runDb(tempDir, [
      '--write',
      '--json',
      "UPDATE chat_messages SET updatedAt = '2026-09-22T00:00:00.000Z' WHERE id = 'm-1'",
    ]);
    expect(JSON.parse(out).changes).toBe(1);
  });

  it('still serves --tables and --count from the same opener', () => {
    expect(runDb(tempDir, ['--count', 'chat_messages']).trim()).toBe('1');
    expect(runDb(tempDir, ['--tables'])).toContain('chat_messages');
  });
});
