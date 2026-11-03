/**
 * Cloud placeholder detection — the one place that decides, from a file's
 * `stat`, whether a cloud-sync provider (iCloud Drive, OneDrive Files
 * On-Demand) has evicted it to a placeholder.
 *
 * Reading a placeholder makes the provider download it. That is what the boot
 * step in `lib/startup/materialize-cloud-files.ts` wants for the database files,
 * and exactly what the document-store scanner must not do: a store pointed at
 * an iCloud-synced `~/Documents` faulted in tens of thousands of files one at a
 * time and held the startup gate for its whole five-minute cap.
 *
 * Pure and dependency-free, so the pre-env boot step can import it.
 *
 * @module files/cloud-placeholder
 */

/** Block size that `fs.Stats.blocks` is denominated in (POSIX `st_blocks`). */
export const STAT_BLOCK_BYTES = 512;

/** The two `stat` fields both rules read. */
export type AllocationStat = { size: number; blocks: number };

/**
 * A real file (`size > 0`) whose allocated blocks hold fewer bytes than its
 * size has not finished downloading. Covers both cloud states with one test:
 *   - fully evicted placeholder → `blocks === 0` (mirrors macOS SF_DATALESS)
 *   - partially materialized     → `blocks > 0` but `blocks * 512 < size`
 *
 * Broad on purpose: it is the "must fault this in before SQLite opens it"
 * rule. A filesystem that compresses transparently (APFS decmpfs, ZFS, btrfs)
 * can also report fewer blocks than bytes, which costs that caller only a
 * redundant read. Never use it to decide what to skip — that is
 * {@link isEvictedCloudPlaceholder}.
 */
export function isNotFullyMaterialized(stat: AllocationStat): boolean {
  return stat.size > 0 && stat.blocks * STAT_BLOCK_BYTES < stat.size;
}

/**
 * True when the file is a fully evicted cloud placeholder: it has content
 * (`size > 0`) and no local allocation at all (`blocks === 0`).
 *
 * Narrow on purpose: it decides what a scan leaves alone, so a false positive
 * silently drops a document from the index. A partially downloaded file is
 * already in flight, and a compressed one has blocks, so neither is caught.
 * Only macOS (iCloud Drive) and Windows (OneDrive, where libuv reports the
 * allocation size) have placeholders; elsewhere this is always false.
 */
export function isEvictedCloudPlaceholder(
  stat: AllocationStat,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'darwin' && platform !== 'win32') return false;
  return stat.size > 0 && stat.blocks === 0;
}
