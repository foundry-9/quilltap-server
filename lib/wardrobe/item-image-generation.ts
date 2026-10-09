/**
 * Generate a picture for a wardrobe item or outfit — synchronously, in the
 * calling API route, through the Concierge's image failover chokepoint.
 *
 *   1. Resolve the profile (`resolveWardrobeImageProfile`: override →
 *      designated → default).
 *   2. Resolve the owner (character scope only) and an outfit's leaves, then
 *      build the prompt (`buildWardrobeItemImagePrompt`).
 *   3. `generateImageWithConciergeFailover` with `purpose: 'wardrobe'`. The
 *      editor's Generate button has no chat (`chatId: null`): no Locked
 *      state, no announcement and no ledger; the trail is the only record
 *      and is returned for the editor to show. A tool-queued picture carries
 *      the chat it was asked for in, and that chat's Concierge state governs
 *      it (bug 189): Locked never fails over, Unmoderated routes direct to
 *      the uncensored desk, and a refusal is ledgered and announced there.
 *   4. `convertToWebP` → `addWardrobeItemImage` (bridge write, `files` row,
 *      `imageFileId` update).
 *
 * The preview-avatar route bypasses the failover on purpose; this does not
 * copy it. The attempt closure is the shape of `character-avatar.ts`'s.
 *
 * @module lib/wardrobe/item-image-generation
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { buildImageGenParams } from '@/lib/image-gen/params-builder';
import { getProjectOfficialMountPointId } from '@/lib/image-gen/aesthetic';
import { resolveWardrobeImageProfile } from '@/lib/image-gen/profile-resolution';
import { convertToWebP } from '@/lib/files/webp-conversion';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import { resolveImageProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service';
import {
  generateImageWithConciergeFailover,
  getConciergeTrail,
} from '@/lib/services/dangerous-content/image-failover';
import { readGeneralWardrobe } from '@/lib/mount-index/general-wardrobe';
import { expandComposites } from '@/lib/wardrobe/expand-composites';
import { hydrateComponentGraph } from '@/lib/wardrobe/hydrate-components';
import { sharedWardrobeTiersForCharacter } from '@/lib/wardrobe/shared-tiers';
import {
  buildWardrobeItemImagePrompt,
  type WardrobeImageSubject,
} from '@/lib/wardrobe/item-image-prompt';
import {
  addWardrobeItemImage,
  wardrobeImageUrl,
  type WardrobeItemHome,
} from '@/lib/wardrobe/item-images';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { RouteAttempt } from '@/lib/schemas/chat.types';
import type { Character } from '@/lib/schemas/character.types';
import type { ChatMetadata } from '@/lib/schemas/types';
import type { ImageProfile } from '@/lib/schemas/types';
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types';

const LOG_CONTEXT = 'wardrobe.item-image-generation';

/** The copy the avatar path uses when nothing is configured. */
export const NO_WARDROBE_IMAGE_PROFILE_MESSAGE =
  'No image profile is configured. Set one in Settings → Images before generating wardrobe pictures.';

/** No usable profile: the route answers 400 with this message. */
export class NoWardrobeImageProfileError extends Error {
  constructor() {
    super(NO_WARDROBE_IMAGE_PROFILE_MESSAGE);
    this.name = 'NoWardrobeImageProfileError';
  }
}

/**
 * The provider (and any understudy) refused, or failed. Carries the trail so
 * the route can answer 422 and the editor can show what was tried.
 */
export class WardrobeImageGenerationError extends Error {
  constructor(
    message: string,
    readonly trail: RouteAttempt[] | null,
    readonly refused: boolean,
  ) {
    super(message);
    this.name = 'WardrobeImageGenerationError';
  }
}

export interface WardrobeItemImageGenerationResult {
  fileId: string;
  url: string;
  prompt: string;
  subject: WardrobeImageSubject;
  profile: { id: string; name: string };
  rerouted: boolean;
  trail: RouteAttempt[] | null;
  item: WardrobeItem | null;
}

/**
 * An outfit's leaves, from its container plus the shared archetypes (and, for
 * a character, the character's group stores). Unknown ids drop out.
 */
