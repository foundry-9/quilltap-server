/**
 * Vault Wardrobe Refresh
 *
 * One-time startup task that rewrites every linked character vault's
 * `wardrobe.json` from the canonical DB state (wardrobe_items + outfit_presets
 * tables). Needed because `wardrobe.json` was historically written once at
 * vault creation and never resynced, so existing vaults carry stale snapshots
 * from whenever the vault was provisioned.
 *
 * The wardrobe overlay (see `character-properties-overlay.ts`) now treats
 * `wardrobe.json` as authoritative whenever a character has
 * `readPropertiesFromDocumentStore` on, so any drift becomes user-visible the
 * moment the flag is flipped. Refreshing once brings every vault up to date so
 * nobody is surprised by stale items or missing presets.
 *
 * Idempotent via the `wardrobe_json_refreshed_v1` flag in `instance_settings`:
 * runs exactly once per database, then no-ops on every subsequent startup.
 * Chained after `backfillCharacterVaults` + `migrateVaultPhysicalFiles` so
 * vaults created that morning are already in the new shape and get skipped
 * here (their `wardrobe.json` was written from the DB moments before this runs
 * — rewriting it is a no-op).
 *
 * @module startup/refresh-vault-wardrobe
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';

const logger = createServiceLogger('Startup:VaultWardrobeRefresh');

const WARDROBE_JSON_PATH = 'wardrobe.json';
const REFRESH_FLAG_KEY = 'wardrobe_json_refreshed_v1';

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
      const presets = await repos.outfitPresets.findByCharacterIdRaw(character.id);

      await writeDatabaseDocument(
        mountPointId,
        WARDROBE_JSON_PATH,
        JSON.stringify(
          {
            items,
            presets,
            outfit: { top: null, bottom: null, footwear: null, accessories: null },
          },
          null,
          2,
        ),
      );

      result.refreshed++;
      logger.debug('Refreshed wardrobe.json from DB', {
        characterId: character.id,
        mountPointId,
        itemCount: items.length,
        presetCount: presets.length,
      });
    } catch (err) {
      result.errors++;
      logger.error('Failed to refresh wardrobe.json for character', {
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
