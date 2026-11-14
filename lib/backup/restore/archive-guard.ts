/**
 * Limits and containment for a backup archive on its way in.
 *
 * A backup is extracted to a temp directory and then read file by file. The
 * rules held here:
 *   - before extraction, the archive's central directory is listed and the
 *     entry count and total uncompressed size are capped; an entry stored as a
 *     symbolic link, or whose name is absolute or climbs out with `..`, refuses
 *     the whole archive;
 *   - after extraction, the tree is walked with `lstat`: any symbolic link
 *     refuses the archive, and the real on-disk size is held to the same cap;
 *   - every archive-relative read goes through {@link readArchiveFile}, which
 *     resolves the path inside the extract root (realpath on both sides) and
 *     reads only a regular file.
 *
 * @module backup/restore/archive-guard
 */

import fs from 'fs';
import path from 'path';
import yauzl from 'yauzl';
import { logger } from '@/lib/logger';
import { resolveInside } from '@/lib/paths/resolve-inside';

const moduleLogger = logger.child({ module: 'backup:archive-guard' });

export interface BackupArchiveLimits {
  /** Most entries (files and directories) an archive may hold. */
  maxEntries: number;
  /** Most bytes the archive may expand to. */
  maxTotalUncompressedBytes: number;
}

export const BACKUP_ARCHIVE_LIMITS: BackupArchiveLimits = {
  maxEntries: 500_000,
  maxTotalUncompressedBytes: 64 * 1024 * 1024 * 1024, // 64 GiB
};

/** Thrown when an archive breaks one of the rules above. */
export class BackupArchiveRefusedError extends Error {
  constructor(message: string) {
    super(`Invalid backup: ${message}`);
    this.name = 'BackupArchiveRefusedError';
  }
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** True when a zip entry's Unix mode bits mark it as a symbolic link. */
export function isSymlinkZipEntry(entry: Pick<yauzl.Entry, 'externalFileAttributes' | 'versionMadeBy'>): boolean {
  // The high byte of versionMadeBy is the host system; 3 is Unix, 19 is macOS.
  const host = (entry.versionMadeBy >> 8) & 0xff;
  if (host !== 3 && host !== 19) return false;
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & S_IFMT) === S_IFLNK;
}

function hasUnsafeName(name: string): boolean {
  if (name.includes('\0')) return true;
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) return true;
  return name.split(/[\\/]+/).some((segment) => segment === '..');
}

/**
 * List the archive's central directory and enforce the entry, size, name and
 * symlink rules without extracting anything.
 */
export async function inspectBackupArchive(
  zipPath: string,
  limits: BackupArchiveLimits = BACKUP_ARCHIVE_LIMITS
): Promise<{ entryCount: number; totalUncompressedBytes: number }> {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zf) => {
      if (err || !zf) reject(new BackupArchiveRefusedError(`not a readable ZIP archive (${err?.message ?? 'unknown error'})`));
      else resolve(zf);
    });
  });

  if (zipFile.entryCount > limits.maxEntries) {
    zipFile.close();
    throw new BackupArchiveRefusedError(
      `archive holds ${zipFile.entryCount} entries, more than the limit of ${limits.maxEntries}`
    );
  }

  return new Promise((resolve, reject) => {
    let entryCount = 0;
    let totalUncompressedBytes = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('entry', (entry: yauzl.Entry) => {
      entryCount++;
      totalUncompressedBytes += entry.uncompressedSize;
      if (hasUnsafeName(entry.fileName)) {
        fail(new BackupArchiveRefusedError(`entry name is not a plain relative path: ${entry.fileName}`));
        return;
      }
      if (isSymlinkZipEntry(entry)) {
        fail(new BackupArchiveRefusedError(`entry is a symbolic link: ${entry.fileName}`));
        return;
      }
      if (entryCount > limits.maxEntries) {
        fail(new BackupArchiveRefusedError(`archive holds more than ${limits.maxEntries} entries`));
        return;
      }
      if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
        fail(new BackupArchiveRefusedError(
          `archive expands past the limit of ${limits.maxTotalUncompressedBytes} bytes`
        ));
        return;
      }
      zipFile.readEntry();
    });
    zipFile.on('end', () => {
      if (settled) return;
      settled = true;
      moduleLogger.debug('Backup archive listing within limits', { zipPath, entryCount, totalUncompressedBytes });
      resolve({ entryCount, totalUncompressedBytes });
    });
    zipFile.on('error', (err: Error) => fail(new BackupArchiveRefusedError(err.message)));
    zipFile.readEntry();
  });
}

/**
 * Walk an extracted tree with `lstat`. A symbolic link anywhere, or a real
 * size or entry count past the limits, refuses the archive.
 */
export async function verifyExtractedTree(
  dir: string,
  limits: BackupArchiveLimits = BACKUP_ARCHIVE_LIMITS
): Promise<{ entryCount: number; totalBytes: number }> {
  let entryCount = 0;
  let totalBytes = 0;
  const pending: string[] = [dir];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const st = await fs.promises.lstat(full);
      entryCount++;
      if (st.isSymbolicLink()) {
        throw new BackupArchiveRefusedError(`extracted entry is a symbolic link: ${path.relative(dir, full)}`);
      }
      if (st.isDirectory()) {
        pending.push(full);
      } else if (st.isFile()) {
        totalBytes += st.size;
      } else {
        throw new BackupArchiveRefusedError(`extracted entry is not a regular file: ${path.relative(dir, full)}`);
      }
      if (entryCount > limits.maxEntries) {
        throw new BackupArchiveRefusedError(`archive holds more than ${limits.maxEntries} entries`);
      }
      if (totalBytes > limits.maxTotalUncompressedBytes) {
        throw new BackupArchiveRefusedError(
          `archive expands past the limit of ${limits.maxTotalUncompressedBytes} bytes`
        );
      }
    }
  }

  moduleLogger.debug('Extracted backup tree verified', { dir, entryCount, totalBytes });
  return { entryCount, totalBytes };
}

/**
 * Read one file from the extracted archive by its archive-relative path. The
 * path must resolve inside `rootPath` (symlinks resolved on both sides) and
 * name a regular file; anything else throws. A missing file throws `ENOENT`.
 */
export async function readArchiveFile(rootPath: string, relPath: string): Promise<Buffer> {
  const absolutePath = await resolveInside(rootPath, relPath, { realpath: true, allowBase: false });
  const st = await fs.promises.lstat(absolutePath);
  if (!st.isFile()) {
    moduleLogger.debug('Refusing archive read of a non-regular file', { relPath });
    throw new BackupArchiveRefusedError(`not a regular file: ${relPath}`);
  }
  return fs.promises.readFile(absolutePath);
}

/**
 * Names of the npm plugins a backup carries under `plugins/npm/`. Only the
 * directory names are read; nothing inside them is opened or installed.
 */
export async function listNpmPluginsInExtractedBackup(rootPath: string): Promise<string[]> {
  const pluginsPath = path.join(rootPath, 'plugins', 'npm');
  try {
    const entries = await fs.promises.readdir(pluginsPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      // Scoped packages are stored as `@org--name`.
      .map((e) => (e.name.startsWith('@') && e.name.includes('--') ? e.name.replace('--', '/') : e.name))
      .sort();
  } catch {
    return [];
  }
}
