#!/usr/bin/env npx ts-node
/**
 * Migrate to Single-User Mode Script
 *
 * This script migrates an existing user's data to the unauthenticated user
 * (UUID: ffffffff-ffff-ffff-ffff-ffffffffffff), enabling single-user mode
 * without authentication.
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-single-user.ts                    # Interactive mode
 *   npx ts-node scripts/migrate-to-single-user.ts --user-id <uuid>   # Non-interactive
 *   npx ts-node scripts/migrate-to-single-user.ts --dry-run          # Preview changes
 *
 * What this script does:
 * 1. Lists all users in the database
 * 2. Lets you select which user's data to migrate (or accepts --user-id flag)
 * 3. Ensures the unauthenticated user exists
 * 4. Deletes any existing unauthenticated user data (to avoid conflicts)
 * 5. Migrates all user-owned data to the unauthenticated user
 * 6. RE-ENCRYPTS API KEYS with the new user ID (critical for encryption to work!)
 * 7. Moves physical files to the new user's directory
 * 8. Updates .env.local to set AUTH_DISABLED="true"
 * 9. Deletes the source user and their auth data (sessions, accounts)
 */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { getSQLiteDatabasePath, getFilesDir, ensureDataDirectoriesExist } from '../lib/paths';

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

// ============================================================================
// Constants
// ============================================================================

const UNAUTHENTICATED_USER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

// Tables with userId field that need to be migrated
// Order matters for foreign key constraints - migrate dependent tables first
const TABLES_WITH_USER_ID = [
  // Independent tables first
  'tags',
  'api_keys',
  'connection_profiles',
  'image_profiles',
  'embedding_profiles',
  'roleplay_templates',
  'prompt_templates',
  'chat_settings',
  'plugin_configs',
  'projects',
  'mount_points',
  'background_jobs',
  'llm_logs',
  'sync_instances',
  'sync_mappings',
  'sync_operations',
  'user_sync_api_keys',
  // Tables that reference projects/other entities
  'folders',
  'files',
  'characters',
  'chats',
];

// Tables with unique constraints on userId
const TABLES_WITH_UNIQUE_CONSTRAINTS = [
  'tags',           // UNIQUE(userId, nameLower)
  'chat_settings',  // UNIQUE(userId)
  'plugin_configs', // UNIQUE(userId, pluginName)
];

// Encryption constants (must match lib/encryption.ts)
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha256';

// ============================================================================
// Types
// ============================================================================

interface UserSummary {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  createdAt: string;
}

interface MigrationStats {
  tables: Record<string, number>;
  filesMoved: number;
  apiKeysReencrypted: number;
  errors: string[];
}

// ============================================================================
// Encryption Functions (duplicated to avoid import issues)
// ============================================================================

function getMasterPepper(): string {
  const pepper = process.env.ENCRYPTION_MASTER_PEPPER || '';
  if (!pepper) {
    console.error('ERROR: ENCRYPTION_MASTER_PEPPER environment variable is not set');
    console.error('This is required to re-encrypt API keys during migration.');
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

// ============================================================================
// CLI Argument Parsing
// ============================================================================

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const userIdFlagIndex = args.indexOf('--user-id');
const specifiedUserId = userIdFlagIndex !== -1 ? args[userIdFlagIndex + 1] : null;

// ============================================================================
// Database Access
// ============================================================================

function getDatabase(): DatabaseType {
  ensureDataDirectoriesExist();
  const dbPath = getSQLiteDatabasePath();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`);
    console.error('Please ensure Quilltap has been run at least once to create the database.');
    process.exit(1);
  }

  const db = new Database(dbPath);
  // SQLCipher key must be first pragma
  const sqlcipherKey = process.env.ENCRYPTION_MASTER_PEPPER;
  if (sqlcipherKey) {
    const keyHex = Buffer.from(sqlcipherKey, 'base64').toString('hex');
    db.pragma(`key = "x'${keyHex}'"`);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF'); // Disable during migration to avoid constraint issues
  db.pragma('busy_timeout = 5000');

  return db;
}

// ============================================================================
// User Management
// ============================================================================

function listUsers(db: DatabaseType): UserSummary[] {
  const users = db.prepare(`
    SELECT id, username, email, name, createdAt
    FROM users
    WHERE id != ?
    ORDER BY createdAt DESC
  `).all(UNAUTHENTICATED_USER_ID) as UserSummary[];

  return users;
}

function getUserById(db: DatabaseType, userId: string): UserSummary | null {
  return db.prepare(`
    SELECT id, username, email, name, createdAt
    FROM users
    WHERE id = ?
  `).get(userId) as UserSummary | null;
}

function ensureUnauthenticatedUserExists(db: DatabaseType): void {
  const existingUser = db.prepare(`
    SELECT id FROM users WHERE id = ?
  `).get(UNAUTHENTICATED_USER_ID);

  if (!existingUser) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, username, email, name, passwordHash, totp, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, NULL, '{}', ?, ?)
    `).run(
      UNAUTHENTICATED_USER_ID,
      'unauthenticatedLocalUser',
      'unauthenticated@localhost.localdomain',
      'Unauthenticated Local User',
      now,
      now
    );
    console.log('Created unauthenticated user');
  }
}

