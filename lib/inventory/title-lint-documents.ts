/**
 * The title lint at the document-write layer.
 *
 * The household's hands are a rename path: a title changed by `doc_write_file`
 * or `doc_str_replace` on an `Inventory/*.json` file, a file deleted or moved
 * with the doc tools, an edit saved in the Scriptorium — none of these call an
 * Inventory mutation. The database store (`lib/mount-index/database-store.ts`)
 * therefore asks {@link lintInventoryDocumentChange} before every write,
 * delete and move whose path {@link isTitleLintPath} claims, and calls the
 * function it gets back once the change has landed, to write the rows.
 *
 * For an `Inventory/` object file it reads the file's prior state first —
 * the lint cannot judge a rename it never saw the before of, and a prior
 * state it cannot read refuses a titled write (fail closed, naming the file)
 * — parses both sides with the Inventory's own reader, and hands them to
 * {@link lintInventoryTitle}, keyed by the object's id: a file rewritten with
 * a different object inside is that object leaving and another entering.
 * For a `Tools/*.tool.json` file it records the census line and nothing else.
 *
 * Writes from the Inventory mutations carry their own lint and are skipped
 * (`lint-scope.ts`). Only database-backed stores hold an Inventory, so a
 * filesystem write never reaches here.
 *
 * Server-only.
 *
 * @module lib/inventory/title-lint-documents
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getGeneralMountPointId } from '@/lib/instance-settings';
import type { InventoryRecord } from '@/lib/schemas/inventory.types';
import { parseInventoryItemFile } from '@/lib/database/repositories/vault-overlay/inventory-readers';
import { InventoryTitleCheckUnavailableError } from '@/lib/inventory/errors';
import { GENERAL_INVENTORY_ORIGIN, inventoryLocationForMount, type InventoryLocation } from '@/lib/inventory/location';
import { inventoryWritesAreLinted, isTitleLintFolder, isToolDefinitionPath } from '@/lib/inventory/lint-scope';
import { isInventoryItemDocumentPath } from '@/lib/inventory/folders';
import { lintInventoryTitle, writeTitleLintRows, type TitleLintDoor, type TitleLintVerdict } from '@/lib/inventory/title-lint';

export type InventoryDocumentChange =
  | { kind: 'write'; mountPointId: string; relativePath: string; content: string }
  | { kind: 'delete'; mountPointId: string; relativePath: string }
  | { kind: 'move'; mountPointId: string; fromPath: string; toPath: string }
  | { kind: 'move-folder'; mountPointId: string; fromPath: string; toPath: string };

const NOTHING_TO_WRITE = () => undefined;

/** The location an `Inventory/` folder in this mount belongs to. */
async function locationForMount(mountPointId: string): Promise<InventoryLocation | null> {
  const repos = getRepositories();
  const character = await repos.characters.findByDocumentMountPointIdRaw(mountPointId);
  if (character) {
    return inventoryLocationForMount({ mountPointId, scope: 'character', characterId: character.id }, character.id, {
      scope: 'character',
      id: character.id,
      name: character.name,
    });
  }
  if ((await getGeneralMountPointId()) === mountPointId) {
    return inventoryLocationForMount({ mountPointId, scope: 'general', characterId: null }, null, GENERAL_INVENTORY_ORIGIN);
  }
  const mount = await repos.docMountPoints.findById(mountPointId);
  if (!mount) return null;
  // A project or group store, or any store linked to a project: its pool is its own folder plus General.
  return inventoryLocationForMount({ mountPointId, scope: 'project', characterId: null }, null, {
    scope: 'project',
    id: null,
    name: mount.name,
  });
}

/** A document's current content, null when there is none. Throws when it cannot be read. */
async function priorContent(mountPointId: string, relativePath: string): Promise<string | null> {
  const doc = await getRepositories().docMountDocuments.findByMountPointAndPath(mountPointId, relativePath);
  return doc ? (doc.content ?? '') : null;
}

const parse = (relativePath: string, content: string | null): InventoryRecord | null =>
  content === null || !isInventoryItemDocumentPath(relativePath)
    ? null
    : parseInventoryItemFile({ relativePath, content }, { quiet: true });

/** One object's before and after, as a file change sees them. */
interface Pair {
  before: InventoryRecord | null;
  after: InventoryRecord | null;
}

/** Split a file change into per-object pairs: a different object in the same file is a leave and an enter. */
function pairsOf(before: InventoryRecord | null, after: InventoryRecord | null): Pair[] {
  if (before && after && before.id !== after.id) return [{ before, after: null }, { before: null, after }];
  return [{ before, after }];
}

