/**
 * Temporary Backup Storage
 *
 * In-memory storage for backup buffers pending download.
 * This module is isolated to avoid issues with Next.js hot module reloading.
 *
 * In production with multiple workers, consider using Redis or another
 * distributed cache for shared state.
 */

interface TemporaryBackup {
  buffer: Buffer;
  createdAt: Date;
  userId: string;
}

// Singleton storage - using global to survive HMR in development
const globalForBackups = globalThis as unknown as {
  temporaryBackups: Map<string, TemporaryBackup> | undefined;
  backupCleanupInterval: ReturnType<typeof setInterval> | undefined;
};

// Expiry settings
const BACKUP_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * Get the temporary backups storage Map
 * Uses globalThis to survive Next.js hot module reloading
 */
function getStorage(): Map<string, TemporaryBackup> {
  if (!globalForBackups.temporaryBackups) {
    globalForBackups.temporaryBackups = new Map();
  }
  return globalForBackups.temporaryBackups;
}

/**
 * Start the cleanup interval if not already running
 */
function ensureCleanupRunning(): void {
  if (globalForBackups.backupCleanupInterval) {
    return;
  }

  globalForBackups.backupCleanupInterval = setInterval(() => {
    const storage = getStorage();
    const now = new Date();
    let expiredCount = 0;

    for (const [backupId, data] of storage.entries()) {
      if (now.getTime() - data.createdAt.getTime() > BACKUP_EXPIRY_MS) {
        storage.delete(backupId);
        expiredCount++;
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Store a backup buffer temporarily for download
 *
 * @param backupId - Unique identifier for the backup
 * @param buffer - The backup ZIP buffer
 * @param userId - The user who created the backup
 */
export function storeTemporaryBackup(backupId: string, buffer: Buffer, userId: string): void {
  ensureCleanupRunning();

  const storage = getStorage();
  storage.set(backupId, {
    buffer,
    createdAt: new Date(),
    userId,
  });
}

/**
 * Retrieve and remove a temporary backup
 *
 * @param backupId - The backup ID to retrieve
 * @returns The backup data if found, null otherwise
 */
export function retrieveTemporaryBackup(backupId: string): TemporaryBackup | null {
  const storage = getStorage();
  const data = storage.get(backupId);

  if (!data) {
    return null;
  }

  // Remove from storage after retrieval (one-time download)
  storage.delete(backupId);

  return data;
}

/**
 * Check if a temporary backup exists (without removing it)
 *
 * @param backupId - The backup ID to check
 * @returns True if the backup exists
 */
export function hasTemporaryBackup(backupId: string): boolean {
  return getStorage().has(backupId);
}

/**
 * Get the count of stored temporary backups
 */
export function getTemporaryBackupCount(): number {
  return getStorage().size;
}
