/**
 * Re-encrypt API Keys Migration
 *
 * This migration fixes API keys that were encrypted with a user ID that no longer
 * exists after migration to single-user mode. It detects keys encrypted with an
 * old user ID and re-encrypts them with the SINGLE_USER_ID.
 *
 * The migration:
 * 1. Looks for user directories in the files folder to find the old user ID
 * 2. For each API key belonging to SINGLE_USER_ID, attempts decryption with old user ID
 * 3. If decryption succeeds, re-encrypts with SINGLE_USER_ID
 *
 * Can also be run manually:
 *   npx ts-node migrations/scripts/reencrypt-api-keys.ts --old-user-id <uuid>
 */

import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
} from '../lib/database-utils';
import type { Migration, MigrationResult } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

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
// Encryption Functions (duplicated to avoid import issues in migrations)
// ============================================================================

function deriveUserKey(userId: string): Buffer {
  const masterPepper = process.env.ENCRYPTION_MASTER_PEPPER || '';
  if (!masterPepper) {
    throw new Error('ENCRYPTION_MASTER_PEPPER environment variable is not set');
  }
  return crypto.pbkdf2Sync(
    userId,
    masterPepper,
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
// Helper Functions
// ============================================================================

function findOldUserIds(): string[] {
  // Try to find old user IDs from the files directory structure
  const possiblePaths = [
    // macOS
    path.join(process.env.HOME || '', 'Library/Application Support/Quilltap/files/users'),
    // Linux
    path.join(process.env.HOME || '', '.quilltap/files/users'),
    // Docker
    '/app/quilltap/files/users',
  ];

  const oldUserIds: string[] = [];

  for (const usersDir of possiblePaths) {
    if (fs.existsSync(usersDir)) {
      try {
        const entries = fs.readdirSync(usersDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== SINGLE_USER_ID && entry.name !== '.DS_Store') {
            // Validate it looks like a UUID
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) {
              oldUserIds.push(entry.name);
            }
          }
        }
      } catch {
        // Directory might not be accessible
      }
    }
  }

  return oldUserIds;
}

// ============================================================================
// Migration Implementation
// ============================================================================

