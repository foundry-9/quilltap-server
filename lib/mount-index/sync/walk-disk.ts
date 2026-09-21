/**
 * One read of the target directory, reduced to the same {@link SyncEntry}
 * shape as the store walk.
 *
 * Three rules do most of the work here:
 *
 *   - **Dot-entries are invisible.** A file or folder whose name begins with
 *     `.` is never read, never pushed, and never deleted — which covers
 *     `.DS_Store`, `.git`, the editor's swap files, and the verb's own
 *     manifest. The store walk applies the same rule, so the invisibility is
 *     symmetric: nothing in the store with a dot-path is written out either.
 *   - **Sidecars are not entries.** `<file>.description.md` is collected
 *     separately and attached to its partner's `description`. A sidecar with
 *     no partner is a warning.
 *   - **Text-native files are hashed as bytes**, exactly as the store hashes
 *     them, so the two sides' shas are comparable without decoding anything.
 *     A `.md` that is not valid UTF-8 cannot be held verbatim by a database
 *     store and is reported rather than mangled.
 *
 * @module mount-index/sync/walk-disk
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { matchesPattern } from '@/lib/mount-index/scanner';
import { detectNativeText } from '@/lib/mount-index/path-utils';
import { isSidecarPath, parseSidecar, partnerPathFor } from './sidecar';
import { DISK_TEMP_SUFFIX, type SyncEntry, type SyncEntryMap } from './types';

export interface DiskWalkResult {
  entries: SyncEntryMap;
  warnings: string[];
  /** Disk paths whose own name ends in the sidecar suffix but match nothing. */
  orphanSidecars: string[];
  /** Disk paths that could not be read, or that a database store cannot hold. */
  unreadable: string[];
}

interface PendingSidecar {
  partnerKey: string;
  relativePath: string;
  text: string;
  mtime: string;
}