async function resolveComponentLeaves(
  repos: RepositoryContainer,
  home: WardrobeItemHome,
): Promise<WardrobeItem[]> {
  if (home.item.componentItemIds.length === 0) return [];

  const itemsById = new Map<string, WardrobeItem>();
  for (const i of home.containerItems) itemsById.set(i.id, i);
  if (home.scope !== 'general') {
    try {
      for (const arche of await readGeneralWardrobe(true)) {
        if (!itemsById.has(arche.id)) itemsById.set(arche.id, arche);
      }
    } catch (error) {
      logger.debug('[WardrobeItemImage] Shared archetypes unavailable for component resolution', {
        context: LOG_CONTEXT,
        error: getErrorMessage(error),
      });
    }
  }
  if (home.scope === 'character' && home.characterId) {
    await hydrateComponentGraph(
      repos,
      home.characterId,
      itemsById,
      await sharedWardrobeTiersForCharacter(home.characterId, []),
    );
  }

  const { leafIds } = expandComposites([home.item.id], itemsById);
  return leafIds
    .map((id) => itemsById.get(id))
    .filter((i): i is WardrobeItem => !!i && i.id !== home.item.id);
}

/**
 * The wearer, for a character's own item. A read failure (a broken vault)
 * costs the figure, not the picture: the result is a catalogue shot.
 */
