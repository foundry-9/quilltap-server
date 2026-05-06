/**
 * Vault Wardrobe Refresh
 *
 * One-time startup task that projects every linked character vault's wardrobe
 * into the `Wardrobe/<title>.md` + `Outfits/<name>.md` folder layout from the
 * canonical DB state (wardrobe_items + outfit_presets tables) and deletes any
 * legacy `wardrobe.json` left over from the older single-file format. The
 * read overlay treats vault wardrobe files as authoritative whenever a
 * character has `readPropertiesFromDocumentStore` on, so this refresh runs
 * once per database to bring every vault onto the folder format the moment
 * the user upgrades.
 *
 * Idempotent via the `wardrobe_folder_migrated_v1` flag in `instance_settings`:
 * runs exactly once per database, then no-ops on every subsequent startup.
 * Chained after `backfillCharacterVaults` + `migrateVaultPhysicalFiles` so
 * vaults created that morning are already in the folder shape and get
 * skipped here (their projection is a no-op).
 *
 * @module startup/refresh-vault-wardrobe
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { projectVaultWardrobe } from '@/lib/database/repositories/character-properties-overlay';

const logger = createServiceLogger('Startup:VaultWardrobeRefresh');

const REFRESH_FLAG_KEY = 'wardrobe_folder_migrated_v1';

export interface VaultWardrobeRefreshResult {
  scanned: number;
  refreshed: number;
  skipped: number;
  errors: number;
  alreadyDone: boolean;
}

export async function refreshVaultWardrobe(): Promise<VaultWardrobeRefreshResult> {
  const result: VaultWardrobeRefreshResult = {
    scanned: 0,
    refreshed: 0,
    skipped: 0,
    errors: 0,
    alreadyDone: false,
  };

  if (hasRefreshRun()) {
    result.alreadyDone = true;
    logger.debug('Wardrobe refresh already ran on this database — skipping');
    return result;
  }

  const repos = getRepositories();
  const characters = await repos.characters.findAllRaw();
  result.scanned = characters.length;

  logger.info('Vault wardrobe refresh scanning', { total: characters.length });

  for (const character of characters) {
    if (!character.characterDocumentMountPointId) {
      result.skipped++;
      continue;
    }

    const mountPointId = character.characterDocumentMountPointId;

    try {
      const items = await repos.wardrobe.findByCharacterIdRaw(character.id);

      // Outfit presets no longer exist as a separate concept — composite
      // wardrobe items (with `componentItemIds`) replace them entirely and
      // round-trip via the same `Wardrobe/` folder.
      await projectVaultWardrobe(mountPointId, character.id, items);

      result.refreshed++;
      logger.debug('Migrated wardrobe folders from DB', {
        characterId: character.id,
        mountPointId,
        itemCount: items.length,
      });
    } catch (err) {
      result.errors++;
      logger.error('Failed to migrate wardrobe folders for character', {
        characterId: character.id,
        mountPointId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  // Mark complete only if no per-character failures — otherwise leave the
  // flag unset so the next startup retries the characters that errored.
  if (result.errors === 0) {
    markRefreshRun();
  }

  logger.info('Vault wardrobe refresh complete', result);
  return result;
}

function hasRefreshRun(): boolean {
  const db = getRawDatabase();
  if (!db) return false;
  try {
    const row = db
      .prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = ?`)
      .get(REFRESH_FLAG_KEY) as { value: string } | undefined;
    return row?.value === 'true';
  } catch (err) {
    logger.warn('Failed to read wardrobe refresh flag; treating as not-yet-run', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function markRefreshRun(): void {
  const db = getRawDatabase();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
    ).run(REFRESH_FLAG_KEY, 'true');
  } catch (err) {
    logger.warn('Failed to record wardrobe refresh flag', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
