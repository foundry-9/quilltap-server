/**
 * Inventory readers — parsing a tier's `Inventory/**\/*.json` files into
 * records, and the one predicate pair that says which files are objects.
 *
 * A file is an object when it sits under `Inventory/` (not `images/`), its
 * JSON parses, its `id` is UUID-shaped and its fields validate
 * ({@link parseInventoryItemFile}). Anything else — a note, a half-written
 * file, a picture — is skipped with a `warn` and is never swept by a
 * projection: {@link isInventoryItemDocument} answers false for it, exactly
 * as `isWardrobeItemDocument` does for a note under `Wardrobe/`.
 *
 * Identity is the `id` inside the file, never the path. An instance's file is
 * sparse (only the fields it overrides), and is returned unresolved — the
 * pool resolves it against its archetype (`lib/inventory/resolve.ts`).
 *
 * @module database/repositories/vault-overlay/inventory-readers
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';
import {
  folderOfInventoryPath,
  INVENTORY_FOLDER,
  isInventoryItemDocumentPath,
  joinFolder,
} from '@/lib/inventory/folders';
import { sanitizeFileName } from '@/lib/mount-index/sanitize-file-name';
import {
  INVENTORY_FILE_KEYS,
  InventoryItemFileSchema,
  InventoryItemSchema,
  inventoryShapeIssues,
  type InventoryItemFile,
  type InventoryRecord,
} from '@/lib/schemas/inventory.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_KEYS = new Set(INVENTORY_FILE_KEYS);
const FullFileSchema = InventoryItemSchema.omit({ folder: true });

export { isInventoryItemDocumentPath };

/** The file name (under `Inventory/`) a record is projected to. */
export function inventoryFileNameFor(record: InventoryRecord): string {
  const stem = record.title || record.name || record.fileStem || `object-${record.id.slice(0, 8)}`;
  return joinFolder(record.folder ?? '', `${sanitizeFileName(stem)}.json`);
}

interface ParseOptions {
  /** No logging — the predicate asks quietly. */
  quiet?: boolean;
}

/**
 * Parse one `Inventory/` document into a record, or null when it is not an
 * object. A standalone, archetype or kit is validated whole (defaults filled
 * in); an instance (`parentId` set) is validated sparse, with nothing
 * defaulted, so an omitted field stays omitted and inherits. Unknown
 * top-level keys are dropped with a `warn`; free-form data lives under
 * `metadata`. Missing timestamps fall back to the document's.
 */
