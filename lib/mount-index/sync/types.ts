/**
 * Shapes shared across the document-store sync.
 *
 * The sync keeps a database-backed store and a directory on disk in step by
 * comparing SHA-256 first and timestamps second. Both sides are reduced to the
 * same {@link SyncEntry} shape before the planner sees them, which is what lets
 * the planner be pure and table-driven — it knows nothing about SQLite or about
 * `fs`, only about entries, a base (the manifest), and the options.
 *
 * @module mount-index/sync/types
 */

import { z } from 'zod';
import type { DocMountFile } from '@/lib/schemas/mount-index.types';

/** Local alias so this module stays free of the repository layer. */
type FileType = DocMountFile['fileType'];

// ============================================================================
// Options
// ============================================================================

/** Which side(s) the run is allowed to change. */
export type SyncDirection = 'both' | 'to-disk' | 'to-store';

/** How a content difference is resolved. */
export type SyncPreference = 'newer' | 'store' | 'disk';

export const SyncOptionsSchema = z.object({
  /** Absolute, server-local directory. Created when absent. */
  targetPath: z.string().min(1),
  /** Plan and report; change nothing on either side, and write no manifest. */
  dryRun: z.boolean().default(false),
  direction: z.enum(['both', 'to-disk', 'to-store']).default('both'),
  prefer: z.enum(['newer', 'store', 'disk']).default('newer'),
  /** False suppresses every `delete` / `rmdir`, on both sides. */
  propagateDeletes: z.boolean().default(true),
  /** False ignores (and does not write) `.quilltap-sync.json` — first-run rules every time. */
  useManifest: z.boolean().default(true),
});

export type SyncOptions = z.infer<typeof SyncOptionsSchema>;

// ============================================================================
// Entries
// ============================================================================

export type SyncSide = 'store' | 'disk';

/**
 * One `(relativePath)` as one side sees it. Files and folders share the shape;
 * a folder has no sha, size, or description.
 *
 * Keys in the maps handed to the planner are lower-cased (the store's index is
 * NOCASE and macOS is case-insensitive); `relativePath` keeps the casing the
 * side actually stores, so an applier writes what that side expects.
 */
export interface SyncEntry {
  relativePath: string;
  kind: 'file' | 'folder';
  /** Files only: SHA-256 of the bytes as they would sit on disk. */
  sha256?: string;
  sizeBytes?: number;
  /** ISO-8601 with milliseconds. */
  lastModified: string;
  /** ISO-8601; null when the side cannot say (Linux birthtime, a fresh folder). */
  createdAt: string | null;
  /** Binaries only: the store's `description`, or the sidecar's body. */
  description?: string;
  descriptionUpdatedAt?: string | null;

  // ---- store-side extras the appliers need and the planner ignores ----
  linkId?: string;
  fileId?: string;
  linkGroupId?: string | null;
  fileType?: FileType;
  folderId?: string | null;
}

/** A side's walk, keyed by lower-cased relative path. */
export type SyncEntryMap = Map<string, SyncEntry>;

// ============================================================================
// Manifest
// ============================================================================

export const ManifestEntrySchema = z.object({
  kind: z.enum(['file', 'folder']),
  sha256: z.string().optional(),
  lastModified: z.string().optional(),
  createdAt: z.string().nullable().optional(),
  /** SHA-256 of the description text, so a sidecar edit is detectable. */
  descriptionSha256: z.string().optional(),
  descriptionUpdatedAt: z.string().nullable().optional(),
});

export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const SyncManifestSchema = z.object({
  version: z.literal(1),
  storeId: z.string().min(1),
  storeName: z.string(),
  lastSyncAt: z.string(),
  entries: z.record(z.string(), ManifestEntrySchema),
});

export type SyncManifest = z.infer<typeof SyncManifestSchema>;

// ============================================================================
// Actions
// ============================================================================

export type SyncActionKind =
  | 'create'
  | 'modify'
  | 'delete'
  | 'touch'
  | 'describe'
  | 'mkdir'
  | 'rmdir'
  | 'conflict'
  | 'skip';

/**
 * One unit of work. `side` is the side that CHANGES — `modify store` means the
 * store is rewritten from disk. `conflict` and `skip` change nothing and carry
 * `side: null`.
 */
export interface SyncAction {
  kind: SyncActionKind;
  side: SyncSide | null;
  /** The path as the changing side should spell it. */
  relativePath: string;
  entryKind: 'file' | 'folder';
  /** Human-readable why, printed in parentheses by the CLI. */
  reason?: string;
  /** Timestamps to stamp on the changing side after the content lands. */
  lastModified?: string;
  createdAt?: string | null;
  /** `describe` only: the text to write (empty string clears). */
  description?: string;
  /** Files only, for the report. */
  sha256?: string;
  sizeBytes?: number;
  /** The store-side link this action acts on (delete / touch / describe / modify). */
  linkId?: string;
  /** The sha the planner saw on the store, for the applier's compare-and-swap. */
  expectedStoreSha256?: string;
  /** Set by the applier when the action did not go through as planned. */
  outcome?: 'applied' | 'skipped' | 'failed' | 'planned';
  error?: string;
}

export interface SyncSummary {
  created: number;
  modified: number;
  deleted: number;
  touched: number;
  described: number;
  conflicts: number;
  skipped: number;
  failed: number;
}

export interface SyncReport {
  storeId: string;
  storeName: string;
  targetPath: string;
  dryRun: boolean;
  actions: SyncAction[];
  summary: SyncSummary;
  warnings: string[];
  elapsedMs: number;
}

// ============================================================================
// Constants
// ============================================================================

/** The verb's own dotfile, and the one dot-entry it does not ignore. */
export const SYNC_MANIFEST_FILENAME = '.quilltap-sync.json';

/** A binary's description lives beside it under this suffix. */
export const SIDECAR_SUFFIX = '.description.md';

/** Scratch suffix for the write-then-rename on the disk side. */
export const DISK_TEMP_SUFFIX = '.quilltap-tmp';

/**
 * Timestamps closer together than this compare equal. Filesystems with
 * one- or two-second resolution (FAT, some network mounts) would otherwise
 * make every run find work to do.
 */
export const MTIME_TOLERANCE_MS = 1000;

/** Only these carry a description, and so only these get a sidecar. */
export const SIDECAR_FILE_TYPES: readonly FileType[] = ['blob', 'pdf', 'docx'];

export function hasSidecar(fileType: FileType | undefined): boolean {
  return fileType !== undefined && SIDECAR_FILE_TYPES.includes(fileType);
}
