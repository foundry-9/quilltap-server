/**
 * Atlas readers — parsing a tier's `Atlas/**\/*.md` files into records, and
 * the predicate pair that says which files are entries.
 *
 * A file is an entry when it sits under `Atlas/` (not `images/`), its YAML
 * frontmatter parses, carries a UUID-shaped `id` and a usable `name`, and its
 * fields validate ({@link parseAtlasEntryFile}). Anything else — a note, a
 * half-written file, a picture — is skipped and never swept by a projection:
 * {@link isAtlasEntryDocument} answers false for it.
 *
 * The body below the frontmatter is the entry's `knowledge`, as written
 * (leading blank lines and trailing whitespace trimmed; an empty body is
 * `null`). Identity is the frontmatter `id`, never the path.
 *
 * Server-only (reads the store).
 *
 * @module lib/atlas/vault-readers
 */

import { chooseIdWinners, foldItemName } from '@/lib/mount-index/item-rules';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountDocumentWithLink as DocMountDocument } from '@/lib/database/repositories/doc-mount-documents.repository';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { ATLAS_FOLDER, folderOfAtlasPath, isAtlasEntryDocumentPath, joinFolder } from '@/lib/atlas/folders';
import { sanitizeFileName } from '@/lib/mount-index/sanitize-file-name';
import {
  ATLAS_FRONTMATTER_KEYS,
  AtlasEntrySchema,
  normalizeAtlasAliases,
  type AtlasRecord,
} from '@/lib/schemas/atlas.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FRONTMATTER_KEYS = new Set(ATLAS_FRONTMATTER_KEYS);

export { isAtlasEntryDocumentPath };

/** The file name (under `Atlas/`) a record is projected to. */
export function atlasFileNameFor(record: Pick<AtlasRecord, 'id' | 'name' | 'folder' | 'fileStem'>): string {
  const stem = record.name?.trim() || record.fileStem || `entry-${record.id.slice(0, 8)}`;
  return joinFolder(record.folder ?? '', `${sanitizeFileName(stem)}.md`);
}

/** The knowledge a file's body holds: leading blank lines and trailing whitespace trimmed; empty is null. */
export function atlasKnowledgeOfBody(body: string): string | null {
  const trimmed = body.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
  return trimmed.length > 0 ? trimmed : null;
}

interface ParseOptions {
  /** No logging — the predicate asks quietly. */
  quiet?: boolean;
}

/**
 * Parse one `Atlas/` document into a record, or null when it is not an entry.
 * Unknown frontmatter keys are dropped with a `warn` (they will be gone after
 * the next projection); free-form data lives under `metadata`. A `folder` key
 * is ignored — the path wins. Missing timestamps fall back to the document's.
 */