export async function walkDisk(
  targetPath: string,
  excludePatterns: string[]
): Promise<DiskWalkResult> {
  const entries: SyncEntryMap = new Map();
  const warnings: string[] = [];
  const orphanSidecars: string[] = [];
  const unreadable: string[] = [];
  const sidecars: PendingSidecar[] = [];
  /** Lower-cased key → the casing already claimed, so a collision is detectable. */
  const claimed = new Map<string, string>();

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = relativeDir ? path.join(targetPath, relativeDir) : targetPath;
    let dirents;
    try {
      dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch (err) {
      // A target that does not exist yet is not an error — it is an empty
      // side, which is exactly what `--dry-run` against a new path should see.
      // (A real run has already created it by this point.)
      if (relativeDir === '' && (err as NodeJS.ErrnoException).code === 'ENOENT') return;
      unreadable.push(relativeDir || '.');
      warnings.push(
        `Could not read ${relativeDir || 'the target directory'}: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    for (const dirent of dirents) {
      // Dot-entries — and their whole subtree — are as good as absent.
      if (dirent.name.startsWith('.')) continue;
      // A previous run's interrupted write, not a document.
      if (dirent.name.endsWith(DISK_TEMP_SUFFIX)) continue;

      const relativePath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;

      if (excludePatterns.some(pattern => matchesPattern(relativePath, pattern))) continue;

      // A symlink is neither followed nor copied: resolving it would let a
      // link inside the target pull bytes from anywhere on the host into the
      // store, and copying it would put the wrong thing on the other side.
      if (dirent.isSymbolicLink()) {
        warnings.push(`${relativePath} is a symbolic link and is skipped`);
        continue;
      }

      const absolutePath = path.join(targetPath, relativePath);
      const key = relativePath.toLowerCase();

      if (dirent.isDirectory()) {
        const stat = await statOrNull(absolutePath);
        if (!stat) { unreadable.push(relativePath); continue; }
        if (noteCollision(claimed, key, relativePath, entries, warnings)) continue;
        entries.set(key, {
          relativePath,
          kind: 'folder',
          lastModified: stat.mtime.toISOString(),
          createdAt: birthtimeOf(stat),
        });
        await walk(relativePath);
        continue;
      }

      if (!dirent.isFile()) continue;

      const stat = await statOrNull(absolutePath);
      if (!stat) { unreadable.push(relativePath); continue; }

      let bytes: Buffer;
      try {
        bytes = await fs.readFile(absolutePath);
      } catch (err) {
        unreadable.push(relativePath);
        warnings.push(
          `Could not read ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
        );
        continue;
      }

      if (isSidecarPath(relativePath)) {
        const partner = partnerPathFor(relativePath);
        if (partner) {
          sidecars.push({
            partnerKey: partner.toLowerCase(),
            relativePath,
            text: parseSidecar(bytes.toString('utf-8')),
            mtime: stat.mtime.toISOString(),
          });
        }
        continue;
      }

      // A database store holds text-native content as a string, so a `.md`
      // that is not valid UTF-8 could not be stored verbatim — and a sync that
      // is not byte-preserving never converges.
      if (detectNativeText(relativePath) && !isValidUtf8(bytes)) {
        unreadable.push(relativePath);
        warnings.push(
          `${relativePath} has a text extension but is not valid UTF-8; a database store cannot hold it verbatim`
        );
        continue;
      }

      if (noteCollision(claimed, key, relativePath, entries, warnings)) continue;

      entries.set(key, {
        relativePath,
        kind: 'file',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
        lastModified: stat.mtime.toISOString(),
        createdAt: birthtimeOf(stat),
      });
    }
  }

  await walk('');

  // Attach every sidecar to its partner. One that matches nothing is reported
  // rather than deleted — it may belong to a file the operator is about to add.
  for (const sidecar of sidecars) {
    const partner = entries.get(sidecar.partnerKey);
    if (!partner) {
      orphanSidecars.push(sidecar.relativePath);
      warnings.push(`${sidecar.relativePath} describes a file that is not here`);
      continue;
    }
    partner.description = sidecar.text;
    partner.descriptionUpdatedAt = sidecar.mtime;
  }

  logger.debug('[Sync] Disk walk complete', {
    targetPath,
    entries: entries.size,
    sidecars: sidecars.length,
    orphanSidecars: orphanSidecars.length,
    unreadable: unreadable.length,
  });

  return { entries, warnings, orphanSidecars, unreadable };
}

// ============================================================================
// Helpers
// ============================================================================

async function statOrNull(absolutePath: string) {
  try {
    return await fs.stat(absolutePath);
  } catch {
    return null;
  }
}

/**
 * The creation date, where the platform keeps one.
 *
 * Linux reports `birthtime` as the epoch (or as `ctime`, on filesystems that
 * fake it) rather than admitting it does not know; either answer is worse than
 * none, because it would make every first run plan a `touch` that cannot
 * succeed. The manifest carries the real value in those cases.
 */
function birthtimeOf(stat: import('fs').Stats): string | null {
  const birth = stat.birthtimeMs;
  if (!birth || birth <= 0) return null;
  if (Math.abs(birth - stat.ctimeMs) < 1) return null;
  return new Date(birth).toISOString();
}

/**
 * On a case-sensitive filesystem the target may hold `Notes.md` and `notes.md`
 * side by side. The store's index is NOCASE and cannot, so there is no answer
 * the sync could apply — both are refused, loudly.
 */
function noteCollision(
  claimed: Map<string, string>,
  key: string,
  relativePath: string,
  entries: SyncEntryMap,
  warnings: string[]
): boolean {
  const already = claimed.get(key);
  if (already === undefined) {
    claimed.set(key, relativePath);
    return false;
  }
  warnings.push(
    `${relativePath} and ${already} differ only by case; a database store cannot hold both, so neither is synced`
  );
  entries.delete(key);
  return true;
}

/** Round-trips through UTF-8 unchanged. */
function isValidUtf8(bytes: Buffer): boolean {
  return Buffer.compare(Buffer.from(bytes.toString('utf-8'), 'utf-8'), bytes) === 0;
}