// ============================================================================
// Data Migration
// ============================================================================

function clearUnauthenticatedUserData(db: DatabaseType): void {
  console.log('\nClearing existing unauthenticated user data...');

  // Clear all tables in reverse order to handle any potential dependencies
  const tablesToClear = [...TABLES_WITH_USER_ID].reverse();

  for (const table of tablesToClear) {
    try {
      // Check if table has userId column (some might be nullable)
      const tableInfo = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
      const hasUserId = tableInfo.some(col => col.name === 'userId');

      if (hasUserId) {
        const result = db.prepare(`DELETE FROM "${table}" WHERE userId = ?`).run(UNAUTHENTICATED_USER_ID);
        if (result.changes > 0) {
          console.log(`  Cleared ${result.changes} rows from ${table}`);
        }
      }
    } catch (error) {
      // Table might not exist - ignore
      console.log(`  Skipped ${table} (table may not exist)`);
    }
  }
}

function migrateTableData(db: DatabaseType, sourceId: string, targetId: string, dryRun: boolean): Record<string, number> {
  const stats: Record<string, number> = {};

  console.log('\nMigrating table data...');

  for (const table of TABLES_WITH_USER_ID) {
    try {
      // Check if table exists and has userId column
      const tableInfo = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
      const hasUserId = tableInfo.some(col => col.name === 'userId');

      if (!hasUserId) {
        continue;
      }

      // Count rows to migrate
      const countResult = db.prepare(`SELECT COUNT(*) as count FROM "${table}" WHERE userId = ?`).get(sourceId) as { count: number };

      if (countResult.count === 0) {
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would migrate ${countResult.count} rows in ${table}`);
        stats[table] = countResult.count;
      } else {
        // Update userId from source to target
        const result = db.prepare(`UPDATE "${table}" SET userId = ? WHERE userId = ?`).run(targetId, sourceId);
        console.log(`  Migrated ${result.changes} rows in ${table}`);
        stats[table] = result.changes;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  Error migrating ${table}: ${errorMsg}`);
    }
  }

  return stats;
}

