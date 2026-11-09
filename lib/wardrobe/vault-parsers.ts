/**
 * Parsing helpers for a vault's `Wardrobe/` folder: item files, ids, component
 * references, and the legacy `wardrobe.json`. Pure: they operate on content
 * already read (or pre-fetched `DocMountDocument`s).
 *
 * @module wardrobe/vault-parsers
 */

import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  WardrobeItemSchema,
  WardrobeItemTypeEnum,
  type WardrobeItem,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types';
import { detectComponentCycles } from '@/lib/wardrobe/expand-composites';
import { folderOfWardrobePath, WARDROBE_FOLDER_RULES } from '@/lib/wardrobe/folders';
import { normalizePronounGuidance } from '@/lib/wardrobe/pronoun-guidance';
import { isItemDocumentPath } from '@/lib/mount-index/item-folders';
import { isWardrobeInstructionsFileName } from '@/lib/mount-index/character-vault';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';
import { isUuidShaped, resolveFileItemId } from '@/lib/utils/stable-uuid';
import { parseJsonVaultFile } from '@/lib/characters/vault/parsers';
import type {
  DocMountDocumentWithLink as DocMountDocument,
} from '@/lib/database/repositories/doc-mount-documents.repository';

export { CHARACTER_WARDROBE_JSON_PATH } from '@/lib/characters/vault/layout';

// Snapshot of a vault's wardrobe state — composite items live alongside leaf
// items in the same list and reference their components via
// `componentItemIds`. Returned from the folder-based reader; the legacy JSON
// parser produces the same shape so callers don't have to care which file
// layout the vault is on.
export interface CharacterVaultWardrobe {
  items: WardrobeItem[];
}

// The legacy JSON shape we still parse on migration. New vaults never write
// this; the folder format is authoritative going forward. Pre-rework vaults
// included a `presets` array that is now ignored — the migration step folds
// those into composite wardrobe items, so honoring it here would double-write.
export const LegacyVaultWardrobeJsonSchema = z.object({
  items: z.array(WardrobeItemSchema),
  outfit: z
    .object({
      top: z.string().nullable().optional(),
      bottom: z.string().nullable().optional(),
      footwear: z.string().nullable().optional(),
      accessories: z.string().nullable().optional(),
    })
    .optional(),
});

/**
 * Parse the legacy `wardrobe.json` payload — kept for migration so vaults that
 * shipped on the old format aren't lost when they're first read or refreshed
 * onto the folder layout. Returns just `{ items }`; the legacy `presets` array
 * is ignored here (the database-side migration folds presets into composite
 * wardrobe items, so honoring them on read would double-write), and the
 * legacy `outfit` placeholder is dropped on the floor (it was never consumed
 * by anything).
 */
export function parseLegacyWardrobeJson(
  raw: string,
  characterId: string,
): CharacterVaultWardrobe | null {
  const parsed = parseJsonVaultFile(raw, LegacyVaultWardrobeJsonSchema, {
    parseErrorMessage: 'Invalid JSON in legacy vault wardrobe.json; falling back to DB values',
    validationErrorMessage: 'Legacy vault wardrobe.json failed schema validation; falling back to DB values',
    logContext: { characterId },
  });
  return parsed ? { items: parsed.items } : null;
}

/**
 * The id a `Wardrobe/*.md` file's item carries: its frontmatter `id` when that
 * is UUID-shaped, otherwise a stable id derived from where the file lives. The
 * single source of this rule — `parseWardrobeItemFile` and the `.qtap`
 * wear-ledger export/import (which need an item's id without parsing the whole
 * item) both call it, so they can never disagree about which item a file is.
 */
export function resolveWardrobeItemId(
  frontmatterId: unknown,
  mountPointId: string,
  relativePath: string,
): string {
  return resolveFileItemId(frontmatterId, 'wardrobe-item', mountPointId, relativePath);
}

/**
 * True for a document path that holds a wardrobe item: a `.md` file anywhere
 * under a mount's `Wardrobe/` folder — the operator's subfolders are folders
 * of items too — except under `Wardrobe/images/` (item pictures) and except
 * the dressing-guidance `instructions.md` at any depth. The one predicate:
 * `readCharacterVaultWardrobe`, the `.qtap` wear-ledger export and import and
 * the restore id remap all agree through it about which files are items.
 */
export function isWardrobeItemDocumentPath(relativePath: string): boolean {
  return isItemDocumentPath(WARDROBE_FOLDER_RULES, relativePath, '.md', isWardrobeInstructionsFileName);
}

/**
 * True for a document the wardrobe owns: an item path
 * ({@link isWardrobeItemDocumentPath}) whose frontmatter carries a valid
 * `types` list — exactly the files `parseWardrobeItemFile` turns into items.
 * The projection sweeps only these, so a note or a half-written file kept
 * under `Wardrobe/` is never deleted by a wardrobe write. Quiet: no logging.
 */
export function isWardrobeItemDocument(doc: { relativePath: string; content?: string | null }): boolean {
  if (!isWardrobeItemDocumentPath(doc.relativePath)) return false;
  return parseWardrobeTypesField(parseFrontmatter(doc.content ?? '').data?.types) !== null;
}

