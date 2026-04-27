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

const logger = createServiceLogger('Startup:CharacterVaultBackfill');

export interface BackfillResult {
  scanned: number;
  vaultsCreated: number;
  alreadyLinked: number;
  errors: number;
}

export async function backfillCharacterVaults(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    vaultsCreated: 0,
    alreadyLinked: 0,
    errors: 0,
  };

  const repos = getRepositories();
  // Raw reads so the vault populator writes DB values to properties.json,
  // never the overlaid (vault-sourced) values it would otherwise see.
  const characters = await repos.characters.findAllRaw();
  result.scanned = characters.length;

  logger.info('Character vault backfill scanning', { total: characters.length });

  for (const character of characters) {
    try {
      const outcome = await ensureCharacterVault(character);
      if (outcome.created) {
        result.vaultsCreated++;
      } else {
        result.alreadyLinked++;
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
  return result;
}