function migrateFiles(db: DatabaseType, sourceId: string, targetId: string, dryRun: boolean): number {
  const filesDir = getFilesDir();
  const sourceDir = path.join(filesDir, 'users', sourceId);
  const targetDir = path.join(filesDir, 'users', targetId);

  console.log('\nMigrating physical files...');
  console.log(`  Source: ${sourceDir}`);
  console.log(`  Target: ${targetDir}`);

  if (!fs.existsSync(sourceDir)) {
    console.log('  No physical files to migrate');
    return 0;
  }

  // Count files
  const fileCount = countFilesRecursive(sourceDir);

  if (dryRun) {
    console.log(`  [DRY RUN] Would move ${fileCount} files`);
    console.log(`  [DRY RUN] Would update storageKey in files table`);
    return fileCount;
  }

  // Ensure target parent directory exists
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  // If target directory exists, merge contents
  if (fs.existsSync(targetDir)) {
    console.log('  Target directory exists, merging contents...');
    // Move contents from source to target
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(sourceDir, entry.name);
      const destPath = path.join(targetDir, entry.name);
      if (!fs.existsSync(destPath)) {
        fs.renameSync(srcPath, destPath);
      } else if (entry.isDirectory()) {
        // Recursively merge directories
        mergeDirectories(srcPath, destPath);
      }
    }
    // Remove source directory if empty
    try {
      fs.rmdirSync(sourceDir, { recursive: true });
    } catch {
      // Ignore if not empty
    }
  } else {
    // Simple rename
    fs.renameSync(sourceDir, targetDir);
  }

  console.log(`  Moved ${fileCount} files`);

  // Update storageKey in database
  const result = db.prepare(`
    UPDATE files
    SET storageKey = replace(storageKey, ?, ?)
    WHERE userId = ? AND storageKey LIKE ?
  `).run(
    `users/${sourceId}/`,
    `users/${targetId}/`,
    targetId, // userId was already updated
    `%users/${sourceId}/%`
  );

  if (result.changes > 0) {
    console.log(`  Updated ${result.changes} storageKey references`);
  }

  return fileCount;
}

function mergeDirectories(source: string, target: string): void {
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);
    if (!fs.existsSync(destPath)) {
      fs.renameSync(srcPath, destPath);
    } else if (entry.isDirectory()) {
      mergeDirectories(srcPath, destPath);
    }
    // If file exists at destination, leave it (source user's file takes precedence since we already migrated userId)
  }
}

function reencryptApiKeys(db: DatabaseType, sourceId: string, targetId: string, dryRun: boolean): number {
  console.log('\nRe-encrypting API keys...');

  // Get all API keys for the source user (they haven't been migrated yet)
  const apiKeys = db.prepare(`
    SELECT id, provider, label, ciphertext, iv, authTag
    FROM api_keys
    WHERE userId = ?
  `).all(sourceId) as Array<{
    id: string;
    provider: string;
    label: string;
    ciphertext: string;
    iv: string;
    authTag: string;
  }>;

  if (apiKeys.length === 0) {
    console.log('  No API keys to re-encrypt');
    return 0;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would re-encrypt ${apiKeys.length} API key(s)`);
    return apiKeys.length;
  }

  let reencrypted = 0;
  const updateStmt = db.prepare(`
    UPDATE api_keys
    SET ciphertext = ?, iv = ?, authTag = ?, userId = ?, updatedAt = ?
    WHERE id = ?
  `);

  for (const key of apiKeys) {
    try {
      // Decrypt with old user ID
      const plaintext = decryptApiKey(key.ciphertext, key.iv, key.authTag, sourceId);

      // Re-encrypt with new user ID
      const encrypted = encryptApiKey(plaintext, targetId);

      // Update the record
      updateStmt.run(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag,
        targetId,
        new Date().toISOString(),
        key.id
      );

      console.log(`  Re-encrypted: ${key.provider} / ${key.label}`);
      reencrypted++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`  ERROR re-encrypting ${key.provider} / ${key.label}: ${errorMsg}`);
      // Don't throw - continue with other keys
    }
  }

  console.log(`  Re-encrypted ${reencrypted} of ${apiKeys.length} API key(s)`);
  return reencrypted;
}

function countFilesRecursive(dir: string): number {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        count++;
      } else if (entry.isDirectory()) {
        count += countFilesRecursive(path.join(dir, entry.name));
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return count;
}

function copyUserProfile(db: DatabaseType, sourceUser: UserSummary, dryRun: boolean): void {
  console.log('\nCopying user profile to unauthenticated user...');

  if (dryRun) {
    console.log(`  [DRY RUN] Would update unauthenticated user name to: ${sourceUser.name || sourceUser.username}`);
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users
    SET name = ?, updatedAt = ?
    WHERE id = ?
  `).run(sourceUser.name || sourceUser.username, now, UNAUTHENTICATED_USER_ID);

  console.log(`  Updated unauthenticated user name to: ${sourceUser.name || sourceUser.username}`);
}

