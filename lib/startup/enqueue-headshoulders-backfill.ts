/**
 * Head-and-Shoulders Prompt Backfill (enqueue)
 *
 * One-time startup scan that enqueues a CHARACTER_HEADSHOULDERS_BACKFILL job for
 * every existing character that has appearance text but no
 * `headAndShouldersPrompt` yet. The avatar generator prefers that variant
 * (avatars are a head-and-shoulders crop), so backfilling it stops full-body
 * anatomy from leaking into avatar prompts and tripping image-provider
 * moderation.
 *
 * We ENQUEUE jobs rather than calling the LLM inline: per-character generation
 * must not block the startup loading screen, and a job survives a missing /
 * cold provider via retry. Gated by the `headshoulders_backfill_enqueued_v1`
 * flag in `instance_settings` so the scan runs exactly once per database.
 * Chained after `backfillCharacterVaults` + the vault file migrations so every
 * character already has a vault to write the result back into.
 *
 * @module startup/enqueue-headshoulders-backfill
 */
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawDatabase } from '@/lib/database/backends/sqlite/client';
import { enqueueCharacterHeadShouldersBackfill } from '@/lib/background-jobs/queue-service';

const logger = createServiceLogger('Startup:HeadShouldersBackfill');

const FLAG_KEY = 'headshoulders_backfill_enqueued_v1';

export interface HeadShouldersBackfillEnqueueResult {
  scanned: number;
  enqueued: number;
  skipped: number;
  alreadyDone: boolean;
}

export async function enqueueHeadShouldersBackfill(): Promise<HeadShouldersBackfillEnqueueResult> {
  const result: HeadShouldersBackfillEnqueueResult = {
    scanned: 0,
    enqueued: 0,
    skipped: 0,
    alreadyDone: false,
  };

  if (hasRun()) {
    result.alreadyDone = true;
    return result;
  }

  const repos = getRepositories();
  // Overlay-aware so physicalDescription is hydrated from each vault; the batch
  // overlay drops broken vaults rather than throwing.
  const characters = await repos.characters.findAll();
  result.scanned = characters.length;

  logger.info('Head-and-shoulders backfill scanning', { total: characters.length });

  for (const character of characters) {
    // No vault → nowhere to persist the field (the job child cannot provision
    // one). Vault backfill ran earlier in the startup chain.
    if (!character.characterDocumentMountPointId) {
      result.skipped++;
      continue;
    }
    const pd = character.physicalDescription;
    if (!pd) {
      result.skipped++;
      continue;
    }
    if (pd.headAndShouldersPrompt && pd.headAndShouldersPrompt.trim()) {
      result.skipped++;
      continue;
    }
    const hasSeed = Boolean(
      pd.mediumPrompt || pd.shortPrompt || pd.longPrompt || pd.completePrompt || pd.fullDescription,
    );
    if (!hasSeed) {
      result.skipped++;
      continue;
    }

    try {
      // maxAttempts: 3 — a cold job child whose plugins/provider aren't ready
      // yet should retry, not burn its one shot. Generation is idempotent.
      const { isNew } = await enqueueCharacterHeadShouldersBackfill(
        character.userId,
        { characterId: character.id },
        { maxAttempts: 3 },
      );
      if (isNew) result.enqueued++;
      else result.skipped++;
    } catch (err) {
      logger.warn('Failed to enqueue head-and-shoulders backfill', {
        characterId: character.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Yield so a large library doesn't hog the event loop during startup.
    await new Promise(resolve => setImmediate(resolve));
  }

  // Record the flag even if zero were enqueued, so steady-state startups no-op.
  markRun();
  logger.info('Head-and-shoulders backfill enqueue complete', {
    scanned: result.scanned,
    enqueued: result.enqueued,
    skipped: result.skipped,
  });
  return result;
}

function hasRun(): boolean {
  const db = getRawDatabase();
  if (!db) return false;
  try {
    const row = db
      .prepare(`SELECT "value" FROM "instance_settings" WHERE "key" = ?`)
      .get(FLAG_KEY) as { value: string } | undefined;
    return row?.value === 'true';
  } catch (err) {
    logger.warn('Failed to read head-and-shoulders backfill flag; treating as not-yet-run', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function markRun(): void {
  const db = getRawDatabase();
  if (!db) return;
  try {
    db.prepare(
      `INSERT INTO "instance_settings" ("key", "value") VALUES (?, ?)
       ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
    ).run(FLAG_KEY, 'true');
  } catch (err) {
    logger.warn('Failed to record head-and-shoulders backfill flag', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
