/**
 * Vault Physical-File Migration
 *
 * One-time migration for existing character vaults to align their physical-*
 * files with the per-character document-store overlay. Historically,
 * `physical-description.md` held an aggregate markdown rendering of all
 * physical descriptions (write-only; nothing parsed it). The overlay treats
 * it as the single primary `fullDescription` instead, and introduces a new
 * sibling `physical-prompts.json` carrying the four prompt tiers as JSON.
 *
 * This migration runs at startup after the character-vault backfill. For each
 * character whose vault is missing `physical-prompts.json`, it regenerates
 * `physical-description.md` from the DB's primary physical description and
 * writes a fresh `physical-prompts.json` alongside. The presence of
 * `physical-prompts.json` is the idempotency marker, so repeated runs are
 * no-ops.
 *
 * A very brief window of development builds seeded this file as
 * `physical-prompts.md`. Any vault still carrying that legacy name is cleaned
 * up here as part of the same migration pass so the vault UI (and any eventual
 * search indexers) no longer show the stale `.md` file next to the correct
 * `.json` one. Any `chat_documents` rows that were left pointing at the old
 * `physical-prompts.md` (because a Salon user opened the file in document mode
 * during that window) are rewritten to `physical-prompts.json` so the chat
 * loads without a 404 on next open.
 *
 * Vaults created fresh by the populator are already in the new shape and get
 * skipped here; vaults created before this feature shipped are migrated once.
 *
 * @module startup/migrate-vault-physical-files
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  writeDatabaseDocument,
  deleteDatabaseDocument,
} from '@/lib/mount-index/database-store';

const logger = createServiceLogger('Startup:VaultPhysicalFileMigration');

const PHYSICAL_DESCRIPTION_PATH = 'physical-description.md';
const PHYSICAL_PROMPTS_PATH = 'physical-prompts.json';
const LEGACY_PHYSICAL_PROMPTS_PATH = 'physical-prompts.md';

export interface VaultPhysicalMigrationResult {
  scanned: number;
  migrated: number;
  alreadyCurrent: number;
  legacyCleaned: number;
  chatDocumentsRenamed: number;
  skipped: number;
  errors: number;
}

export async function migrateVaultPhysicalFiles(): Promise<VaultPhysicalMigrationResult> {
  const result: VaultPhysicalMigrationResult = {
    scanned: 0,
    migrated: 0,
    alreadyCurrent: 0,
    legacyCleaned: 0,
    chatDocumentsRenamed: 0,
    skipped: 0,
    errors: 0,
  };

  const repos = getRepositories();
  const characters = await repos.characters.findAllRaw();
  result.scanned = characters.length;

  logger.info('Vault physical-file migration scanning', { total: characters.length });

  for (const character of characters) {
    if (!character.characterDocumentMountPointId) {
      result.skipped++;
      continue;
    }

    const mountPointId = character.characterDocumentMountPointId;

    try {
      // Any vault carrying the legacy `.md` name gets it swept regardless of
      // whether the `.json` target is already in place — that way vaults that
      // caught the first (wrong-extension) migration run are cleaned up even
      // if a later manual fix already produced the correct file.
      const legacy = await repos.docMountDocuments.findByMountPointAndPath(
        mountPointId,
        LEGACY_PHYSICAL_PROMPTS_PATH,
      );
      if (legacy) {
        await deleteDatabaseDocument(mountPointId, LEGACY_PHYSICAL_PROMPTS_PATH);
        result.legacyCleaned++;
        logger.debug('Removed legacy physical-prompts.md from vault', {
          characterId: character.id,
          mountPointId,
        });
      }

      const existingPrompts = await repos.docMountDocuments.findByMountPointAndPath(
        mountPointId,
        PHYSICAL_PROMPTS_PATH,
      );
      if (existingPrompts) {
        result.alreadyCurrent++;
        continue;
      }

      const primary = (character.physicalDescriptions ?? [])[0];

      await writeDatabaseDocument(
        mountPointId,
        PHYSICAL_DESCRIPTION_PATH,
        primary?.fullDescription ?? '',
      );

      await writeDatabaseDocument(
        mountPointId,
        PHYSICAL_PROMPTS_PATH,
        JSON.stringify(
          {
            short: primary?.shortPrompt ?? null,
            medium: primary?.mediumPrompt ?? null,
            long: primary?.longPrompt ?? null,
            complete: primary?.completePrompt ?? null,
          },
          null,
          2,
        ),
      );

      result.migrated++;
      logger.debug('Migrated vault physical files', {
        characterId: character.id,
        mountPointId,
        hasPrimary: !!primary,
      });
    } catch (err) {
      result.errors++;
      logger.error('Failed to migrate vault physical files', {
        characterId: character.id,
        mountPointId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }

    // Yield to the event loop between vaults so the migration does not hog
    // the main thread on large rosters.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  try {
    const renamed = await repos.chatDocuments.renameFilePath(
      LEGACY_PHYSICAL_PROMPTS_PATH,
      PHYSICAL_PROMPTS_PATH,
    );
    result.chatDocumentsRenamed = renamed;
    if (renamed > 0) {
      logger.debug('Rewrote stale chat_documents filePaths', { renamed });
    }
  } catch (err) {
    result.errors++;
    logger.error('Failed to sweep stale chat_documents filePaths', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }

  logger.info('Vault physical-file migration complete', result);
  return result;
}