export function parseAtlasEntryFile(
  doc: Pick<DocMountDocument, 'relativePath' | 'content'> &
    Partial<Pick<DocMountDocument, 'mountPointId' | 'createdAt' | 'updatedAt'>>,
  opts: ParseOptions = {},
): AtlasRecord | null {
  const warn = (message: string, meta: Record<string, unknown> = {}) => {
    if (!opts.quiet) {
      logger.warn(message, {
        mountPointId: doc.mountPointId,
        relativePath: doc.relativePath,
        context: 'atlas',
        ...meta,
      });
    }
  };

  if (!isAtlasEntryDocumentPath(doc.relativePath)) return null;
  const content = (doc.content ?? '').replace(/\r\n/g, '\n');
  const parsed = parseFrontmatter(content);
  const raw = parsed.data;
  // No frontmatter, or no UUID id: a note, not an entry. Quietly skipped.
  if (!raw || typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) return null;

  const cleaned: Record<string, unknown> = {};
  const unknownKeys: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (FRONTMATTER_KEYS.has(key)) cleaned[key] = value;
    else if (key !== 'folder') unknownKeys.push(key);
  }
  if (unknownKeys.length > 0) {
    warn('Atlas entry carries frontmatter keys outside metadata; dropped', { entryId: raw.id, keys: unknownKeys });
  }
  // YAML may read a bare timestamp as a Date; the schema wants ISO strings.
  for (const key of ['createdAt', 'updatedAt', 'archivedAt']) {
    if (cleaned[key] instanceof Date) cleaned[key] = (cleaned[key] as Date).toISOString();
  }
  cleaned.createdAt ??= toIso(doc.createdAt);
  cleaned.updatedAt ??= toIso(doc.updatedAt) ?? cleaned.createdAt;
  cleaned.createdAt ??= new Date(0).toISOString();
  cleaned.updatedAt ??= cleaned.createdAt;
  if (typeof cleaned.name === 'string' && Array.isArray(cleaned.aliases)) {
    cleaned.aliases = normalizeAtlasAliases(cleaned.name, cleaned.aliases as string[]);
  }
  cleaned.knowledge = atlasKnowledgeOfBody(content.slice(parsed.bodyStartOffset));

  const result = AtlasEntrySchema.omit({ folder: true }).safeParse(cleaned);
  if (!result.success) {
    warn('Atlas entry failed validation; skipped', {
      entryId: raw.id,
      issues: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
    return null;
  }
  const fileName = doc.relativePath.slice(doc.relativePath.lastIndexOf('/') + 1);
  return {
    ...result.data,
    folder: folderOfAtlasPath(doc.relativePath),
    fileStem: fileName.replace(/\.md$/i, ''),
  };
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * True for a document the Atlas owns: an entry path whose content parses into
 * an entry. The projection sweeps only these, so a note kept under `Atlas/` is
 * never deleted by an Atlas write.
 */
export function isAtlasEntryDocument(doc: { relativePath: string; content?: string | null }): boolean {
  return parseAtlasEntryFile({ relativePath: doc.relativePath, content: doc.content ?? '' }, { quiet: true }) !== null;
}

/** True when an Atlas file carries its own UUID `id` in frontmatter (every entry does). */
export function hasStableAtlasEntryId(content: string | null | undefined): boolean {
  const id = parseFrontmatter((content ?? '').replace(/\r\n/g, '\n')).data?.id;
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * One read of a mount's `Atlas/`: every entry record (any depth, archived
 * included, sorted by path), the files skipped because an earlier one claims
 * the same id, and the paths the Atlas owns — what a projection may sweep.
 */
export interface AtlasFolderScan {
  records: AtlasRecord[];
  /** Files that parse as entries but lose to another file claiming the same id. Never swept. */
  duplicatePaths: Set<string>;
  /** The files that became {@link AtlasFolderScan.records}: the only ones a projection may sweep. */
  ownedPaths: Set<string>;
}

/** Every entry record in a mount's `Atlas/`. */
export async function readAtlasRecords(mountPointId: string): Promise<AtlasRecord[]> {
  return (await scanAtlasFolder(mountPointId)).records;
}

/**
 * Read and parse a mount's `Atlas/` once. Two files claiming one id: the one
 * at the entry's own name wins (the newest of several at their own names,
 * #224), failing that the first by path (`chooseIdWinners`); the rest are
 * skipped and left alone. Two entries sharing a canonical name (a
 * document-layer write can make them) are both kept; the first by path is the
 * one the pool sees, and a `warn` is logged.
 */
export async function scanAtlasFolder(mountPointId: string): Promise<AtlasFolderScan> {
  const docs = await getRepositories().docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    ATLAS_FOLDER,
    '.md',
    { recursive: true },
  );
  const entryDocs = docs
    .filter((doc) => isAtlasEntryDocumentPath(doc.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const parsed: Array<{ path: string; record: AtlasRecord }> = [];
  for (const doc of entryDocs) {
    const record = parseAtlasEntryFile(doc);
    if (record) parsed.push({ path: doc.relativePath, record });
  }
  const winnerPath = chooseIdWinners(parsed, (record) => `${ATLAS_FOLDER}/${atlasFileNameFor(record)}`);
  const records: AtlasRecord[] = [];
  const duplicatePaths = new Set<string>();
  const ownedPaths = new Set<string>();
  const liveNames = new Map<string, string>();
  for (const { path, record } of parsed) {
    if (winnerPath.get(record.id) !== path) {
      logger.warn('Two Atlas files claim one id; this one is skipped and left alone', {
        mountPointId,
        relativePath: path,
        keptPath: winnerPath.get(record.id),
        entryId: record.id,
        context: 'atlas',
      });
      duplicatePaths.add(path);
      continue;
    }
    records.push(record);
    ownedPaths.add(path);
    if (!record.archivedAt) {
      const key = foldItemName(record.name);
      const first = liveNames.get(key);
      if (first) {
        logger.warn('Two Atlas entries in one tier share a canonical name; the first by path wins', {
          mountPointId,
          name: record.name,
          keptPath: first,
          relativePath: path,
          context: 'atlas',
        });
      } else {
        liveNames.set(key, path);
      }
    }
  }
  logger.debug('Atlas folder read', {
    mountPointId,
    documentCount: docs.length,
    entryCount: records.length,
    duplicateCount: duplicatePaths.size,
    op: 'read',
    context: 'atlas',
  });
  return { records, duplicatePaths, ownedPaths };
}