/**
 * True when a wardrobe file carries its own UUID `id` in frontmatter. A file
 * without one takes a path-derived id ({@link resolveWardrobeItemId}), which
 * changes if the file moves — so anything that moves files without
 * re-projecting them must stamp ids first.
 */
export function hasStableWardrobeItemId(content: string | null | undefined): boolean {
  return isUuidShaped(parseFrontmatter(content ?? '').data?.id);
}

/**
 * The item id of a `Wardrobe/*.md` document, read from its frontmatter alone
 * (see {@link resolveWardrobeItemId}). Callers check
 * {@link isWardrobeItemDocumentPath} first.
 */
export function wardrobeItemIdForDocument(doc: {
  mountPointId: string;
  relativePath: string;
  content: string;
}): string {
  return resolveWardrobeItemId(
    parseFrontmatter(doc.content).data?.id,
    doc.mountPointId,
    doc.relativePath,
  );
}

/**
 * Parse a `Wardrobe/<title>.md` file. Frontmatter carries the structured
 * fields (id, title, types, appropriateness, default flag, archive flag,
 * componentItems, timestamps); the body is the freeform description.
 * Hand-edited files may omit `id` and timestamps — both are filled in on the
 * next sync.
 *
 * Returns null when the file can't yield a valid `WardrobeItem` (no usable
 * title, no valid types, etc.) so the read overlay keeps falling back to the
 * DB value for that single file rather than blowing up the whole list.
 *
 * `componentItemIds` is initially populated with the raw refs from the file
 * (slug or UUID strings, in author-given order). The caller is responsible
 * for resolving these to canonical UUIDs against the freshly-built itemBySlug
 * / itemById maps once every item in the folder has been parsed; see
 * `resolveAndCheckComponentItems` below.
 */
export function parseWardrobeItemFile(
  doc: DocMountDocument,
  characterId: string,
): WardrobeItem | null {
  const parsed = parseFrontmatter(doc.content);

  let title: string | null = null;
  if (parsed.data) {
    const t = parsed.data.title;
    if (typeof t === 'string' && t.trim().length > 0) {
      title = t.trim();
    }
  }
  const afterFrontmatter = doc.content.slice(parsed.bodyStartOffset);
  const lines = afterFrontmatter.split('\n');
  let titleLineIndex = -1;
  if (title === null) {
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^#\s+(.+)$/);
      if (match) {
        titleLineIndex = i;
        title = match[1].trim();
        break;
      }
    }
  }
  if (title === null) {
    title = doc.fileName.replace(/\.md$/i, '').trim();
  }
  if (title.length === 0) {
    logger.warn('Wardrobe/*.md file has no usable title; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
    });
    return null;
  }

  const types = parseWardrobeTypesField(parsed.data?.types);
  if (types === null) {
    logger.warn('Wardrobe/*.md frontmatter has no valid `types` list; skipping', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
      raw: parsed.data?.types,
    });
    return null;
  }

  const id = resolveWardrobeItemId(parsed.data?.id, doc.mountPointId, doc.relativePath);

  const appropriateness =
    typeof parsed.data?.appropriateness === 'string' && parsed.data.appropriateness.length > 0
      ? (parsed.data.appropriateness as string)
      : null;

  const imagePrompt =
    typeof parsed.data?.imagePrompt === 'string' && parsed.data.imagePrompt.length > 0
      ? (parsed.data.imagePrompt as string)
      : null;

  const isDefault =
    parsed.data?.default === true || parsed.data?.isDefault === true;

  const replace = parsed.data?.replace === true;

  // Unknown values are dropped; an item left with none is offered to everyone.
  const pronounGuidance = normalizePronounGuidance(parsed.data?.pronounGuidance);

  let archivedAt: string | null = null;
  const archivedAtRaw = parsed.data?.archivedAt;
  if (typeof archivedAtRaw === 'string' && archivedAtRaw.length > 0) {
    archivedAt = archivedAtRaw;
  } else if (parsed.data?.archived === true) {
    archivedAt = doc.updatedAt;
  }

  const migratedFromClothingRecordId =
    typeof parsed.data?.migratedFromClothingRecordId === 'string'
      ? (parsed.data.migratedFromClothingRecordId as string)
      : null;

  const imageFileId =
    typeof parsed.data?.imageFileId === 'string' && parsed.data.imageFileId.length > 0
      ? (parsed.data.imageFileId as string)
      : null;

  // Raw componentItems refs (slug or UUID strings). We deliberately store
  // these as-written into componentItemIds; `resolveAndCheckComponentItems`
  // rewrites them to canonical UUIDs in a second pass once the slug/id maps
  // exist. Treating them as UUIDs here would force per-item resolution and
  // re-thread the parser through the lookup maps.
  const componentItemIdsRaw = parseComponentItemsField(parsed.data?.componentItems);

  const createdAt =
    typeof parsed.data?.createdAt === 'string'
      ? (parsed.data.createdAt as string)
      : doc.createdAt;
  const updatedAt =
    typeof parsed.data?.updatedAt === 'string'
      ? (parsed.data.updatedAt as string)
      : doc.updatedAt;

  // The folder is the file's path and nothing else. A hand-edited file that
  // carries a `folder:` key is ignored — the path wins.
  const folder = folderOfWardrobePath(doc.relativePath);
  if (parsed.data && Object.prototype.hasOwnProperty.call(parsed.data, 'folder')) {
    logger.debug('Wardrobe/*.md frontmatter carries a `folder` key; the file path wins', {
      characterId,
      mountPointId: doc.mountPointId,
      relativePath: doc.relativePath,
      frontmatterFolder: parsed.data.folder,
      folder,
    });
  }

  const bodyText = (titleLineIndex >= 0
    ? lines.slice(titleLineIndex + 1).join('\n')
    : afterFrontmatter
  ).trim();
  const description = bodyText.length > 0 ? bodyText : null;

  return {
    id,
    characterId,
    title: title.slice(0, 200),
    description,
    imagePrompt,
    types,
    appropriateness,
    isDefault,
    replace,
    ...(pronounGuidance.length > 0 ? { pronounGuidance } : {}),
    componentItemIds: componentItemIdsRaw,
    migratedFromClothingRecordId,
    imageFileId,
    archivedAt,
    folder,
    createdAt,
    updatedAt,
  };
}