// ============================================================================
// Environment File Update
// ============================================================================

function updateEnvFile(sourceUser: UserSummary, dryRun: boolean): void {
  console.log('\nUpdating environment file...');

  const envPath = path.join(process.cwd(), '.env.local');
  const userName = sourceUser.name || sourceUser.username;

  if (dryRun) {
    console.log(`  [DRY RUN] Would set AUTH_DISABLED="true" in ${envPath}`);
    console.log(`  [DRY RUN] Would set AUTH_UNAUTHENTICATED_USER_NAME="${userName}"`);
    return;
  }

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  // Update or add AUTH_DISABLED
  content = updateEnvVar(content, 'AUTH_DISABLED', 'true');

  // Update or add AUTH_UNAUTHENTICATED_USER_NAME
  content = updateEnvVar(content, 'AUTH_UNAUTHENTICATED_USER_NAME', userName);

  fs.writeFileSync(envPath, content, 'utf8');
  console.log(`  Set AUTH_DISABLED="true" in ${envPath}`);
  console.log(`  Set AUTH_UNAUTHENTICATED_USER_NAME="${userName}"`);
}

function updateEnvVar(content: string, key: string, value: string): string {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const newLine = `${key}="${value}"`;

  if (regex.test(content)) {
    return content.replace(regex, newLine);
  } else {
    // Append with newline if content doesn't end with one
    const separator = content.endsWith('\n') ? '' : '\n';
    return content + separator + newLine + '\n';
  }
}

// ============================================================================
// Cleanup
// ============================================================================

function cleanupSourceUser(db: DatabaseType, sourceId: string, dryRun: boolean): void {
  console.log('\nCleaning up source user...');

  if (dryRun) {
    console.log(`  [DRY RUN] Would delete sessions for user ${sourceId}`);
    console.log(`  [DRY RUN] Would delete accounts for user ${sourceId}`);
    console.log(`  [DRY RUN] Would delete user ${sourceId}`);
    return;
  }

  // Delete sessions
  const sessionsResult = db.prepare('DELETE FROM sessions WHERE userId = ?').run(sourceId);
  console.log(`  Deleted ${sessionsResult.changes} sessions`);

  // Delete OAuth accounts
  const accountsResult = db.prepare('DELETE FROM accounts WHERE userId = ?').run(sourceId);
  console.log(`  Deleted ${accountsResult.changes} OAuth accounts`);

  // Delete the user
  const userResult = db.prepare('DELETE FROM users WHERE id = ?').run(sourceId);
  console.log(`  Deleted ${userResult.changes} user`);
}

// ============================================================================
// Interactive User Selection
// ============================================================================

async function promptUserSelection(users: UserSummary[]): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('\nAvailable users:\n');
    users.forEach((user, index) => {
      const displayName = user.name || user.username;
      const email = user.email ? ` (${user.email})` : '';
      console.log(`  ${index + 1}. ${displayName}${email}`);
      console.log(`     ID: ${user.id}`);
      console.log(`     Created: ${user.createdAt}`);
      console.log();
    });

    rl.question('Enter the number of the user to migrate: ', (answer) => {
      rl.close();
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < users.length) {
        resolve(users[index].id);
      } else {
        console.error('Invalid selection');
        process.exit(1);
      }
    });
  });
}

