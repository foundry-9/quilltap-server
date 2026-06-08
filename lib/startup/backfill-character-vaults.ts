/**
 * Character Vault Backfill
 *
 * On server startup, ensures every Character has a linked database-backed
 * character document store ("vault"). Delegates per-character vault
 * provisioning to `ensureCharacterVault()`; this module just iterates
 * and coordinates logging.
 *
 * Idempotent: characters already carrying characterDocumentMountPointId are
 * skipped. Per-character failures are logged and do not stop the remainder
 * of the run.
 *
 * @module startup/backfill-character-vaults
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import {
  readCharacterVaultProperties,
  writeCharacterVaultManagedFields,
} from '@/lib/database/repositories/character-properties-overlay';

const logger = createServiceLogger('Startup:CharacterVaultBackfill');

export interface BackfillResult {
  scanned: number;
  vaultsCreated: number;
  alreadyLinked: number;
  /** Pre-linked vaults whose missing files we repopulated from the raw row. */
  filesRepopulated: number;
  errors: number;
}

export async function backfillCharacterVaults(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    vaultsCreated: 0,
    alreadyLinked: 0,
    filesRepopulated: 0,
    errors: 0,
  };

  const repos = getRepositories();
  // Raw reads so the vault populator writes DB values to properties.json,
  // never the overlaid (vault-sourced) values it would otherwise see.
  const characters = await repos.characters.findAllRaw();
  result.scanned = characters.length;

  const { startupProgress } = await import('@/lib/startup/progress');
  startupProgress.setCurrent('subsystem:vault-backfill:start', {
    detail: `${characters.length} ${characters.length === 1 ? 'character' : 'characters'}`,
  });

  logger.info('Character vault backfill scanning', { total: characters.length });

  let index = 0;
  for (const character of characters) {
    index++;
    startupProgress.setSubProgress([
      { current: index, total: characters.length, unit: 'characters' },
    ]);
    try {
      const outcome = await ensureCharacterVault(character);
      if (outcome.created) {
        result.vaultsCreated++;
      } else {
        result.alreadyLinked++;
        // ensureCharacterVault early-returns on a set FK WITHOUT verifying the
        // vault files exist. A linked-but-unpopulated vault now reads as
        // CharacterVaultUnavailableError (the overlay throws on missing
        // properties.json), so heal it here from the raw row — mirrors the
        // project/group store backfills.
        const existingProps = await readCharacterVaultProperties(outcome.mountPointId, character.id);
        if (!existingProps) {
          const wardrobeItems = await repos.wardrobe.findByCharacterIdRaw(character.id);
          await writeCharacterVaultManagedFields(outcome.mountPointId, { character, wardrobeItems });
          result.filesRepopulated++;
          logger.warn('Repopulated character vault with missing files', {
            characterId: character.id,
            mountPointId: outcome.mountPointId,
          });
        }
      }
    } catch (err) {
      result.errors++;
      logger.error('Failed to create character vault', {
        characterId: character.id,
        name: character.name,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // Yield to the event loop between characters so backfilling a large roster
    // doesn't hog the main thread (each character is ~20-30 sync SQLCipher writes).
    await new Promise<void>(resolve => setImmediate(resolve));
  }

  logger.info('Character vault backfill complete', result);
  startupProgress.publish({
    rawLabel: 'subsystem:vault-backfill:complete',
    detail: `${result.vaultsCreated} created, ${result.alreadyLinked} already linked${result.filesRepopulated > 0 ? `, ${result.filesRepopulated} repopulated` : ''}${result.errors > 0 ? `, ${result.errors} errors` : ''}`,
    level: result.errors > 0 ? 'warn' : 'info',
  });
  startupProgress.setSubProgress(null);
  return result;
}
