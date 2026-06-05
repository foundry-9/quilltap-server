/**
 * Quilltap Import Service
 *
 * Handles importing of Quilltap export format JSON files with conflict resolution.
 * Supports three conflict strategies: skip, overwrite, and duplicate.
 *
 * --------------------------------------------------------------------------
 * This file is a barrel: the implementation lives in `quilltap-import/`,
 * grouped by responsibility. Import sites continue to reach everything through
 * this module path.
 *
 *   - types.ts                  — shared types + public preview/options/result interfaces
 *   - legacy-presets.ts         — fold pre-rework outfit presets into composites
 *   - validation.ts             — parse + validate the export file
 *   - import-profiles.ts        — connection/image/embedding profile importers
 *   - import-characters.ts      — character + wardrobe + plugin-data importers
 *   - import-entities.ts        — tag/roleplay/project/chat/memory importers
 *   - import-document-stores.ts — Scriptorium mount-point/document/blob importer
 *   - reconcile.ts              — post-import relationship reconciliation
 *   - preview.ts                — import preview (count-only, no writes)
 *   - execute.ts                — the import orchestrator
 *
 * @module import/quilltap-import-service
 */

// Re-export types for convenience
export type { ConflictStrategy } from '@/lib/export/types';
export type {
  QuilltapExportManifest,
  QuilltapExport,
  QuilltapExportCounts,
} from '@/lib/export/types';

export type {
  ImportPreviewEntity,
  ImportPreview,
  ImportOptions,
  ImportResult,
} from './quilltap-import/types';

export {
  parseExportFile,
  validateExportFormat,
} from './quilltap-import/validation';

export { previewImport } from './quilltap-import/preview';

export { executeImport } from './quilltap-import/execute';
