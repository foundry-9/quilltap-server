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
import { processSingleton } from '@/lib/utils/process-singleton';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { ensureCharacterMetadataFile, ensureCharacterPropertiesFile } from '@/lib/characters/vault/scaffold';
import { readCharacterVaultPropertiesForWrite } from '@/lib/characters/vault/readers';

const logger = createServiceLogger('Startup:CharacterVaultBackfill');

/** The last run's result, kept for the Almanack (process-wide — bug 235). */
const lastRun = processSingleton('startup.characterVaultBackfill.lastRun', () => ({
  result: null as BackfillResult | null,
}));

/**
 * The most recent backfill's result, or null before the first run. The
 * Almanack reads `invalidKeystones` from it: the vaults whose `properties.json`
 * the heal found present but invalid and left for repair.
 */
export function getLastCharacterVaultBackfill(): BackfillResult | null {
  return lastRun.result;
}

export interface BackfillResult {
  scanned: number;
  vaultsCreated: number;
  alreadyLinked: number;
  /** Pre-linked vaults whose ABSENT `properties.json` we seeded with defaults. */
  propertiesSeeded: number;
  /**
   * Pre-linked vaults whose `properties.json` is present but unreadable or
   * invalid. Reported and left alone — never rewritten (#148).
   */
  keystonesInvalid: number;
  /** The characters behind {@link keystonesInvalid}, with the parse error. */
  invalidKeystones: Array<{ characterId: string; name: string; mountPointId: string; detail: string }>;
  /** Pre-existing vaults we seeded an empty `metadata.json` into. */
  metadataSeeded: number;
  errors: number;
}

export async function backfillCharacterVaults(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    vaultsCreated: 0,
    alreadyLinked: 0,
    propertiesSeeded: 0,
    keystonesInvalid: 0,
    invalidKeystones: [],
    metadataSeeded: 0,
    errors: 0,
  };

  const repos = getRepositories();
  // Raw reads: the backfill needs only the pointer, and must survive a
  // character whose vault is broken (that is what it is here to find).
  const characters = await repos.characters.findAllRaw();
  result.scanned = characters.length;

  const { startupProgress } = await import('@/lib/startup/progress');
  startupProgress.setCurrent('subsystem:vault-backfill:start', {
    detail: `${characters.length} ${characters.length === 1 ? 'character' : 'characters'}`,
  });

  logger.info('Character vault backfill scanning', { total: characters.length });

  let index = 0;
  for (const character of characters) {
    if (character.archivedAt) {
      index++;
      startupProgress.setSubProgress([
        { current: index, total: characters.length, unit: 'characters' },
      ]);
      continue;
    }
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
        // ensureCharacterVault early-returns on a set FK without verifying the
        // vault files. The heal is deliberately narrow (D1, #148): an ABSENT
        // properties.json is seeded with defaults; a PRESENT one that fails to
        // parse is reported and left alone. Nothing else is written, ever —
        // the content files hold the only copy of the character, and a raw
        // row has nothing to put back in them.
        try {
          await readCharacterVaultPropertiesForWrite(outcome.mountPointId, character.id);
          if (await ensureCharacterPropertiesFile(outcome.mountPointId)) {
            result.propertiesSeeded++;
            logger.warn('Seeded an absent properties.json with defaults', {
              characterId: character.id,
              mountPointId: outcome.mountPointId,
            });
          }
        } catch (keystoneErr) {
          const detail = keystoneErr instanceof Error ? keystoneErr.message : String(keystoneErr);
          result.keystonesInvalid++;
          result.invalidKeystones.push({
            characterId: character.id,
            name: character.name,
            mountPointId: outcome.mountPointId,
            detail,
          });
          logger.error('Character vault properties.json is present but invalid; left untouched for repair', {
            characterId: character.id,
            name: character.name,
            mountPointId: outcome.mountPointId,
            detail,
          });
        }

        // Every vault provisioned before the fact sheet existed has no
        // metadata.json. Hydration copes with that perfectly well — absence
        // reads as {} — but the file manager is the only place a sheet can be
        // edited, so without a file there is nothing for the user to open and
        // the feature is unreachable on an existing roster. Seeding here rather
        // than in a one-time migration also covers vaults adopted or restored
        // later, which arrive by paths no migration would ever revisit.
        if (await ensureCharacterMetadataFile(outcome.mountPointId)) {
          result.metadataSeeded++;
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

  lastRun.result = result;
  logger.info('Character vault backfill complete', result);
  startupProgress.publish({
    rawLabel: 'subsystem:vault-backfill:complete',
    detail: `${result.vaultsCreated} created, ${result.alreadyLinked} already linked${result.propertiesSeeded > 0 ? `, ${result.propertiesSeeded} settings files seeded` : ''}${result.keystonesInvalid > 0 ? `, ${result.keystonesInvalid} need repair` : ''}${result.metadataSeeded > 0 ? `, ${result.metadataSeeded} fact sheets seeded` : ''}${result.errors > 0 ? `, ${result.errors} errors` : ''}`,
    level: result.errors > 0 || result.keystonesInvalid > 0 ? 'warn' : 'info',
  });
  startupProgress.setSubProgress(null);
  return result;
}