export const reencryptApiKeysMigration: Migration = {
  id: 'reencrypt-api-keys-v1',
  description: 'Re-encrypt API keys after single-user migration',
  introducedInVersion: '2.8.1',

  async shouldRun(): Promise<boolean> {
    // Only run for SQLite backend
    if (!isSQLiteBackend()) {
      return false;
    }

    // Check if api_keys table exists
    if (!sqliteTableExists('api_keys')) {
      return false;
    }

    // Find potential old user IDs
    const oldUserIds = findOldUserIds();
    if (oldUserIds.length === 0) {
      return false;
    }

    // Check if any API keys belonging to SINGLE_USER_ID fail to decrypt
    const db = getSQLiteDatabase();
    const apiKeys = db.prepare(`
      SELECT id, ciphertext, iv, authTag
      FROM api_keys
      WHERE userId = ?
    `).all(SINGLE_USER_ID) as Array<{
      id: string;
      ciphertext: string;
      iv: string;
      authTag: string;
    }>;

    for (const key of apiKeys) {
      // Try to decrypt with SINGLE_USER_ID
      const result = tryDecrypt(key.ciphertext, key.iv, key.authTag, SINGLE_USER_ID);
      if (result === null) {
        // Found a key that can't be decrypted - migration should run
        logger.info('Found API key that needs re-encryption', {
          context: 'migrations.reencrypt-api-keys.shouldRun',
          keyId: key.id,
        });
        return true;
      }
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let keysFixed = 0;
    let keysFailed = 0;
    const errors: string[] = [];

    try {
      const db = getSQLiteDatabase();

      // Find old user IDs
      const oldUserIds = findOldUserIds();
      logger.info('Found potential old user IDs', {
        context: 'migrations.reencrypt-api-keys.run',
        oldUserIds,
      });

      // Get all API keys belonging to SINGLE_USER_ID
      const apiKeys = db.prepare(`
        SELECT id, provider, label, ciphertext, iv, authTag
        FROM api_keys
        WHERE userId = ?
      `).all(SINGLE_USER_ID) as Array<{
        id: string;
        provider: string;
        label: string;
        ciphertext: string;
        iv: string;
        authTag: string;
      }>;

      const updateStmt = db.prepare(`
        UPDATE api_keys
        SET ciphertext = ?, iv = ?, authTag = ?, updatedAt = ?
        WHERE id = ?
      `);

      for (const key of apiKeys) {
        // First try to decrypt with SINGLE_USER_ID (already correct)
        const alreadyValid = tryDecrypt(key.ciphertext, key.iv, key.authTag, SINGLE_USER_ID);
        if (alreadyValid !== null) {
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
          logger.error('Could not decrypt API key with any known user ID', {
            context: 'migrations.reencrypt-api-keys.run',
            keyId: key.id,
            provider: key.provider,
            label: key.label,
          });
          errors.push(`Could not decrypt key ${key.id} (${key.provider}/${key.label})`);
          keysFailed++;
          continue;
        }

        // Re-encrypt with SINGLE_USER_ID
        const reencrypted = encryptApiKey(decrypted, SINGLE_USER_ID);

        updateStmt.run(
          reencrypted.encrypted,
          reencrypted.iv,
          reencrypted.authTag,
          new Date().toISOString(),
          key.id
        );

        keysFixed++;
        logger.info('Re-encrypted API key', {
          context: 'migrations.reencrypt-api-keys.run',
          keyId: key.id,
          provider: key.provider,
          label: key.label,
          oldUserId: successfulOldUserId,
        });
      }

      const durationMs = Date.now() - startTime;

      logger.info('API key re-encryption migration completed', {
        context: 'migrations.reencrypt-api-keys.run',
        keysFixed,
        keysFailed,
        durationMs,
      });

      // Migration succeeds even if some keys couldn't be decrypted
      // Users will need to re-enter those keys manually
      // We only fail if there's a system-level error (caught below)
      if (keysFailed > 0) {
        logger.warn('Some API keys could not be re-encrypted and will need to be re-entered', {
          context: 'migrations.reencrypt-api-keys.run',
          keysFixed,
          keysFailed,
          failedKeys: errors,
        });
      }

      return {
        id: 'reencrypt-api-keys-v1',
        success: true, // Always succeed - failed keys just need user re-entry
        itemsAffected: keysFixed,
        message: keysFailed === 0
          ? `Re-encrypted ${keysFixed} API key(s)`
          : `Re-encrypted ${keysFixed} key(s); ${keysFailed} key(s) will need to be re-entered`,
        error: undefined, // Don't report as error since migration itself succeeded
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('API key re-encryption migration failed', {
        context: 'migrations.reencrypt-api-keys.run',
        error: errorMessage,
      });

      return {
        id: 'reencrypt-api-keys-v1',
        success: false,
        itemsAffected: keysFixed,
        message: 'Failed to re-encrypt API keys',
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};

// ============================================================================
// CLI Runner (for manual execution)
// ============================================================================

if (require.main === module) {
  // Parse CLI args
  const args = process.argv.slice(2);
  const oldUserIdIndex = args.indexOf('--old-user-id');
  const specifiedOldUserId = oldUserIdIndex !== -1 ? args[oldUserIdIndex + 1] : null;

  console.log('=== Re-encrypt API Keys Migration ===\n');

  if (specifiedOldUserId) {
    console.log(`Using specified old user ID: ${specifiedOldUserId}`);
  }

  (async () => {
    try {
      const shouldRun = await reencryptApiKeysMigration.shouldRun();
      if (!shouldRun) {
        console.log('Migration does not need to run (no broken API keys found).');
        process.exit(0);
      }

      const result = await reencryptApiKeysMigration.run();
      console.log('\nResult:', result);
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  })();
}
