/**
 * Wardrobe read overlay + write-back sync. The vault `Wardrobe/` folder is
 * authoritative on read, so every wardrobe mutation must re-project the DB
 * state back out to `Wardrobe/*.md`. Per-character chaining serializes
 * concurrent syncs so they can't each read a stale DB snapshot.
 *
 * @module database/repositories/vault-overlay/wardrobe-sync
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';
import {
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import {
  buildWardrobeItemFile,
  buildSlugByItemIdMap,
  sanitizeFileName,
} from '@/lib/mount-index/character-vault';

import {
  CHARACTER_WARDROBE_FOLDER,
  CHARACTER_WARDROBE_JSON_PATH,
} from './schema';
import { hasLinkedVault } from './parsers';
import { readCharacterVaultWardrobe } from './vault-readers';
import { projectArrayIntoVaultFolder } from './vault-projection';

export interface WardrobeOverlayOptions {
  /** Include items whose archivedAt is non-null. Default false. */
  includeArchived?: boolean;
  /** Only return items with isDefault=true. */
  defaultsOnly?: boolean;
}

/**
 * Overlay a wardrobe-items list read. When the character has a linked
 * vault, the vault's `Wardrobe/*.md` files (or the legacy wardrobe.json on
 * a not-yet-migrated vault) are the source of truth; the caller's DB
 * loader is skipped. Otherwise the DB loader runs and its result is
 * returned.
 *
 * Items parsed from the vault have their `characterId` coerced to the lookup
 * ID — a wardrobe file scoped to one character's vault always belongs to that
 * character, and coercing keeps downstream consumers from tripping over a
 * hand-edited characterId that doesn't match.
 */
export async function getOverlaidWardrobeItems(
  characterId: string,
  loadDbItems: () => Promise<WardrobeItem[]>,
  options: WardrobeOverlayOptions = {},
): Promise<WardrobeItem[]> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || !hasLinkedVault(character)) {
    return loadDbItems();
  }

  const mountPointId = character.characterDocumentMountPointId as string;
  const vault = await readCharacterVaultWardrobe(mountPointId, characterId);
  if (!vault) {
    return loadDbItems();
  }

  let items: WardrobeItem[] = vault.items.map((item) => ({
    ...item,
    characterId,
  }));
  if (!options.includeArchived) {
    items = items.filter((item) => !item.archivedAt);
  }
  if (options.defaultsOnly) {
    items = items.filter((item) => item.isDefault);
  }

  return items;
}

/**
 * Per-character write chain. The overlay treats the vault Wardrobe/ folder
 * as authoritative on read, so each mutation of wardrobe items must project
 * the new DB state back out into `Wardrobe/*.md`. Composite items emit
 * their `componentItems:` slug arrays in the same projection. Chaining per
 * characterId prevents two concurrent sync calls from each reading a stale
 * DB snapshot and writing files that lose one of the changes.
 */
const wardrobeSyncChains = new Map<string, Promise<void>>();

/**
 * After a wardrobe-item write, re-project the character's DB state into the
 * vault's Wardrobe/ folder. No-ops for archetype rows (characterId null),
 * missing characters, and characters that aren't overlay candidates (flag
 * off or no linked vault).
 *
 * Failures are logged but not propagated — the DB write is already committed,
 * and the next successful sync (or the startup refresh) will reconcile. We'd
 * rather report success and leave a warning in the log than throw and leave
 * the caller to retry into a duplicate DB row.
 *
 * `excludeIds` is a tombstone set of wardrobe-item ids that should not be
 * promoted from vault to DB during the ingestion phase. The delete path uses
 * this so the vault file for the just-deleted row is treated as unmanaged
 * and swept by the projection step. Without it, the ingestion would
 * re-promote the file (preserving the same id), and the delete would be a
 * no-op for vault-overlay characters.
 */
export async function syncCharacterVaultWardrobe(
  characterId: string | null | undefined,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  if (!characterId) return;

  const prev = wardrobeSyncChains.get(characterId) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => performVaultWardrobeSync(characterId, excludeIds));
  wardrobeSyncChains.set(characterId, next);
  try {
    await next;
  } finally {
    if (wardrobeSyncChains.get(characterId) === next) {
      wardrobeSyncChains.delete(characterId);
    }
  }
}