export function parseInventoryItemFile(
  doc: Pick<DocMountDocument, 'relativePath' | 'content'> &
    Partial<Pick<DocMountDocument, 'mountPointId' | 'createdAt' | 'updatedAt'>>,
  opts: ParseOptions = {},
): InventoryRecord | null {
  const warn = (message: string, meta: Record<string, unknown> = {}) => {
    if (!opts.quiet) {
      logger.warn(message, {
        mountPointId: doc.mountPointId,
        relativePath: doc.relativePath,
        context: 'inventory',
        ...meta,
      });
    }
  };

  if (!isInventoryItemDocumentPath(doc.relativePath)) return null;
  let json: unknown;
  try {
    json = JSON.parse(doc.content ?? '');
  } catch (error) {
    warn('Inventory file is not valid JSON; skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    warn('Inventory file is not a JSON object; skipped');
    return null;
  }
  const raw = json as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) {
    warn('Inventory file has no UUID-shaped id; skipped');
    return null;
  }

  const cleaned: Record<string, unknown> = {};
  const unknownKeys: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (FILE_KEYS.has(key)) cleaned[key] = value;
    else unknownKeys.push(key);
  }
  if (unknownKeys.length > 0) {
    warn('Inventory file carries reserved-namespace keys outside metadata; dropped', {
      itemId: raw.id,
      keys: unknownKeys,
    });
  }
  cleaned.createdAt ??= toIso(doc.createdAt);
  cleaned.updatedAt ??= toIso(doc.updatedAt) ?? cleaned.createdAt;
  cleaned.createdAt ??= new Date(0).toISOString();
  cleaned.updatedAt ??= cleaned.createdAt;

  const isInstance = typeof cleaned.parentId === 'string' && cleaned.parentId.length > 0;
  const parsed = isInstance ? InventoryItemFileSchema.safeParse(cleaned) : FullFileSchema.safeParse(cleaned);
  if (!parsed.success) {
    warn('Inventory file failed validation; skipped', {
      itemId: raw.id,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
    return null;
  }
  const file = parsed.data as InventoryItemFile;
  const issues = inventoryShapeIssues(file);
  if (isInstance && file.isArchetype) issues.push('An instance cannot be an archetype');
  if (issues.length > 0) {
    warn('Inventory file breaks the object shape rules; skipped', { itemId: file.id, issues });
    return null;
  }

  const fileName = doc.relativePath.slice(doc.relativePath.lastIndexOf('/') + 1);
  return {
    ...file,
    folder: folderOfInventoryPath(doc.relativePath),
    fileStem: fileName.replace(/\.json$/i, ''),
  };
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * True for a document the Inventory owns: an object path whose content parses
 * into an object. The projection sweeps only these, so a note or a broken
 * file kept under `Inventory/` is never deleted by an Inventory write.
 */
export function isInventoryItemDocument(doc: { relativePath: string; content?: string | null }): boolean {
  return parseInventoryItemFile({ relativePath: doc.relativePath, content: doc.content ?? '' }, { quiet: true }) !== null;
}

/** True when an Inventory file carries its own UUID `id` (every object does). */
export function hasStableInventoryItemId(content: string | null | undefined): boolean {
  try {
    const id = (JSON.parse(content ?? '') as { id?: unknown }).id;
    return typeof id === 'string' && UUID_RE.test(id);
  } catch {
    return false;
  }
}

/**
 * Every object record in a mount's `Inventory/`, at any depth, archived
 * included, sorted by path. A second file claiming an id already seen is
 * skipped with a `warn` (the first by path wins) and never swept by a write
 * (see {@link readDuplicateInventoryPaths}).
 */
export async function readInventoryRecords(mountPointId: string): Promise<InventoryRecord[]> {
  return (await scanInventoryFolder(mountPointId)).records;
}

/**
 * The paths of the files in a mount's `Inventory/` that parse as objects but
 * were skipped because an earlier file (by path) claims the same id. The
 * projection must leave these alone: they are the operator's (a copy made in
 * the Scriptorium, say), and sweeping them would delete them silently.
 */
export async function readDuplicateInventoryPaths(mountPointId: string): Promise<Set<string>> {
  return (await scanInventoryFolder(mountPointId)).duplicatePaths;
}

async function scanInventoryFolder(
  mountPointId: string,
): Promise<{ records: InventoryRecord[]; duplicatePaths: Set<string> }> {
  const docs = await getRepositories().docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    INVENTORY_FOLDER,
    '.json',
    { recursive: true },
  );
  const objectDocs = docs
    .filter((doc) => isInventoryItemDocumentPath(doc.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  // Two files may claim one id (a copy made in the Scriptorium). The one at
  // the object's own name — the original — wins; failing that, the first by
  // path. The rest are skipped, and the projection leaves them alone.
  const parsed: Array<{ path: string; record: InventoryRecord }> = [];
  for (const doc of objectDocs) {
    const record = parseInventoryItemFile(doc);
    if (record) parsed.push({ path: doc.relativePath, record });
  }
  const atOwnName = ({ path, record }: { path: string; record: InventoryRecord }) =>
    path.toLowerCase() === `${INVENTORY_FOLDER}/${inventoryFileNameFor(record)}`.toLowerCase();
  const winnerPath = new Map<string, string>();
  for (const entry of parsed) {
    if (!winnerPath.has(entry.record.id) && atOwnName(entry)) winnerPath.set(entry.record.id, entry.path);
  }
  for (const { path, record } of parsed) {
    if (!winnerPath.has(record.id)) winnerPath.set(record.id, path);
  }
  const records: InventoryRecord[] = [];
  const duplicatePaths = new Set<string>();
  for (const { path, record } of parsed) {
    if (winnerPath.get(record.id) === path) {
      records.push(record);
      continue;
    }
    logger.warn('Two Inventory files claim one id; this one is skipped and left alone', {
      mountPointId,
      relativePath: path,
      keptPath: winnerPath.get(record.id),
      itemId: record.id,
      context: 'inventory',
    });
    duplicatePaths.add(path);
  }
  logger.debug('Inventory folder read', {
    mountPointId,
    documentCount: docs.length,
    objectCount: records.length,
    duplicateCount: duplicatePaths.size,
    op: 'read',
    context: 'inventory',
  });
  return { records, duplicatePaths };
}
