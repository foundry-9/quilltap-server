/**
 * Orphan File Recovery Module
 *
 * Provides functionality to detect files in storage backends that don't have
 * corresponding database entries, and to "adopt" them by creating new entries.
 *
 * Use cases:
 * - Recovery after database loss
 * - Files uploaded directly to storage
 * - Migration from other systems
 *
 * @module file-storage/orphan-recovery
 */

import { createHash, randomUUID } from 'crypto';
import { createLogger } from '@/lib/logging/create-logger';
import { fileStorageManager } from './manager';
import { getRepositories } from '@/lib/repositories/factory';
import type { FileEntry, FileSource, FileCategory } from '@/lib/schemas/file.types';

// Simple MIME type lookup by file extension
const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function lookupMimeType(filename: string): string | false {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? MIME_TYPES[ext] || false : false;
}

const logger = createLogger('file-storage:orphan-recovery');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed components from a storage key
 */
export interface ParsedStorageKey {
  userId: string;
  projectId: string | null;
  folderPath: string;
  fileId: string | null;
  filename: string;
}

/**
 * Information about an orphaned file
 */
export interface OrphanFile {
  storageKey: string;
  size: number;
  lastModified?: Date;
  mimeType: string;
  parsed: ParsedStorageKey | null;
}

/**
 * Result of scanning a mount point for orphans
 */
export interface ScanOrphansResult {
  mountPointId: string;
  mountPointName: string;
  scannedAt: Date;
  totalFilesInStorage: number;
  totalFilesInDatabase: number;
  orphans: OrphanFile[];
  errors: string[];
}

/**
 * Options for adopting orphan files
 */
export interface AdoptOrphansOptions {
  storageKeys: string[];
  defaultUserId: string;
  defaultProjectId?: string | null;
  source?: FileSource;
  computeHashes?: boolean;
}

/**
 * Result of adopting orphan files
 */
export interface AdoptOrphansResult {
  adopted: number;
  failed: Array<{ storageKey: string; error: string }>;
  files: FileEntry[];
}

// ============================================================================
// STORAGE KEY PARSING
// ============================================================================

/**
 * Parse a storage key into its component parts
 *
 * Expected format: users/{userId}/{projectId|_general}/{folderPath...}/{fileId}_{filename}
 *
 * @param key - The storage key to parse
 * @returns Parsed components or null if key doesn't match expected format
 */
export function parseStorageKey(key: string): ParsedStorageKey | null {
  // Match: users/{userId}/{projectOrGeneral}/...rest
  const match = key.match(/^users\/([^\/]+)\/([^\/]+)\/(.+)$/);
  if (!match) {
    logger.debug('Storage key does not match expected pattern', { key });
    return null;
  }

  const [, userId, projectOrGeneral, rest] = match;
  const projectId = projectOrGeneral === '_general' ? null : projectOrGeneral;

  // Extract the last path segment (contains fileId_filename)
  const lastSlash = rest.lastIndexOf('/');
  const filenamePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  const folderPath = lastSlash >= 0 ? '/' + rest.slice(0, lastSlash) + '/' : '/';

  // Try to extract fileId (UUID prefix before underscore)
  const underscoreIdx = filenamePart.indexOf('_');
  let fileId: string | null = null;
  let filename: string;

  if (underscoreIdx > 0) {
    const potentialId = filenamePart.slice(0, underscoreIdx);
    // Check if it looks like a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(potentialId)) {
      fileId = potentialId;
      filename = filenamePart.slice(underscoreIdx + 1);
    } else {
      filename = filenamePart;
    }
  } else {
    filename = filenamePart;
  }

  return {
    userId,
    projectId,
    folderPath,
    fileId,
    filename,
  };
}

/**
 * Determine file category from MIME type
 */
function getCategoryFromMimeType(mimeType: string): FileCategory {
  if (mimeType.startsWith('image/')) {
    return 'IMAGE';
  }
  return 'DOCUMENT';
}

/**
 * Generate a placeholder SHA256 hash for orphan files
 * This can be replaced with actual hash computation if needed
 */
