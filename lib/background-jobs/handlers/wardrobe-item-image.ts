/**
 * WARDROBE_ITEM_IMAGE_GENERATION — draw a picture of one wardrobe item,
 * queued by `wardrobe_create` / `wardrobe_update` when the operator has let
 * the wardrobe tools commission pictures
 * (`chatSettings.wardrobeImageSettings.generateFromTools`).
 *
 * The work is `generateWardrobeItemImage`, the same path the editor's Generate
 * button takes: designated profile, worn-by-owner prompt, the Concierge's
 * image failover, then `addWardrobeItemImage`. In the job child the bridge
 * write goes to the parent over host-RPC; the `files` row and the item's
 * `imageFileId` patch ride the buffered-write batch, exactly as the avatar
 * job's do.
 *
 * Nothing here retries a spend: a missing profile, a refusal or a provider
 * failure is logged and the job ends (the enqueue sets `maxAttempts: 1`, and
 * the expected failures return rather than throw).
 *
 * @module lib/background-jobs/handlers/wardrobe-item-image
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import type { BackgroundJob } from '@/lib/schemas/types';
import type { WardrobeItemImageGenerationPayload } from '../queue-service';
import { resolveWardrobeItemHome } from '@/lib/wardrobe/item-images';
import {
  generateWardrobeItemImage,
  NoWardrobeImageProfileError,
  WardrobeImageGenerationError,
} from '@/lib/wardrobe/item-image-generation';
import { CharacterArchivedError } from '@/lib/database/repositories/characters.repository';

const LOG_CONTEXT = 'background-jobs.wardrobe-item-image';

export async function handleWardrobeItemImageGeneration(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as WardrobeItemImageGenerationPayload;
  const repos = getRepositories();

  logger.info('[WardrobeItemImage] Starting tool-queued wardrobe item image', {
    context: LOG_CONTEXT,
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
    itemId: payload.itemId,
  });

  const home = await resolveWardrobeItemHome(
    repos,
    job.userId,
    'character',
    payload.characterId,
    payload.itemId,
  );
  if (!home) {
    // Deleted, moved or given away between the tool call and now.
    logger.info('[WardrobeItemImage] Item no longer in the character\'s wardrobe; nothing to draw', {
      context: LOG_CONTEXT,
      jobId: job.id,
      characterId: payload.characterId,
      itemId: payload.itemId,
    });
    return;
  }
  if (home.item.archivedAt) {
    logger.info('[WardrobeItemImage] Item archived since the tool call; skipping', {
      context: LOG_CONTEXT,
      jobId: job.id,
      itemId: payload.itemId,
    });
    return;
  }

  try {
    const result = await generateWardrobeItemImage(repos, {
      userId: job.userId,
      home,
      containerId: payload.characterId,
    });

    logger.info('[WardrobeItemImage] Tool-queued wardrobe item image complete', {
      context: LOG_CONTEXT,
      jobId: job.id,
      itemId: payload.itemId,
      fileId: result.fileId,
      subject: result.subject,
      profileId: result.profile.id,
      rerouted: result.rerouted,
    });
  } catch (error) {
    if (error instanceof NoWardrobeImageProfileError) {
      logger.warn('[WardrobeItemImage] No usable image profile; skipping', {
        context: LOG_CONTEXT,
        jobId: job.id,
        itemId: payload.itemId,
      });
      return;
    }
    if (error instanceof CharacterArchivedError) {
      logger.info('[WardrobeItemImage] Owner archived since the tool call; skipping', {
        context: LOG_CONTEXT,
        jobId: job.id,
        characterId: payload.characterId,
      });
      return;
    }
    if (error instanceof WardrobeImageGenerationError) {
      logger.warn('[WardrobeItemImage] Provider would not draw the item', {
        context: LOG_CONTEXT,
        jobId: job.id,
        itemId: payload.itemId,
        refused: error.refused,
        error: error.message,
        trail: error.trail?.map((row) => ({ profileName: row.profileName, outcome: row.outcome })),
      });
      return;
    }
    throw error;
  }
}
