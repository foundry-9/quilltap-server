/**
 * Restore Service
 *
 * Restores user data from a backup ZIP archive to the database and file storage.
 * Uses shell `unzip` to extract to a temp directory on disk — no in-memory zip
 * operations to avoid OOM in memory-constrained VMs.
 *
 * Supports two modes:
 * - 'replace': Deletes existing data and restores from backup
 * - 'new-account': Regenerates all UUIDs and imports to a new account
 *
 * --------------------------------------------------------------------------
 * This file is a barrel: the implementation lives in `restore/`, grouped by
 * responsibility. Import sites continue to reach everything through this
 * module path.
 *
 *   - legacy-migrations.ts — fold pre-rework backup shapes (pure transforms)
 *   - json-stream.ts       — disk-backed/streaming JSON readers
 *   - archive.ts           — zip extract, parse, and extracted-dir readers
 *   - delete-service.ts    — user-data deletion + delete previews
 *   - uuid-remap.ts        — new-account UUID remapping
 *   - preview.ts           — restore preview (count-only, no writes)
 *   - restore.ts           — the restore orchestrator
 *
 * @module backup/restore-service
 */

export {
  parseBackupZip,
  getFileFromExtractedBackup,
} from './restore/archive';

export { previewRestore } from './restore/preview';

export {
  type DeleteSummary,
  deleteAllUserData,
  previewDeleteAllUserData,
} from './restore/delete-service';

export { restore } from './restore/restore';
