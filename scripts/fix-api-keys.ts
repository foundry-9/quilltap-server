#!/usr/bin/env npx ts-node
/**
 * Fix API Keys After Single-User Migration
 *
 * This script fixes API keys that were encrypted with an old user ID
 * after migration to single-user mode.
 *
 * Usage:
 *   npx ts-node scripts/fix-api-keys.ts --old-user-id <uuid>
 *   npx ts-node scripts/fix-api-keys.ts --dry-run --old-user-id <uuid>
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// ============================================================================
// Environment Setup
// ============================================================================

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

// ============================================================================
// Constants
// ============================================================================

const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

// ============================================================================
// CLI Arguments
// ============================================================================

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const oldUserIdIndex = args.indexOf('--old-user-id');
const specifiedOldUserId = oldUserIdIndex !== -1 ? args[oldUserIdIndex + 1] : null;

// ============================================================================
// Path Detection
// ============================================================================

function getSQLiteDatabasePath(): string {
  // Check common locations
  const possiblePaths = [
    // macOS
    path.join(process.env.HOME || '', 'Library/Application Support/Quilltap/data/quilltap.db'),
    // Linux
    path.join(process.env.HOME || '', '.quilltap/data/quilltap.db'),
    // Docker
    '/app/quilltap/data/quilltap.db',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error('Could not find quilltap.db. Please specify the path.');
}

function getFilesDir(): string {
  const possiblePaths = [
    path.join(process.env.HOME || '', 'Library/Application Support/Quilltap/files'),
    path.join(process.env.HOME || '', '.quilltap/files'),
    '/app/quilltap/files',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error('Could not find files directory.');
}

// ============================================================================
// Encryption Functions
// ============================================================================

function getMasterPepper(): string {
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER || '';
  if (!pepper) {
    console.error('ERROR: ENCRYPTION_MASTER_PEPPER environment variable is not set');
    console.error('Please set it in your .env.local file or environment.');
    process.exit(1);
  }
  return pepper;
}

function deriveUserKey(userId: string): Buffer {
  return crypto.pbkdf2Sync(
    userId,
    getMasterPepper(),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  );
}

function encryptApiKey(apiKey: string, userId: string) {
  const key = deriveUserKey(userId);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, new Uint8Array(key), new Uint8Array(iv));

  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

function decryptApiKey(
  encrypted: string,
  iv: string,
  authTag: string,
  userId: string
): string {
  const key = deriveUserKey(userId);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    new Uint8Array(key),
    new Uint8Array(Buffer.from(iv, 'hex'))
  );

  decipher.setAuthTag(new Uint8Array(Buffer.from(authTag, 'hex')));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

function tryDecrypt(
  encrypted: string,
  iv: string,
  authTag: string,
  userId: string
): string | null {
  try {
    return decryptApiKey(encrypted, iv, authTag, userId);
  } catch {
    return null;
  }
}

// ============================================================================
// Find Old User IDs
// ============================================================================

function findOldUserIds(): string[] {
  try {
    const filesDir = getFilesDir();
    const usersDir = path.join(filesDir, 'users');

    if (!fs.existsSync(usersDir)) {
      return [];
    }

    const oldUserIds: string[] = [];
    const entries = fs.readdirSync(usersDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== SINGLE_USER_ID && entry.name !== '.DS_Store') {
        // Validate it looks like a UUID
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) {
          oldUserIds.push(entry.name);
        }
      }
    }

    return oldUserIds;
  } catch {
    return [];
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== Fix API Keys After Single-User Migration ===\n');

  if (isDryRun) {
    console.log('Running in DRY RUN mode - no changes will be made\n');
  }

  // Find database
  const dbPath = getSQLiteDatabasePath();
  console.log(`Database: ${dbPath}`);

  const db = new Database(dbPath);
  // SQLCipher key must be first pragma
  const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
  if (sqlcipherKey) {
    const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  try {
    // Get old user IDs
    let oldUserIds: string[] = [];

    if (specifiedOldUserId) {
      oldUserIds = [specifiedOldUserId];
      console.log(`Using specified old user ID: ${specifiedOldUserId}`);
    } else {
      oldUserIds = findOldUserIds();
      if (oldUserIds.length === 0) {
        console.log('No old user IDs found in files directory.');
        console.log('Please specify with --old-user-id <uuid>');
        process.exit(1);
      }
      console.log(`Found potential old user IDs: ${oldUserIds.join(', ')}`);
    }

    // Get all API keys
    const apiKeys = db.prepare(`
      SELECT id, provider, label, ciphertext, iv, authTag, userId
      FROM api_keys
      WHERE userId = ?
    `).all(SINGLE_USER_ID) as Array<{
      id: string;
      provider: string;
      label: string;
      ciphertext: string;
      iv: string;
      authTag: string;
      userId: string;
    }>;

    console.log(`\nFound ${apiKeys.length} API key(s) to check\n`);

    if (apiKeys.length === 0) {
      console.log('No API keys to fix.');
      process.exit(0);
    }

    const updateStmt = db.prepare(`
      UPDATE api_keys
      SET ciphertext = ?, iv = ?, authTag = ?, updatedAt = ?
      WHERE id = ?
    `);

    let fixed = 0;
    let alreadyOk = 0;
    let failed = 0;

    for (const key of apiKeys) {
      // First check if already valid
      const alreadyValid = tryDecrypt(key.ciphertext, key.iv, key.authTag, SINGLE_USER_ID);
      if (alreadyValid !== null) {
        console.log(`  ✓ ${key.provider} / ${key.label} - already valid`);
        alreadyOk++;
        continue;
      }

      // Try each old user ID
      let decrypted: string | null = null;
      let successfulOldUserId: string | null = null;

      for (const oldUserId of oldUserIds) {
        decrypted = tryDecrypt(key.ciphertext, key.iv, key.authTag, oldUserId);
        if (decrypted !== null) {
          successfulOldUserId = oldUserId;
          break;
        }
      }

      if (decrypted === null) {
        console.log(`  ✗ ${key.provider} / ${key.label} - COULD NOT DECRYPT`);
        failed++;
        continue;
      }

      if (isDryRun) {
        console.log(`  ~ ${key.provider} / ${key.label} - would fix (old user: ${successfulOldUserId?.slice(0, 8)}...)`);
        fixed++;
      } else {
        // Re-encrypt with SINGLE_USER_ID
        const reencrypted = encryptApiKey(decrypted, SINGLE_USER_ID);

        updateStmt.run(
          reencrypted.encrypted,
          reencrypted.iv,
          reencrypted.authTag,
          new Date().toISOString(),
          key.id
        );

        console.log(`  ✓ ${key.provider} / ${key.label} - FIXED`);
        fixed++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`  Already valid: ${alreadyOk}`);
    console.log(`  Fixed: ${fixed}`);
    console.log(`  Failed: ${failed}`);

    if (isDryRun) {
      console.log('\n[DRY RUN] No changes were made. Run without --dry-run to apply fixes.');
    } else if (fixed > 0) {
      console.log('\nAPI keys have been fixed. Please restart Quilltap.');
    }

  } finally {
    db.close();
  }
}

main().catch(console.error);