function generatePlaceholderHash(): string {
  // Use a recognizable pattern for placeholder hashes
  return '0'.repeat(64);
}

// ============================================================================
// SCAN OPERATIONS
// ============================================================================

/**
 * Scan a mount point for orphaned files
 *
 * Lists all files in the storage backend and compares against database entries.
 * Files that exist in storage but not in the database are considered orphans.
 *
 * @param mountPointId - The mount point to scan
 * @returns Scan results including list of orphan files
 */
export async function scanForOrphans(mountPointId: string): Promise<ScanOrphansResult> {
  logger.info('Starting orphan scan', { mountPointId });
  const startTime = Date.now();

  const errors: string[] = [];
  const orphans: OrphanFile[] = [];
  let totalFilesInStorage = 0;
  let totalFilesInDatabase = 0;

  // Get mount point info
  const mountPoint = fileStorageManager.getMountPoint(mountPointId);
  if (!mountPoint) {
    throw new Error(`Mount point not found: ${mountPointId}`);
  }

  // Get backend
  const backend = await fileStorageManager.getBackend(mountPointId);
  if (!backend) {
    throw new Error(`Could not get backend for mount point: ${mountPointId}`);
  }

  // Check if backend supports listing
  const metadata = backend.getMetadata();
  if (!metadata.capabilities.list) {
    throw new Error(`Backend does not support file listing: ${metadata.providerId}`);
  }

  try {
    // List all files in storage with 'users/' prefix
    if (!backend.list) {
      throw new Error('Backend does not support file listing');
    }
    logger.debug('Listing files in storage', { mountPointId, prefix: 'users/' });
    const storageKeys = await backend.list('users/');
    totalFilesInStorage = storageKeys.length;
    logger.debug('Found files in storage', { mountPointId, count: totalFilesInStorage });

    // Get count of files in database for this mount point
    const repos = getRepositories();
    const dbFiles = await repos.files.findByMountPointId(mountPointId);
    totalFilesInDatabase = dbFiles.length;
    logger.debug('Found files in database', { mountPointId, count: totalFilesInDatabase });

    // Create a Set of known storage keys for fast lookup
    const knownStorageKeys = new Set(
      dbFiles
        .filter((f) => f.storageKey)
        .map((f) => f.storageKey as string)
    );

    // Check each storage key against database
    for (const storageKey of storageKeys) {
      if (knownStorageKeys.has(storageKey)) {
        continue; // File is tracked in database
      }

      // This is an orphan - get its metadata
      try {
        const fileMetadata = backend.getFileMetadata
          ? await backend.getFileMetadata(storageKey)
          : null;
        const parsed = parseStorageKey(storageKey);

        // Determine MIME type from metadata or filename
        let mimeType = fileMetadata?.contentType || 'application/octet-stream';
        if (mimeType === 'application/octet-stream' && parsed?.filename) {
          const guessedType = lookupMimeType(parsed.filename);
          if (guessedType) {
            mimeType = guessedType;
          }
        }

        orphans.push({
          storageKey,
          size: fileMetadata?.size || 0,
          lastModified: fileMetadata?.lastModified,
          mimeType,
          parsed,
        });
      } catch (metaError) {
        const errorMsg = metaError instanceof Error ? metaError.message : String(metaError);
        errors.push(`Failed to get metadata for ${storageKey}: ${errorMsg}`);
        logger.warn('Failed to get orphan file metadata', { storageKey, error: errorMsg });

        // Still add it as an orphan with minimal info
        orphans.push({
          storageKey,
          size: 0,
          mimeType: 'application/octet-stream',
          parsed: parseStorageKey(storageKey),
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Orphan scan complete', {
      mountPointId,
      totalFilesInStorage,
      totalFilesInDatabase,
      orphanCount: orphans.length,
      durationMs: duration,
    });

    return {
      mountPointId,
      mountPointName: mountPoint.name,
      scannedAt: new Date(),
      totalFilesInStorage,
      totalFilesInDatabase,
      orphans,
      errors,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Orphan scan failed', { mountPointId, error: errorMsg });
    throw new Error(`Orphan scan failed: ${errorMsg}`);
  }
}

// ============================================================================
// ADOPT OPERATIONS
// ============================================================================

/**
 * Adopt orphan files by creating database entries for them
 *
 * @param mountPointId - The mount point containing the orphan files
 * @param options - Adoption options including which files to adopt
 * @returns Results of the adoption operation
 */
export async function adoptOrphans(
  mountPointId: string,
  options: AdoptOrphansOptions
): Promise<AdoptOrphansResult> {
  const { storageKeys, defaultUserId, defaultProjectId, source = 'IMPORTED', computeHashes = false } = options;

  logger.info('Starting orphan adoption', {
    mountPointId,
    fileCount: storageKeys.length,
    defaultUserId,
    computeHashes,
  });

  const result: AdoptOrphansResult = {
    adopted: 0,
    failed: [],
    files: [],
  };

  // Get mount point and backend
  const mountPoint = fileStorageManager.getMountPoint(mountPointId);
  if (!mountPoint) {
    throw new Error(`Mount point not found: ${mountPointId}`);
  }

  const backend = await fileStorageManager.getBackend(mountPointId);
  if (!backend) {
    throw new Error(`Could not get backend for mount point: ${mountPointId}`);
  }

  const repos = getRepositories();
  const now = new Date();

  for (const storageKey of storageKeys) {
    try {
      // Check if already in database (might have been adopted since scan)
      const existing = await repos.files.findByStorageKey(storageKey);
      if (existing) {
        logger.debug('File already in database, skipping', { storageKey });
        result.failed.push({ storageKey, error: 'File already exists in database' });
        continue;
      }

      // Parse storage key
      const parsed = parseStorageKey(storageKey);

      // Get file metadata from storage
      const metadata = backend.getFileMetadata
        ? await backend.getFileMetadata(storageKey)
        : null;
      const size = metadata?.size || 0;
      let mimeType = metadata?.contentType || 'application/octet-stream';

      // Try to guess MIME type from filename if not available
      const filename = parsed?.filename || storageKey.split('/').pop() || 'unknown';
      if (mimeType === 'application/octet-stream') {
        const guessedType = lookupMimeType(filename);
        if (guessedType) {
          mimeType = guessedType;
        }
      }

      // Compute SHA256 hash if requested
      let sha256: string;
      if (computeHashes) {
        try {
          const content = await backend.download(storageKey);
          sha256 = createHash('sha256').update(new Uint8Array(content)).digest('hex');
        } catch (hashError) {
          logger.warn('Failed to compute hash, using placeholder', { storageKey });
          sha256 = generatePlaceholderHash();
        }
      } else {
        sha256 = generatePlaceholderHash();
      }

      // Determine userId - prefer parsed, fall back to default
      const userId = parsed?.userId || defaultUserId;

      // Determine projectId - prefer parsed, fall back to default
      const projectId = parsed?.projectId ?? defaultProjectId ?? null;

      // Generate or use parsed fileId
      const fileId = parsed?.fileId || randomUUID();

      // Create file entry
      const fileEntry: Omit<FileEntry, 'createdAt' | 'updatedAt'> = {
        id: fileId,
        userId,
        sha256,
        originalFilename: filename,
        mimeType,
        size,
        linkedTo: [],
        source,
        category: getCategoryFromMimeType(mimeType),
        projectId,
        folderPath: parsed?.folderPath || '/',
        mountPointId,
        storageKey,
        // Image dimensions would require actual image processing
        width: null,
        height: null,
        tags: [],
      };

      // Save to database
      const created = await repos.files.create(fileEntry);
      result.files.push(created);
      result.adopted++;

      logger.debug('Adopted orphan file', {
        storageKey,
        fileId: created.id,
        userId: created.userId,
        projectId: created.projectId,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to adopt orphan file', { storageKey, error: errorMsg });
      result.failed.push({ storageKey, error: errorMsg });
    }
  }

  logger.info('Orphan adoption complete', {
    mountPointId,
    adopted: result.adopted,
    failed: result.failed.length,
  });

  return result;
}
