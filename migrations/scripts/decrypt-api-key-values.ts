/**
 * Migration: Decrypt API Key Values
 *
 * Fixes API keys that were left in encrypted (ciphertext) form after the
 * drop-api-key-encryption-columns migration renamed `ciphertext` to `key_value`
 * without decrypting the values first.
 *
 * The old encryption scheme used AES-256-GCM with a key derived from
 * PBKDF2(userId, ENCRYPTION_MASTER_PEPPER). Since database-level encryption
 * (SQLCipher) now protects all data at rest, the key_value column should
 * contain plaintext API keys.
 *
 * This migration:
 * 1. Detects keys that look like hex-encoded ciphertext (not valid API keys)
 * 2. Attempts to decrypt using SINGLE_USER_ID + ENCRYPTION_MASTER_PEPPER
 * 3. Also tries legacy user IDs found in the files directory
 * 4. Stores the decrypted plaintext in key_value
 *
 * Migration ID: decrypt-api-key-values-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import {
  isSQLiteBackend,
  getSQLiteDatabase,
  sqliteTableExists,
  getSQLiteTableColumns,
} from '../lib/database-utils';
import crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Global type extension for migration warnings
// ============================================================================

declare global {
  var __quilltapMigrationWarnings: string[] | undefined;
}

// ============================================================================
// Constants
// ============================================================================

const SINGLE_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

/**
 * Known API key prefixes for each provider.
 * If a key_value starts with one of these, it's already plaintext.
 */
const KNOWN_PLAINTEXT_PREFIXES = [
  'sk-ant-',    // Anthropic
  'sk-',        // OpenAI, OpenRouter
  'xai-',       // xAI/Grok
  'AI',         // Google (AIza...)
  'gsk_',       // Groq
  'r8_',        // Replicate
  'hf_',        // HuggingFace
  'key-',       // Various
];

// ============================================================================
// Encryption Functions (matching the old scheme)
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
    PBKDF2_DIGEST,
  );
}

/**
 * The old encryption stored three separate columns: ciphertext, iv, authTag.
 * After the drop-api-key-encryption-columns migration, ciphertext was renamed
 * to key_value and iv/authTag were dropped.
 *
 * However, some installations may have had the iv and authTag stored as part
 * of a JSON blob, or the columns may have been concatenated. We need to check
 * both possibilities.
 *
 * The most likely scenario: key_value contains just the hex ciphertext, and
 * the iv/authTag are lost (columns were dropped). In that case we cannot
 * decrypt, and the user will need to re-enter keys.
 *
 * BUT: if the drop-columns migration preserved the data as a JSON structure
 * or if there's a backup table, we might still recover.
 */