async function performVaultWardrobeSync(
  characterId: string,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  const repos = getRepositories();
  const character = await repos.characters.findByIdRaw(characterId);
  if (!character || !hasLinkedVault(character)) return;

  const mountPointId = character.characterDocumentMountPointId as string;

  try {
    // Promote any vault-only wardrobe items into the DB before projecting
    // back out. The projection sweep deletes any Wardrobe/ file not
    // represented in the DB-derived list, so vault-only files (created by
    // hand or via Document Mode, with no DB row) would get wiped on every
    // sync without this step.
    await ingestVaultOnlyWardrobeIntoDb(mountPointId, characterId, excludeIds);

    const items = await repos.wardrobe.findByCharacterIdRaw(characterId);

    await projectVaultWardrobe(mountPointId, characterId, items);
  } catch (err) {
    logger.error('Failed to sync wardrobe folder from DB; vault is now stale', {
      characterId,
      mountPointId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

/**
 * Read the character's vault wardrobe folder and copy any items that aren't
 * yet in the DB into the DB, preserving their ids and timestamps. The
 * downstream projection sees them as managed rows and leaves their files in
 * place; without this step it would delete them as unmanaged.
 *
 * Items whose id is in `excludeIds` are skipped (and *not* promoted), so the
 * subsequent projection sweep treats their vault files as unmanaged and
 * deletes them. The delete path uses this to make a wardrobe-item delete
 * actually delete on vault-overlay characters.
 *
 * Failures on individual items are logged but don't abort the rest of the
 * ingestion or the sync — losing one item to a validation error is better
 * than rolling back and clobbering the whole vault on the projection step.
 */
async function ingestVaultOnlyWardrobeIntoDb(
  mountPointId: string,
  characterId: string,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  const repos = getRepositories();
  const vault = await readCharacterVaultWardrobe(mountPointId, characterId);
  if (!vault) return;

  if (vault.items.length > 0) {
    const dbItems = await repos.wardrobe.findByCharacterIdRaw(characterId, true);
    const dbItemIds = new Set(dbItems.map((i) => i.id));
    for (const item of vault.items) {
      if (dbItemIds.has(item.id)) continue;
      if (excludeIds?.has(item.id)) {
        continue;
      }
      try {
        await repos.wardrobe.createFromVault(item);
        logger.info('Promoted vault-only wardrobe item into DB before sync', {
          characterId,
          mountPointId,
          itemId: item.id,
          title: item.title,
        });
      } catch (err) {
        logger.warn('Failed to promote vault-only wardrobe item into DB; will be deleted by projection', {
          characterId,
          mountPointId,
          itemId: item.id,
          title: item.title,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

/**
 * Project an authoritative wardrobe-item list into the vault's `Wardrobe/`
 * folder, deleting any stale legacy `wardrobe.json` so the new format is the
 * single source on disk. Composite items emit their `componentItems:` slug
 * arrays via the slug map built here. Shared between the per-write sync
 * chain, the full-character writer, and the startup migration so they all
 * produce the same on-disk shape.
 *
 * The retired `Outfits/` folder is intentionally not touched — pre-rework
 * preset files left on disk are removed by a separate database-side
 * migration, not by every wardrobe sync.
 */
export async function projectVaultWardrobe(
  mountPointId: string,
  characterId: string,
  items: readonly WardrobeItem[],
): Promise<void> {
  const slugByItemId = buildSlugByItemIdMap(items);

  await projectArrayIntoVaultFolder(
    mountPointId,
    CHARACTER_WARDROBE_FOLDER,
    items,
    (item) => ({
      fileName: `${sanitizeFileName(item.title)}.md`,
      content: buildWardrobeItemFile(item, slugByItemId),
    }),
    characterId,
  );

  // The legacy single-JSON file is always cleaned up after a successful
  // projection so it can't drift back to authoritative-on-read.
  try {
    await deleteDatabaseDocument(mountPointId, CHARACTER_WARDROBE_JSON_PATH);
  } catch (err) {
    if (!(err instanceof DatabaseStoreError && err.code === 'NOT_FOUND')) {
      logger.warn('Failed to delete legacy wardrobe.json after folder projection', {
        characterId,
        mountPointId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