/**
 * Parse the `componentItems:` frontmatter array. Accepts a list of strings
 * (slug or UUID); anything else is dropped with a warning-level no-op (the
 * caller logs once at file scope rather than on every entry). Empty/missing
 * arrays return `[]` so leaf items get the canonical empty value.
 */
export function parseComponentItemsField(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

export function parseWardrobeTypesField(raw: unknown): WardrobeItemType[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const allowed = new Set(WardrobeItemTypeEnum.options);
  const out: WardrobeItemType[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') return null;
    if (!allowed.has(v as WardrobeItemType)) return null;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v as WardrobeItemType);
  }
  return out.length > 0 ? out : null;
}

/**
 * A component reference written as a raw UUID. `buildWardrobeItemFile` writes
 * any component outside the vault's own folder (a group, project or General
 * item) this way, so a UUID the local maps don't know is a cross-tier part,
 * not a typo.
 */
const COMPONENT_UUID_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the raw `componentItems:` strings that `parseWardrobeItemFile`
 * stashed on each item into canonical UUIDs, then run a cycle check across
 * the resolved list. Items whose composites would form a cycle have their
 * `componentItemIds` cleared (read-tolerant — the item itself stays so the
 * user doesn't lose a hand-edit, but the bad reference is dropped).
 *
 * A UUID that matches nothing local is KEPT as written: it names a component
 * in another tier this reader cannot see (a group or project store), and
 * dropping it here would let the next write of any item in the folder
 * re-project the stripped list to disk (bug 187). `expandComposites` and the
 * read-time hydration in `resolve-equipped.ts` resolve it against the full
 * pool. Only a slug that matches nothing is logged and dropped — a slug is
 * only ever written for an item in the same folder.
 *
 * Mutates `items` in place because the array is freshly built by the caller
 * and not yet exposed elsewhere.
 */
export function resolveAndCheckComponentItems(
  items: WardrobeItem[],
  itemBySlug: ReadonlyMap<string, WardrobeItem>,
  itemById: ReadonlyMap<string, WardrobeItem>,
  characterId: string,
  mountPointId: string,
): void {
  // First pass — slug/UUID → canonical UUID. Unknown UUIDs survive; unknown
  // slugs are dropped.
  for (const item of items) {
    if (item.componentItemIds.length === 0) continue;
    const resolved: string[] = [];
    for (const ref of item.componentItemIds) {
      const bySlug = itemBySlug.get(ref);
      if (bySlug) {
        resolved.push(bySlug.id);
        continue;
      }
      const byId = itemById.get(ref);
      if (byId) {
        resolved.push(byId.id);
        continue;
      }
      if (COMPONENT_UUID_REF.test(ref)) {
        logger.debug('Wardrobe item references a component outside this folder; keeping ref', {
          characterId,
          mountPointId,
          itemId: item.id,
          ref,
        });
        resolved.push(ref);
        continue;
      }
      logger.warn('Wardrobe item references unknown component slug; dropping ref', {
        characterId,
        mountPointId,
        itemId: item.id,
        title: item.title,
        ref,
      });
    }
    item.componentItemIds = resolved;
  }

  // Second pass — cycle check using the now-resolved IDs. A cycle in the
  // declared graph wipes that item's components rather than the item itself,
  // so the user doesn't lose anything irrecoverable to a vault edit slip.
  for (const item of items) {
    if (item.componentItemIds.length === 0) continue;
    const cycles = detectComponentCycles(item.id, item.componentItemIds, itemById);
    if (cycles.length > 0) {
      logger.warn('Wardrobe item declares a component cycle in vault; dropping its components', {
        characterId,
        mountPointId,
        itemId: item.id,
        title: item.title,
        cycles,
      });
      item.componentItemIds = [];
    }
  }
}