async function resolveOwner(
  repos: RepositoryContainer,
  home: WardrobeItemHome,
): Promise<Character | null> {
  if (home.scope !== 'character' || !home.characterId) return null;
  try {
    return await repos.characters.findById(home.characterId);
  } catch (error) {
    logger.warn('[WardrobeItemImage] Owner unreadable; falling back to a catalogue shot', {
      context: LOG_CONTEXT,
      characterId: home.characterId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * The chat a tool-queued picture belongs to. A failed read costs the chat's
 * Concierge state its snapshot only — the failover re-reads it by id at
 * refusal time.
 */
async function loadChat(
  repos: RepositoryContainer,
  chatId: string,
): Promise<ChatMetadata | null> {
  try {
    return await repos.chats.findById(chatId);
  } catch (error) {
    logger.warn('[WardrobeItemImage] Chat unreadable; the failover will re-read its Concierge state', {
      context: LOG_CONTEXT,
      chatId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/** The project whose aesthetic applies: a project-scope item's own project. */
async function resolveProjectAestheticMount(
  home: WardrobeItemHome,
  containerId: string | null,
): Promise<string | null> {
  if (home.scope !== 'project') return null;
  return getProjectOfficialMountPointId(containerId);
}

/**
 * Generate, store and make current a picture of `home.item`.
 *
 * Throws `NoWardrobeImageProfileError` (→ 400), `WardrobeImageGenerationError`
 * (→ 422 with the trail), and lets `CharacterArchivedError` propagate (→ 409).
 */
export async function generateWardrobeItemImage(
  repos: RepositoryContainer,
  args: {
    userId: string;
    home: WardrobeItemHome;
    /** The container id from the request (project id for the aesthetic). */
    containerId: string | null;
    imageProfileId?: string | null;
    /**
     * The chat a tool-queued picture was asked for in. Its Concierge state
     * governs the call; null (the editor) reads as Moderated with no ledger.
     */
    chatId?: string | null;
  },
): Promise<WardrobeItemImageGenerationResult> {
  const { userId, home } = args;
  const startedAt = Date.now();

  // Refuse a tombstone before spending a provider call.
  await home.resolveMount();

  const profile = (await resolveWardrobeImageProfile(userId, repos, args.imageProfileId)) as ImageProfile | null;
  if (!profile || !profile.apiKeyId) throw new NoWardrobeImageProfileError();

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
  if (!apiKey?.key_value) throw new NoWardrobeImageProfileError();

  const [owner, components, projectOfficialMountPointId] = await Promise.all([
    resolveOwner(repos, home),
    resolveComponentLeaves(repos, home),
    resolveProjectAestheticMount(home, args.containerId),
  ]);

  const { prompt, orientation, subject } = await buildWardrobeItemImagePrompt({
    item: home.item,
    components,
    owner,
    projectOfficialMountPointId,
  });

  logger.debug('[WardrobeItemImage] Generating wardrobe item image', {
    context: LOG_CONTEXT,
    itemId: home.item.id,
    scope: home.scope,
    containerId: args.containerId,
    subject,
    orientation,
    componentCount: components.length,
    profileId: profile.id,
    profileOverride: !!args.imageProfileId,
  });

  const chatId = args.chatId ?? null;
  const chat = chatId ? await loadChat(repos, chatId) : null;
  const chatSettings = await repos.chatSettings.findByUserId(userId);
  const conciergePolicy = resolveConciergeSettings(chatSettings ?? null, chat);
  logger.debug('[WardrobeItemImage] Concierge policy resolved', {
    context: LOG_CONTEXT,
    itemId: home.item.id,
    chatId,
    chatFound: !!chat,
    conciergeState: conciergePolicy.state,
    routeDirect: conciergePolicy.routeDirect,
  });

  // An Unmoderated chat goes straight to the uncensored desk, as the avatar
  // job does: the verdict is already in.
  let primaryProfile: ImageProfile = profile;
  let primaryKey: string = apiKey.key_value;
  if (conciergePolicy.routeDirect) {
    const routeResult = await resolveImageProviderForDangerousContent(
      profile,
      apiKey.key_value,
      conciergePolicy,
      userId,
    );
    if (routeResult.rerouted) {
      primaryProfile = routeResult.imageProfile;
      primaryKey = routeResult.apiKey;
    }
    logger.info('[WardrobeItemImage] Unmoderated chat: routed direct to the uncensored desk', {
      context: LOG_CONTEXT,
      itemId: home.item.id,
      chatId,
      rerouted: routeResult.rerouted,
      profile: primaryProfile.name,
    });
  }

  const attempt = async (attemptProfile: ImageProfile, key: string) => {
    const provider = createImageProvider(attemptProfile.provider);
    const { params } = buildImageGenParams({
      profile: attemptProfile,
      prompt,
      overrides: { n: 1, style: 'natural' },
      orientation,
      logContext: { context: LOG_CONTEXT, itemId: home.item.id, profileId: attemptProfile.id },
    });
    const callStartedAt = Date.now();
    try {
      const response = await provider.generateImage(params, key);
      await logLLMCall({
        userId,
        type: 'WARDROBE_ITEM_IMAGE',
        characterId: home.characterId ?? undefined,
        provider: attemptProfile.provider,
        modelName: attemptProfile.modelName,
        imageProfileId: attemptProfile.id,
        request: { messages: [{ role: 'user', content: prompt }] },
        response: {
          content: response.images?.[0]?.revisedPrompt
            || `Generated ${response.images?.length ?? 0} image(s)${attemptProfile.id !== profile.id ? ' (Concierge reroute)' : ''}`,
        },
        durationMs: Date.now() - callStartedAt,
      });
      return response;
    } catch (error) {
      await logLLMCall({
        userId,
        type: 'WARDROBE_ITEM_IMAGE',
        characterId: home.characterId ?? undefined,
        provider: attemptProfile.provider,
        modelName: attemptProfile.modelName,
        imageProfileId: attemptProfile.id,
        request: { messages: [{ role: 'user', content: prompt }] },
        response: { content: '', error: getErrorMessage(error) },
        durationMs: Date.now() - callStartedAt,
      });
      throw error;
    }
  };

  let failover;
  try {
    failover = await generateImageWithConciergeFailover(
      { profile: primaryProfile, apiKey: primaryKey },
      attempt,
      {
        userId,
        chatId,
        chat,
        purpose: 'wardrobe',
        conciergePolicy,
        primaryVia: primaryProfile.id !== profile.id ? 'concierge' : 'primary',
      },
    );
  } catch (error) {
    const trail = getConciergeTrail(error);
    const refused = !!trail && trail.some((row) => row.outcome === 'refused');
    logger.warn('[WardrobeItemImage] Wardrobe item image generation failed', {
      context: LOG_CONTEXT,
      itemId: home.item.id,
      error: getErrorMessage(error),
      refused,
      conciergeTrail: trail?.map((row) => ({ profileName: row.profileName, outcome: row.outcome, detail: row.detail })),
    });
    throw new WardrobeImageGenerationError(getErrorMessage(error), trail, refused);
  }

  const imageData = failover.result.images?.[0];
  const rawData = imageData?.data || imageData?.b64Json;
  if (!imageData || !rawData) {
    throw new WardrobeImageGenerationError('The image provider returned no picture', failover.trail.length ? failover.trail : null, false);
  }

  const providerMimeType = imageData.mimeType || 'image/png';
  const converted = await convertToWebP(
    Buffer.from(rawData, 'base64'),
    providerMimeType,
    `wardrobe.${providerMimeType.split('/')[1] || 'png'}`,
  );

  const { file, item } = await addWardrobeItemImage(repos, home, {
    userId,
    kind: 'generated',
    content: converted.buffer,
    contentType: converted.mimeType,
    width: converted.width ?? null,
    height: converted.height ?? null,
    generationPrompt: prompt,
    generationModel: failover.profile.modelName,
    generationRevisedPrompt: imageData.revisedPrompt || null,
  });

  logger.info('[WardrobeItemImage] Wardrobe item image generated', {
    context: LOG_CONTEXT,
    itemId: home.item.id,
    fileId: file.id,
    bytes: file.size,
    subject,
    profileId: failover.profile.id,
    rerouted: failover.rerouted,
    durationMs: Date.now() - startedAt,
  });

  return {
    fileId: file.id,
    url: wardrobeImageUrl(file.id),
    prompt,
    subject,
    profile: { id: failover.profile.id, name: failover.profile.name },
    rerouted: failover.rerouted,
    trail: failover.trail.length > 0 ? failover.trail : null,
    item,
  };
}