async function confirmMigration(user: UserSummary, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const displayName = user.name || user.username;
    console.log(`\nAbout to migrate all data from "${displayName}" to the unauthenticated user.`);
    console.log('This will:');
    console.log('  - Move all characters, chats, files, and settings');
    console.log('  - Delete the source user account');
    console.log('  - Enable AUTH_DISABLED mode');
    console.log('\nThis action cannot be undone.\n');

    rl.question('Are you sure you want to proceed? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('=== Migrate to Single-User Mode ===\n');

  if (isDryRun) {
    console.log('Running in DRY RUN mode - no changes will be made\n');
  }

  const db = getDatabase();

  try {
    // List available users
    const users = listUsers(db);

    if (users.length === 0) {
      console.log('No users found to migrate.');
      console.log('If you want to enable single-user mode, set AUTH_DISABLED="true" in .env.local');
      process.exit(0);
    }

    // Select user
    let selectedUserId: string;

    if (specifiedUserId) {
      // Validate specified user ID
      const user = getUserById(db, specifiedUserId);
      if (!user) {
        console.error(`User not found: ${specifiedUserId}`);
        console.log('\nAvailable users:');
        users.forEach(u => {
          console.log(`  - ${u.id} (${u.name || u.username})`);
        });
        process.exit(1);
      }
      if (specifiedUserId === UNAUTHENTICATED_USER_ID) {
        console.error('Cannot migrate the unauthenticated user to itself');
        process.exit(1);
      }
      selectedUserId = specifiedUserId;
    } else {
      // Interactive selection
      selectedUserId = await promptUserSelection(users);
    }

    const sourceUser = getUserById(db, selectedUserId)!;

    // Confirm
    const confirmed = await confirmMigration(sourceUser, isDryRun);
    if (!confirmed) {
      console.log('Migration cancelled');
      process.exit(0);
    }

    const stats: MigrationStats = {
      tables: {},
      filesMoved: 0,
      apiKeysReencrypted: 0,
      errors: [],
    };

    // Run migration in a transaction (except for dry run)
    const runMigration = () => {
      // Step 1: Ensure unauthenticated user exists
      ensureUnauthenticatedUserExists(db);

      // Step 2: Clear existing unauthenticated user data
      if (!isDryRun) {
        clearUnauthenticatedUserData(db);
      } else {
        console.log('\n[DRY RUN] Would clear existing unauthenticated user data');
      }

      // Step 3: Re-encrypt API keys (MUST be done before table migration!)
      // This decrypts with the old user ID and re-encrypts with the new user ID
      stats.apiKeysReencrypted = reencryptApiKeys(db, selectedUserId, UNAUTHENTICATED_USER_ID, isDryRun);

      // Step 4: Migrate table data (api_keys already migrated by reencryptApiKeys)
      stats.tables = migrateTableData(db, selectedUserId, UNAUTHENTICATED_USER_ID, isDryRun);

      // Step 5: Migrate physical files
      stats.filesMoved = migrateFiles(db, selectedUserId, UNAUTHENTICATED_USER_ID, isDryRun);

      // Step 6: Copy user profile
      copyUserProfile(db, sourceUser, isDryRun);

      // Step 7: Update environment file
      updateEnvFile(sourceUser, isDryRun);

      // Step 8: Cleanup source user
      cleanupSourceUser(db, selectedUserId, isDryRun);
    };

    if (isDryRun) {
      runMigration();
    } else {
      // Use a transaction for atomicity
      const transaction = db.transaction(runMigration);
      transaction();
    }

    // Summary
    console.log('\n=== Migration Summary ===');
    console.log(`Source user: ${sourceUser.name || sourceUser.username} (${sourceUser.id})`);
    console.log(`Target user: unauthenticated (${UNAUTHENTICATED_USER_ID})`);

    const totalRows = Object.values(stats.tables).reduce((a, b) => a + b, 0);
    console.log(`\nData migrated:`);
    console.log(`  Tables updated: ${Object.keys(stats.tables).length}`);
    console.log(`  Total rows: ${totalRows}`);
    console.log(`  API keys re-encrypted: ${stats.apiKeysReencrypted}`);
    console.log(`  Files moved: ${stats.filesMoved}`);

    if (stats.errors.length > 0) {
      console.log('\nErrors:');
      stats.errors.forEach(err => console.log(`  - ${err}`));
    }

    if (isDryRun) {
      console.log('\n[DRY RUN] No changes were made. Run without --dry-run to apply changes.');
    } else {
      console.log('\nMigration complete!');
      console.log('\nNext steps:');
      console.log('  1. Restart the Quilltap server');
      console.log('  2. You will be automatically logged in as the unauthenticated user');
      console.log('  3. All your data should be accessible');
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch(console.error);
