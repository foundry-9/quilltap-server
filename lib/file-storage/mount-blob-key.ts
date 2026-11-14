/**
 * Mount-blob storage keys
 *
 * A `files` row whose bytes live in a database-backed document store (the
 * mount-index database) carries a storageKey of the form
 * `mount-blob:<mountPointId>:<blobId>`. Those bytes are never under the
 * instance's `files/` directory.
 *
 * Kept as a dependency-free leaf so that startup code (filesystem
 * reconciliation) can classify keys without importing the repository layer.
 *
 * @module file-storage/mount-blob-key
 */

const STORAGE_KEY_PREFIX = 'mount-blob:';

/**
 * True when the storageKey refers to a blob in a database-backed mount point.
 */
export function isMountBlobStorageKey(storageKey: string | null | undefined): boolean {
  return typeof storageKey === 'string' && storageKey.startsWith(STORAGE_KEY_PREFIX);
}

/**
 * Parse a mount-blob storageKey into its components. Returns null for keys
 * that don't match the scheme, so callers can use the result as a type guard.
 */
export function parseMountBlobStorageKey(
  storageKey: string
): { mountPointId: string; blobId: string } | null {
  if (!isMountBlobStorageKey(storageKey)) return null;
  const rest = storageKey.slice(STORAGE_KEY_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 1 || sep === rest.length - 1) return null;
  return {
    mountPointId: rest.slice(0, sep),
    blobId: rest.slice(sep + 1),
  };
}

/**
 * Build a storage key for a freshly-written mount blob.
 */
export function buildMountBlobStorageKey(mountPointId: string, blobId: string): string {
  return `${STORAGE_KEY_PREFIX}${mountPointId}:${blobId}`;
}