/** The title a refusal names when the lint could not even read the file: the incoming title, or the path. */
function labelOf(relativePath: string, content: string | null): string {
  return parse(relativePath, content)?.title?.trim() || relativePath;
}

/**
 * Lint one document change before it is made. Throws a title refusal to stop
 * it; otherwise returns a function to call once the change has landed, which
 * writes the rows.
 */
export async function lintInventoryDocumentChange(change: InventoryDocumentChange): Promise<() => void> {
  if (inventoryWritesAreLinted()) return NOTHING_TO_WRITE;
  const paths = change.kind === 'write' || change.kind === 'delete' ? [change.relativePath] : [change.fromPath, change.toPath];
  const meta = { kind: change.kind, mountPointId: change.mountPointId, paths, context: 'inventory' };

  if (change.kind !== 'move-folder' && paths.some(isToolDefinitionPath) && !paths.some(isInventoryItemDocumentPath)) {
    // A gate rewrite changes no title; the census line is the evidence the lint looked.
    const { collectToolGateKeys } = await import('@/lib/pascal/tool-gate-keys');
    const census = await collectToolGateKeys().catch((error: unknown) => ({ error: String(error) }));
    logger.debug('[InventoryTitleLint] Census', {
      ...meta,
      door: 'document-write',
      entering: false,
      leaving: false,
      toolStores: 'storesConsulted' in census ? census.storesConsulted : [],
      gateKeys: 'keys' in census ? census.keys.length : null,
      unread: 'unread' in census ? census.unread : [census],
    });
    return NOTHING_TO_WRITE;
  }

  const location = await locationForMount(change.mountPointId);
  if (!location) {
    throw new InventoryTitleCheckUnavailableError(paths[0], [
      { pool: `store ${change.mountPointId}`, reason: 'no such store; an empty read from it is not an answer' },
    ]);
  }

  // Each file the change touches: its path before, its path after, and the content it carries.
  type FileChange = { from: string | null; to: string | null; content: string | null; door: TitleLintDoor };
  const files: FileChange[] = [];
  const readPrior = async (path: string, incoming: string | null): Promise<string | null> => {
    try {
      return await priorContent(change.mountPointId, path);
    } catch (error) {
      throw new InventoryTitleCheckUnavailableError(labelOf(path, incoming), [
        { pool: `${path} in ${location.origin.name ? `store "${location.origin.name}"` : `store ${change.mountPointId}`}`, reason: `its prior state could not be read: ${error instanceof Error ? error.message : String(error)}` },
      ]);
    }
  };

  if (change.kind === 'write') {
    files.push({ from: change.relativePath, to: change.relativePath, content: change.content, door: 'document-write' });
  } else if (change.kind === 'delete') {
    files.push({ from: change.relativePath, to: null, content: null, door: 'document-delete' });
  } else if (change.kind === 'move') {
    files.push({ from: change.fromPath, to: change.toPath, content: null, door: 'document-move' });
  } else {
    // A folder move matters only when it carries objects across the `Inventory/` boundary.
    if (isTitleLintFolder(change.fromPath) === isTitleLintFolder(change.toPath)) return NOTHING_TO_WRITE;
    let docs: Array<{ relativePath: string }>;
    try {
      docs = await getRepositories().docMountDocuments.findManyByMountPointsInFolder([change.mountPointId], change.fromPath, '.json', {
        recursive: true,
      });
    } catch (error) {
      throw new InventoryTitleCheckUnavailableError(change.fromPath, [
        { pool: `the folder ${change.fromPath}`, reason: `its contents could not be listed: ${error instanceof Error ? error.message : String(error)}` },
      ]);
    }
    for (const doc of docs) {
      files.push({
        from: doc.relativePath,
        to: `${change.toPath}${doc.relativePath.slice(change.fromPath.length)}`,
        content: null,
        door: 'document-move',
      });
    }
  }

  const verdicts: Array<{ verdict: TitleLintVerdict; itemId: string }> = [];
  for (const file of files) {
    const prior = file.from ? await readPrior(file.from, file.content) : null;
    const next = file.to === null ? null : file.content ?? prior;
    const before = file.from ? parse(file.from, prior) : null;
    const after = file.to ? parse(file.to, next) : null;
    for (const pair of pairsOf(before, after)) {
      const verdict = await lintInventoryTitle(getRepositories(), location, { door: file.door, ...pair });
      const itemId = (pair.after ?? pair.before)?.id;
      if (itemId && verdict.rows.length > 0) verdicts.push({ verdict, itemId });
    }
  }

  logger.debug('[InventoryTitleLint] Document change linted', { ...meta, files: files.length, rows: verdicts.length });
  return () => {
    for (const { verdict, itemId } of verdicts) writeTitleLintRows(verdict, itemId, location);
  };
}
