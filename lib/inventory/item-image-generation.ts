/**
 * Generate a picture of an Inventory object — synchronously, in the calling
 * API route, through the Concierge's image failover chokepoint, as the
 * wardrobe's item pictures are (`lib/wardrobe/item-image-generation.ts`).
 *
 * The subject is the object's `imageDescription`, then its `description`,
 * then its name (spec §2): an object-icon still life — one object, centred,
 * plain ground, no person. The editor has no chat, so there is no Locked
 * state, no announcement and no ledger; the trail is returned for the editor.
 * Log rows are `INVENTORY_ITEM_IMAGE`, counted as image spend.
 *
 * @module lib/inventory/item-image-generation
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { resolveAesthetic, getProjectOfficialMountPointId } from '@/lib/image-gen/aesthetic';
import { withArtDirection } from '@/lib/image-gen/avatar-prompt';
import { resolveWardrobeImageProfile } from '@/lib/image-gen/profile-resolution';
import { decodeProviderImage, makeLoggedImageAttempt } from '@/lib/image-gen/image-attempt';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import {
  generateImageWithConciergeFailover,
  getConciergeTrail,
} from '@/lib/services/dangerous-content/image-failover';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { RouteAttempt } from '@/lib/schemas/chat.types';
import type { ImageProfile } from '@/lib/schemas/types';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import { addInventoryItemImage, type InventoryItemHome } from '@/lib/inventory/item-images';

const LOG_CONTEXT = 'inventory.item-image-generation';

/** No usable profile (a 400). */
export class NoInventoryImageProfileError extends Error {
  constructor() {
    super('No image profile is configured. Set one in Settings → Images before generating pictures of objects.');
    this.name = 'NoInventoryImageProfileError';
  }
}

/** The provider refused or failed; carries the trail. */
export class InventoryImageGenerationError extends Error {
  constructor(message: string, readonly trail: RouteAttempt[] | null, readonly refused: boolean) {
    super(message);
    this.name = 'InventoryImageGenerationError';
  }
}

/** What the picture shows: `imageDescription ?? description ?? name`. */
export function inventoryImageSubject(item: Pick<ResolvedInventoryItem, 'imageDescription' | 'description' | 'name' | 'title'>): string {
  const subject = item.imageDescription?.trim() || item.description?.trim() || item.title?.trim() || item.name;
  return subject.replace(/[.!?]+$/, '');
}

/** The object-icon prompt: one object, centred, plain ground, no person. Pure. */
export function buildInventoryItemImagePrompt(
  item: Pick<ResolvedInventoryItem, 'imageDescription' | 'description' | 'name' | 'title'>,
): string {
  return `Still-life product photograph of ${inventoryImageSubject(item)}. A single object, centred, shown whole on a plain neutral ground, even soft light, no person and no hands. The object is the subject.`;
}

export interface InventoryItemImageGenerationResult {
  fileId: string;
  prompt: string;
  profile: { id: string; name: string };
  rerouted: boolean;
  trail: RouteAttempt[] | null;
}

/** Generate, store and make current a picture of `home.item`. */
export async function generateInventoryItemImage(
  repos: RepositoryContainer,
  args: { userId: string; home: InventoryItemHome; imageProfileId?: string | null },
): Promise<InventoryItemImageGenerationResult> {
  const { userId, home } = args;
  // Refuse a tombstone before spending a provider call.
  await home.location.writableMountPointId();

  const profile = (await resolveWardrobeImageProfile(userId, repos, args.imageProfileId)) as ImageProfile | null;
  if (!profile || !profile.apiKeyId) throw new NoInventoryImageProfileError();
  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
  if (!apiKey?.key_value) throw new NoInventoryImageProfileError();

  const projectMount = home.location.scope === 'project' ? await getProjectOfficialMountPointId(home.location.id) : null;
  const prompt = withArtDirection(
    buildInventoryItemImagePrompt(home.item),
    await resolveAesthetic({ kind: 'lantern', projectOfficialMountPointId: projectMount ?? undefined }),
  );
  logger.debug('[InventoryItemImage] Generating inventory object image', {
    context: LOG_CONTEXT,
    itemId: home.record.id,
    scope: home.location.scope,
    profileId: profile.id,
  });

  const conciergePolicy = resolveConciergeSettings((await repos.chatSettings.findByUserId(userId)) ?? null, null);
  const attempt = makeLoggedImageAttempt({
    userId,
    logType: 'INVENTORY_ITEM_IMAGE',
    prompt,
    primaryProfileId: profile.id,
    chatId: null,
    characterId: home.location.characterId,
    params: {
      overrides: { n: 1, style: 'natural' },
      orientation: 'square',
      logContext: { context: LOG_CONTEXT, itemId: home.record.id },
    },
  });

  let failover;
  try {
    failover = await generateImageWithConciergeFailover(
      { profile, apiKey: apiKey.key_value },
      attempt,
      { userId, chatId: null, chat: null, purpose: 'dialog', conciergePolicy, primaryVia: 'primary' },
    );
  } catch (error) {
    const trail = getConciergeTrail(error);
    const refused = !!trail && trail.some((row) => row.outcome === 'refused');
    logger.warn('[InventoryItemImage] Inventory object image generation failed', {
      context: LOG_CONTEXT,
      itemId: home.record.id,
      error: getErrorMessage(error),
      refused,
    });
    throw new InventoryImageGenerationError(getErrorMessage(error), trail, refused);
  }

  const decoded = await decodeProviderImage(failover.result, 'inventory');
  if (!decoded) {
    throw new InventoryImageGenerationError('The image provider returned no picture', failover.trail.length ? failover.trail : null, false);
  }
  const { file } = await addInventoryItemImage(repos, home, {
    userId,
    kind: 'generated',
    content: decoded.buffer,
    contentType: decoded.mimeType,
    width: decoded.width,
    height: decoded.height,
    generationPrompt: prompt,
    generationModel: failover.profile.modelName,
    generationRevisedPrompt: decoded.revisedPrompt,
  });
  logger.info('[InventoryItemImage] Inventory object image generated', {
    context: LOG_CONTEXT,
    itemId: home.record.id,
    fileId: file.id,
    profileId: failover.profile.id,
    rerouted: failover.rerouted,
  });
  return {
    fileId: file.id,
    prompt,
    profile: { id: failover.profile.id, name: failover.profile.name },
    rerouted: failover.rerouted,
    trail: failover.trail.length > 0 ? failover.trail : null,
  };
}
