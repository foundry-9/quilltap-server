/**
 * Reader for a vault's `Wardrobe/` folder (or its legacy `wardrobe.json`).
 *
 * @module wardrobe/vault-readers
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import { slugifyWardrobeTitle, CHARACTER_WARDROBE_FOLDER } from '@/lib/mount-index/character-vault';
import { readVaultFile } from '@/lib/characters/vault/readers';
import {
  CHARACTER_WARDROBE_JSON_PATH,
  isWardrobeItemDocumentPath,
  parseLegacyWardrobeJson,
  parseWardrobeItemFile,
  resolveAndCheckComponentItems,
  type CharacterVaultWardrobe,
} from './vault-parsers';

/**
 * Read a character's vault wardrobe and return a validated snapshot, or null
 * if neither the new folder layout nor the legacy `wardrobe.json` is usable.
 *
 * Read order:
 *   1. Every `.md` under `Wardrobe/`, at any depth (current format) — each
 *      item's `folder` is its path under `Wardrobe/`; `images/` and every
 *      `instructions.md` are skipped (`isWardrobeItemDocumentPath`).
 *      Composite items reference their components via the `componentItems:`
 *      slug array, resolved here against the slug map of every item in the
 *      tier, whatever its folder (slug-first, UUID fallback).
 *   2. legacy `wardrobe.json` (still honored so existing vaults don't lose
 *      hand-edits between this change shipping and the migration running).
 *
 * The retired `Outfits/` folder is intentionally not read — pre-rework
 * presets are handled by a separate database-side migration that folds them
 * into composite wardrobe items, so re-parsing them here would double-write.
 * Stale `Outfits/*.md` files left on disk are tolerated; cleanup happens via
 * the migration.
 *
 * Cycle and unknown-ref handling: cycles in the declared component graph
 * wipe the offending item's `componentItemIds` (logged) but leave the item
 * itself intact so vault hand-edits aren't silently destructive. An unknown
 * UUID ref is kept (it names a part in another tier); an unknown slug is
 * dropped from that item's component list with a warning.
 */
export async function readCharacterVaultWardrobe(
  mountPointId: string,
  characterId?: string,
): Promise<CharacterVaultWardrobe | null> {
  const repos = getRepositories();
  const charId = characterId ?? mountPointId;

  // Recursive: the operator's subfolders (`Wardrobe/Formal/Evening/`) hold
  // items too, and each item's `folder` is derived from its path.
  const allDocs = await repos.docMountDocuments.findManyByMountPointsInFolder(
    [mountPointId],
    CHARACTER_WARDROBE_FOLDER,
    '.md',
    { recursive: true },
  );
  // `instructions.md` is dressing guidance, never a garment, and
  // `Wardrobe/images/` holds item pictures — the one predicate says which
  // documents are items. Filter before the length check so a folder holding
  // only the instructions file still falls through to the legacy
  // wardrobe.json branch below.
  const itemDocs = allDocs.filter((doc) => isWardrobeItemDocumentPath(doc.relativePath));
  if (itemDocs.length !== allDocs.length) {
    logger.debug('Wardrobe read skipped non-item documents', {
      characterId: charId,
      mountPointId,
      skipped: allDocs.length - itemDocs.length,
    });
  }

  if (itemDocs.length > 0) {
    const items = itemDocs
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((doc) => parseWardrobeItemFile(doc, charId))
      .filter((item): item is WardrobeItem => item !== null);

    const itemById = new Map<string, WardrobeItem>();
    const itemBySlug = new Map<string, WardrobeItem>();
    const claimedSlugs = new Set<string>();
    for (const item of items) {
      itemById.set(item.id, item);
      const slug = slugifyWardrobeTitle(item.title);
      if (slug.length === 0 || claimedSlugs.has(slug)) {
        if (slug.length > 0) {
          logger.warn('Wardrobe items share a slug; later item only addressable by UUID', {
            characterId: charId,
            mountPointId,
            slug,
            itemId: item.id,
            title: item.title,
          });
        }
        continue;
      }
      claimedSlugs.add(slug);
      itemBySlug.set(slug, item);
    }

    // Component refs resolve against this folder alone. A component in another
    // tier is written as its UUID and survives parsing unresolved (bug 187);
    // the per-request wearable pool (`lib/wardrobe/pool.ts`) resolves it. The
    // reader never calls back into the repository.
    resolveAndCheckComponentItems(items, itemBySlug, itemById, charId, mountPointId);

    return { items };
  }

  // Folder empty (or missing) — fall through to legacy wardrobe.json so
  // pre-migration vaults still surface their items.
  const legacyContent = await readVaultFile(
    mountPointId,
    CHARACTER_WARDROBE_JSON_PATH,
    characterId,
  );
  if (legacyContent === null) return null;
  return parseLegacyWardrobeJson(legacyContent, charId);
}
