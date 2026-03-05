#!/usr/bin/env tsx

/**
 * Rebuild Vector Indices
 *
 * Rebuilds the vector_entries table from memories.embedding data for all characters.
 * This is useful after migration, corruption, or any situation where vector_entries
 * might be out of sync with memories.
 *
 * What it does:
 * 1. Clears all existing vector_entries rows
 * 2. Reads every memory with a non-null embedding
 * 3. Inserts a vector_entries row for each (already in BLOB format)
 * 4. Updates vector_indices metadata for each character
 *
 * Usage:
 *   npm run oneoff:rebuild-vector-indices
 *   npm run oneoff:rebuild-vector-indices -- --dry-run
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// ============================================================================
// Environment Setup
// ============================================================================

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

const isDryRun = process.argv.includes('--dry-run');

// ============================================================================
// Path Detection
// ============================================================================

function getBaseDir(): string {
  if (process.env.QUILLTAP_DATA_DIR) {
    return process.env.QUILLTAP_DATA_DIR;
  }
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(process.env.HOME || '', 'Library', 'Application Support', 'Quilltap');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Quilltap');
  }
  return path.join(process.env.HOME || '', '.quilltap');
}

function getDataDir(): string {
  if (process.env.SQLITE_PATH) {
    return path.dirname(process.env.SQLITE_PATH);
  }
  return path.join(getBaseDir(), 'data');
}

function getDbPath(): string {
  if (process.env.SQLITE_PATH) {
    return process.env.SQLITE_PATH;
  }
  return path.join(getDataDir(), 'quilltap.db');
}

// ============================================================================
// Float32 BLOB conversion
// ============================================================================

function embeddingToBlob(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const dbPath = getDbPath();
  console.log(`\n🔧 Rebuild Vector Indices`);
  console.log(`   Database: ${dbPath}`);
  console.log(`   Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database not found at ${dbPath}`);
    console.error(`   Set SQLITE_PATH or QUILLTAP_DATA_DIR environment variable.`);
    process.exit(1);
  }

  const db: DatabaseType = new Database(dbPath);
  // SQLCipher key must be first pragma
  const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
  if (sqlcipherKey) {
    const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  try {
    // Check tables exist
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memories', 'vector_entries', 'vector_indices')`
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    if (!tableNames.includes('memories')) {
      console.error('❌ memories table not found.');
      process.exit(1);
    }
    if (!tableNames.includes('vector_entries')) {
      console.error('❌ vector_entries table not found. Run the migration first.');
      process.exit(1);
    }

    // Count existing state
    const existingEntries = (db.prepare('SELECT COUNT(*) as count FROM vector_entries').get() as { count: number }).count;
    const memoriesWithEmbeddings = db.prepare(
      `SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL`
    ).get() as { count: number };

    console.log(`   Existing vector_entries: ${existingEntries}`);
    console.log(`   Memories with embeddings: ${memoriesWithEmbeddings.count}`);

    if (memoriesWithEmbeddings.count === 0) {
      console.log('\n✅ No memories with embeddings found. Nothing to rebuild.');
      return;
    }

    if (isDryRun) {
      console.log(`\n📋 DRY RUN: Would clear ${existingEntries} vector_entries and rebuild ${memoriesWithEmbeddings.count} from memories.`);
      return;
    }

    // Step 1: Clear existing vector_entries
    console.log(`\n   Clearing ${existingEntries} existing vector_entries...`);
    db.exec('DELETE FROM vector_entries');

    // Step 2: Read all memories with embeddings and insert into vector_entries
    const rows = db.prepare(
      `SELECT id, "characterId", embedding, "createdAt" FROM memories WHERE embedding IS NOT NULL`
    ).all() as { id: string; characterId: string; embedding: Buffer | string; createdAt: string }[];

    const insertStmt = db.prepare(
      `INSERT OR IGNORE INTO "vector_entries" ("id", "characterId", "embedding", "createdAt") VALUES (?, ?, ?, ?)`
    );

    let inserted = 0;
    let skipped = 0;
    const characterDimensions = new Map<string, number>();

    const batchInsert = db.transaction((batch: typeof rows) => {
      for (const row of batch) {
        let blob: Buffer;
        if (Buffer.isBuffer(row.embedding)) {
          blob = row.embedding;
        } else if (typeof row.embedding === 'string') {
          // Legacy JSON text that wasn't converted yet
          try {
            const parsed = JSON.parse(row.embedding) as number[];
            blob = embeddingToBlob(parsed);
          } catch {
            skipped++;
            continue;
          }
        } else {
          skipped++;
          continue;
        }

        insertStmt.run(row.id, row.characterId, blob, row.createdAt);
        inserted++;

        // Track dimensions per character
        if (!characterDimensions.has(row.characterId)) {
          characterDimensions.set(row.characterId, blob.byteLength / 4);
        }
      }
    });

    // Process in batches of 500
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      batchInsert(batch);

      const progress = Math.min(i + 500, rows.length);
      process.stdout.write(`\r   Inserting vector entries... ${progress}/${rows.length}`);
    }
    console.log('');

    // Step 3: Update vector_indices metadata
    const upsertMetaStmt = db.prepare(
      `INSERT INTO "vector_indices" ("id", "characterId", "version", "dimensions", "createdAt", "updatedAt")
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT("id") DO UPDATE SET "updatedAt" = excluded."updatedAt", "dimensions" = excluded."dimensions"`
    );
    const now = new Date().toISOString();

    const updateMeta = db.transaction(() => {
      for (const [charId, dims] of characterDimensions) {
        upsertMetaStmt.run(charId, charId, dims, now, now);
      }
    });
    updateMeta();

    console.log(`\n✅ Rebuild complete:`);
    console.log(`   Vector entries inserted: ${inserted}`);
    console.log(`   Skipped (invalid): ${skipped}`);
    console.log(`   Characters updated: ${characterDimensions.size}`);

  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