function tryDecryptWithParts(
  ciphertext: string,
  iv: string,
  authTag: string,
  userId: string,
): string | null {
  try {
    const key = deriveUserKey(userId);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      new Uint8Array(key),
      new Uint8Array(Buffer.from(iv, 'hex')),
    );
    decipher.setAuthTag(new Uint8Array(Buffer.from(authTag, 'hex')));

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Check if a value looks like it's already a plaintext API key
 */
function looksLikePlaintext(value: string): boolean {
  // Known prefixes
  if (KNOWN_PLAINTEXT_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return true;
  }

  // Hex-only strings of substantial length are likely ciphertext
  if (/^[0-9a-f]{32,}$/i.test(value)) {
    return false;
  }

  // If it contains non-hex characters (dashes, underscores, mixed case beyond hex),
  // it's likely a plaintext key
  if (/[^0-9a-fA-F]/.test(value)) {
    return true;
  }

  // Short hex strings could be either, but API keys are usually longer
  // and contain non-hex chars. If it's pure hex, assume encrypted.
  return false;
}

/**
 * Find potential old user IDs from the files directory structure
 */
function findOldUserIds(): string[] {
  const possiblePaths = [
    path.join(process.env.HOME || '', 'Library/Application Support/Quilltap/files/users'),
    path.join(process.env.HOME || '', '.quilltap/files/users'),
    '/app/quilltap/files/users',
    '/data/quilltap/files/users',
  ];

  const oldUserIds: string[] = [];

  for (const usersDir of possiblePaths) {
    if (fs.existsSync(usersDir)) {
      try {
        const entries = fs.readdirSync(usersDir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            entry.name !== SINGLE_USER_ID &&
            entry.name !== '.DS_Store' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)
          ) {
            oldUserIds.push(entry.name);
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

export const decryptApiKeyValuesMigration: Migration = {
  id: 'decrypt-api-key-values-v1',
  description: 'Decrypt API key values left as ciphertext after column rename',
  introducedInVersion: '3.2.1',
  dependsOn: ['drop-api-key-encryption-columns-v1'],

  async shouldRun(): Promise<boolean> {
    if (!isSQLiteBackend()) {
      return false;
    }

    if (!sqliteTableExists('api_keys')) {
      return false;
    }

    // Must have key_value column (post-rename)
    const columns = getSQLiteTableColumns('api_keys');
    if (!columns.some((c) => c.name === 'key_value')) {
      return false;
    }

    // Check if any keys look like they're still encrypted
    const db = getSQLiteDatabase();
    const apiKeys = db
      .prepare('SELECT id, key_value FROM api_keys')
      .all() as Array<{ id: string; key_value: string }>;

    for (const key of apiKeys) {
      if (key.key_value && !looksLikePlaintext(key.key_value)) {
        logger.info('Found API key that appears to still be encrypted', {
          context: 'migration.decrypt-api-key-values.shouldRun',
          keyId: key.id,
          valuePrefix: key.key_value.substring(0, 8),
        });
        return true;
      }
    }

    return false;
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    let keysDecrypted = 0;
    let keysAlreadyPlaintext = 0;
    let keysFailed = 0;
    const errors: string[] = [];

    logger.info('Starting API key value decryption migration', {
      context: 'migration.decrypt-api-key-values',
    });

    try {
      const db = getSQLiteDatabase();
      const pepper = process.env.ENCRYPTION_MASTER_PEPPER;

      if (!pepper) {
        return {
          id: 'decrypt-api-key-values-v1',
          success: false,
          itemsAffected: 0,
          message: 'ENCRYPTION_MASTER_PEPPER not set - cannot decrypt keys',
          error: 'ENCRYPTION_MASTER_PEPPER not set',
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }

      // Check if the old iv/authTag columns still exist (pre-drop scenario)
      const columns = getSQLiteTableColumns('api_keys');
      const hasIvColumn = columns.some((c) => c.name === 'iv');
      const hasAuthTagColumn = columns.some((c) => c.name === 'authTag');
      const hasOldColumns = hasIvColumn && hasAuthTagColumn;

      // Build the user IDs to try (SINGLE_USER_ID first, then old ones)
      const userIdsToTry = [SINGLE_USER_ID, ...findOldUserIds()];

      logger.info('User IDs to attempt decryption with', {
        context: 'migration.decrypt-api-key-values',
        userIdCount: userIdsToTry.length,
      });

      // Get all API keys
      let apiKeys: Array<{
        id: string;
        provider: string;
        label: string;
        key_value: string;
        iv?: string;
        authTag?: string;
      }>;

      if (hasOldColumns) {
        apiKeys = db
          .prepare('SELECT id, provider, label, key_value, iv, authTag FROM api_keys')
          .all() as typeof apiKeys;
      } else {
        apiKeys = db
          .prepare('SELECT id, provider, label, key_value FROM api_keys')
          .all() as typeof apiKeys;
      }

      const updateStmt = db.prepare(
        'UPDATE api_keys SET key_value = ?, updatedAt = ? WHERE id = ?',
      );

      for (const key of apiKeys) {
        // Skip keys that are already plaintext
        if (looksLikePlaintext(key.key_value)) {
          keysAlreadyPlaintext++;
          continue;
        }

        let decrypted: string | null = null;

        // Strategy 1: If iv/authTag columns still exist, use them
        if (hasOldColumns && key.iv && key.authTag) {
          for (const userId of userIdsToTry) {
            decrypted = tryDecryptWithParts(key.key_value, key.iv, key.authTag, userId);
            if (decrypted) {
              logger.debug('Decrypted key using iv/authTag columns', {
                context: 'migration.decrypt-api-key-values',
                keyId: key.id,
                provider: key.provider,
              });
              break;
            }
          }
        }

        // Strategy 2: Check if key_value is a JSON blob with all parts
        if (!decrypted) {
          try {
            const parsed = JSON.parse(key.key_value);
            if (parsed.ciphertext && parsed.iv && parsed.authTag) {
              for (const userId of userIdsToTry) {
                decrypted = tryDecryptWithParts(
                  parsed.ciphertext,
                  parsed.iv,
                  parsed.authTag,
                  userId,
                );
                if (decrypted) {
                  logger.debug('Decrypted key from JSON blob in key_value', {
                    context: 'migration.decrypt-api-key-values',
                    keyId: key.id,
                    provider: key.provider,
                  });
                  break;
                }
              }
            }
          } catch {
            // Not JSON, that's fine
          }
        }

        if (decrypted) {
          updateStmt.run(decrypted, new Date().toISOString(), key.id);
          keysDecrypted++;

          logger.info('Decrypted API key value', {
            context: 'migration.decrypt-api-key-values',
            keyId: key.id,
            provider: key.provider,
            label: key.label,
          });
        } else {
          // Key is unrecoverable ciphertext — delete it rather than leave
          // a broken entry that will fail every API call with 401.
          db.prepare('DELETE FROM api_keys WHERE id = ?').run(key.id);
          keysFailed++;
          errors.push(`${key.provider}/${key.label} (${key.id})`);

          logger.warn('Deleted unrecoverable API key (was encrypted ciphertext)', {
            context: 'migration.decrypt-api-key-values',
            keyId: key.id,
            provider: key.provider,
            label: key.label,
          });
        }
      }

      const durationMs = Date.now() - startTime;

      logger.info('API key value decryption migration completed', {
        context: 'migration.decrypt-api-key-values',
        keysDecrypted,
        keysAlreadyPlaintext,
        keysFailed,
        durationMs,
      });

      if (keysFailed > 0) {
        logger.warn(
          'Some API keys could not be decrypted and were deleted — must be re-entered in Settings',
          {
            context: 'migration.decrypt-api-key-values',
            deletedKeys: errors,
          },
        );

        // Surface a user-facing warning via the migration warnings system.
        // Migrations run before startup state is fully initialized, so we
        // push to a global array that startup-state.ts will absorb later.
        const keyNames = errors.map((e) => e.replace(/ \(.*\)$/, '')).join(', ');
        const warning =
          `One regrets to report that certain API keys could not be recovered during ` +
          `the Great Encryption Migration and have been removed. The affected keys ` +
          `(${keyNames}) will need to be re-entered in Settings \u2192 Connections. ` +
          `Our sincerest apologies for the inconvenience.`;

        if (!global.__quilltapMigrationWarnings) {
          global.__quilltapMigrationWarnings = [];
        }
        global.__quilltapMigrationWarnings!.push(warning);

        logger.info('Migration warning queued for user notification', {
          context: 'migration.decrypt-api-key-values',
          warning,
        });
      }

      const messageParts: string[] = [];
      if (keysDecrypted > 0) messageParts.push(`decrypted ${keysDecrypted}`);
      if (keysAlreadyPlaintext > 0) messageParts.push(`${keysAlreadyPlaintext} already plaintext`);
      if (keysFailed > 0) messageParts.push(`${keysFailed} deleted (unrecoverable)`);

      return {
        id: 'decrypt-api-key-values-v1',
        success: true,
        itemsAffected: keysDecrypted + keysFailed,
        message: messageParts.join(', ') || 'No API keys to process',
        durationMs,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('API key value decryption migration failed', {
        context: 'migration.decrypt-api-key-values',
        error: errorMessage,
      });

      return {
        id: 'decrypt-api-key-values-v1',
        success: false,
        itemsAffected: keysDecrypted,
        message: `Migration failed: ${errorMessage}`,
        error: errorMessage,
        durationMs,
        timestamp: new Date().toISOString(),
      };
    }
  },
};
