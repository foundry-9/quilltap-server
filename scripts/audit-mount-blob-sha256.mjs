/**
 * audit-mount-blob-sha256.mjs
 *
 * Purpose:
 *   Verifies that every row in doc_mount_blobs has sha256 == SHA-256(data).
 *   This is a read-only dev utility for confirming that the
 *   repair-mount-blob-sha256-from-bytes-v1 migration ran correctly on a
 *   live instance.
 *
 * Usage:
 *   ENCRYPTION_MASTER_PEPPER=<base64-pepper> \
 *     node scripts/audit-mount-blob-sha256.mjs --data-dir <instance>/data
 *
 *   The data dir is the directory containing quilltap-mount-index.db
 *   (i.e. the `data/` subdirectory of the instance root, same as what
 *   --data-dir expects for the quilltap CLI).
 *
 *   Alternatively, set QUILLTAP_DATA_DIR to the data dir and omit --data-dir.
 *
 *   ENCRYPTION_MASTER_PEPPER is the base64-encoded SQLCipher key.  It lives in
 *   the running server's environment; you can read it from the process env of
 *   the running Quilltap server (macOS: `ps eww <pid> | grep MASTER_PEPPER`),
 *   or from the .env / launch config you use to start the dev server.
 *
 * Exit codes:
 *   0 — all rows match (or no mount-index DB found)
 *   1 — at least one mismatched row found, or an unrecoverable error
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function getDataDir() {
  const argv = process.argv.slice(2);
  const flagIdx = argv.indexOf('--data-dir');
  if (flagIdx !== -1 && argv[flagIdx + 1]) {
    return argv[flagIdx + 1];
  }
  const envDir = process.env.QUILLTAP_DATA_DIR;
  if (envDir) return envDir;
  console.error(
    'Error: supply the data dir via --data-dir <path> or QUILLTAP_DATA_DIR env var.'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Open the mount-index DB (read-only, SQLCipher)
// ---------------------------------------------------------------------------

async function openMountIndexDb(dataDir) {
  const dbFile = join(dataDir, 'quilltap-mount-index.db');
  if (!existsSync(dbFile)) {
    console.log(`Mount-index DB not found at ${dbFile} — nothing to audit.`);
    process.exit(0);
  }

  // Try the aliased name first (root node_modules), then fall back to the
  // real package name (present under packages/quilltap/node_modules in dev).
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    Database = (await import('better-sqlite3-multiple-ciphers')).default;
  }

  // Open read-only: SQLCipher's ATTACH supports read-only mode; better-sqlite3
  // exposes it via the `readonly` option.
  const db = new Database(dbFile, { readonly: true });

  const pepper = process.env.ENCRYPTION_MASTER_PEPPER;
  if (pepper) {
    const keyHex = Buffer.from(pepper, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }

  // Quick sanity check that decryption succeeded.
  try {
    db.pragma('cipher_integrity_check');
  } catch (err) {
    console.error(
      'Failed to open mount-index DB (wrong key or not a SQLCipher database):',
      err.message
    );
    db.close();
    process.exit(1);
  }

  return db;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const EXAMPLE_LIMIT = 10;

const dataDir = getDataDir();
const db = await openMountIndexDb(dataDir);

console.log(`Auditing doc_mount_blobs in: ${dataDir}`);

let total = 0;
let mismatches = 0;
const mismatchIds = [];

// Iterate with a cursor to avoid loading all blobs into memory at once.
const rows = db.prepare('SELECT id, sha256, data FROM doc_mount_blobs ORDER BY id').iterate();

for (const row of rows) {
  total++;
  const computed = createHash('sha256').update(row.data).digest('hex');
  if (computed !== row.sha256) {
    mismatches++;
    if (mismatchIds.length < EXAMPLE_LIMIT) {
      mismatchIds.push({ id: row.id, stored: row.sha256, computed });
    }
  }
  if (total % 500 === 0) {
    process.stdout.write(`\r  scanned ${total}...`);
  }
}

if (total > 0) process.stdout.write('\r');

db.close();

console.log(`Scanned : ${total} rows`);
console.log(`Mismatch: ${mismatches} rows`);

if (mismatches > 0) {
  console.log('\nFirst mismatched rows (up to 10):');
  for (const ex of mismatchIds) {
    console.log(`  id=${ex.id}`);
    console.log(`    stored  : ${ex.stored}`);
    console.log(`    computed: ${ex.computed}`);
  }
  console.log('\nRun repair-mount-blob-sha256-from-bytes-v1 migration to fix these rows.');
  process.exit(1);
} else {
  console.log('All blob sha256 values match their stored bytes.');
  process.exit(0);
}
