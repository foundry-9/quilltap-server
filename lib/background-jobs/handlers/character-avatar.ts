/**
 * Character Avatar Generation Handler
 *
 * Generates a portrait avatar for a character based on their equipped wardrobe
 * items and physical descriptions. Triggered when outfits change in a chat
 * with avatar generation enabled.
 *
 * Follows the story-background handler pattern but generates portrait-oriented
 * character avatars instead of landscape backgrounds.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import {
  getCharacterVaultStore,
  writeCharacterAvatarToVault,
} from '@/lib/file-storage/character-vault-bridge';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { CharacterAvatarGenerationPayload } from '../queue-service';
import {
  resolveConciergeSettings,
} from '@/lib/services/dangerous-content/resolver.service';
import {
  classifyContent as classifyDangerousContent,
} from '@/lib/services/dangerous-content/gatekeeper.service';
import { resolveImageProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service';
import {
  generateImageWithConciergeFailover,
  getConciergeTrail,
} from '@/lib/services/dangerous-content/image-failover';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { resolveCheapLLMSelectionForUser } from '@/lib/llm/cheap-llm-user-selection';
import { buildCharacterAvatarPrompt } from '@/lib/image-gen/avatar-prompt';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import { resolveAesthetic, getProjectOfficialMountPointId } from '@/lib/image-gen/aesthetic';
import { buildImageGenParams } from '@/lib/image-gen/params-builder';
import { decodeProviderImage, makeLoggedImageAttempt } from '@/lib/image-gen/image-attempt';
import { createGeneratedFileRow } from '@/lib/files/generated-file-row';
import { postLanternImageNotification } from '@/lib/services/lantern-notifications/writer';
import { deriveAvatarCacheKeys, lookupCachedAvatar } from '@/lib/image-gen/avatar-cache';

/**
 * Point a chat (and the character's per-chat override) at an avatar image.
 *
 * Shared by the generation path and the configuration-cache hit path: a reused
 * avatar must bind exactly the way a freshly drawn one does, or the two paths
 * drift and a cached avatar shows up in one surface but not the other.
 */
async function bindAvatarToChat(
  repos: ReturnType<typeof getRepositories>,
  args: {
    chat: { characterAvatars?: unknown; messageCount?: number | null };
    character: { id: string; avatarOverrides?: Array<{ chatId: string; imageId: string }> | null };
    chatId: string;
    fileId: string;
  },
): Promise<void> {
  const { chat, character, chatId, fileId } = args;

  const existingAvatars = (chat.characterAvatars && typeof chat.characterAvatars === 'object')
    ? chat.characterAvatars as Record<string, unknown>
    : {};

  await repos.chats.update(chatId, {
    characterAvatars: {
      ...existingAvatars,
      [character.id]: {
        imageId: fileId,
        generatedAt: new Date().toISOString(),
        afterMessageCount: chat.messageCount ?? 0,
      },
    },
  });

  const existingOverrides = character.avatarOverrides || [];
  const filteredOverrides = existingOverrides.filter(o => o.chatId !== chatId);
  filteredOverrides.push({ chatId, imageId: fileId });

  await repos.characters.update(character.id, {
    avatarOverrides: filteredOverrides,
  });
}

/**
 * Handle CHARACTER_AVATAR_GENERATION job.
 *
 * 1. Load character + equipped wardrobe items
 * 2. Build appearance description from physical descriptions + equipped items
 * 3. Look the configuration up in the avatar cache — a hit binds and stops here
 * 4. Run prompt through Concierge (dangerous content classification + provider rerouting)
 * 5. Generate portrait image
 * 6. Store image in the character's vault and update chat.characterAvatars
 */
export async function handleCharacterAvatarGeneration(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as CharacterAvatarGenerationPayload;
  const repos = getRepositories();

  logger.info('[CharacterAvatar] Starting avatar generation', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
  });

  // 1. Load chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  // 2. Load character
  const character = await repos.characters.findById(payload.characterId);
  if (!character) {
    throw new Error(`Character not found: ${payload.characterId}`);
  }

  // 3. Get image profile
  const imageProfile = await repos.imageProfiles.findById(payload.imageProfileId);
  if (!imageProfile) {
    throw new Error(`Image profile not found: ${payload.imageProfileId}`);
  }

  if (!imageProfile.apiKeyId) {
    logger.warn('[CharacterAvatar] Image profile has no API key, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      profileId: imageProfile.id,
    });
    return;
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(imageProfile.apiKeyId, job.userId);
  if (!apiKey?.key_value) {
    logger.warn('[CharacterAvatar] API key not found or invalid, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    });
    return;
  }

  // 4. Build portrait prompt — 3/4 head-and-shoulders crop, no scenario context.
  // Scenario text is deliberately excluded: it often mentions other characters
  // or narrative elements that cause image models to depict multiple people.
  // The fitting-room override (when present) takes priority over the chat's
  // stored equipped state — the operator may be previewing an outfit that
  // hasn't been committed to the chat.
  const equippedSlots = payload.equippedSlotsOverride
    ?? await repos.chats.getEquippedOutfitForCharacter(payload.chatId, payload.characterId);
  const avatarProjectMountPointIds = await resolveProjectMountPointIds(chat.projectId);
  // Aurora character aesthetic (people/outfit look), project-over-global. The
  // Ariel Clause (depiction-guidelines.md) deliberately does NOT apply to avatars.
  const characterAesthetic = await resolveAesthetic({
    kind: 'aurora',
    projectOfficialMountPointId: await getProjectOfficialMountPointId(chat.projectId),
  });
  const { prompt, hasAppearance, leafCounts } = await buildCharacterAvatarPrompt(repos, character, {
    equippedSlots,
    projectMountPointIds: avatarProjectMountPointIds,
    characterAesthetic,
  });

  if (!hasAppearance) {
    logger.warn('[CharacterAvatar] No appearance data available, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      characterId: payload.characterId,
    });
    return;
  }

  // 5. Avatar configuration cache.
  //
  // Built from the ORIGINAL profile, before the Concierge classification below,
  // so a hit skips that LLM call as well as the image call, the WebP transcode
  // and the file write. A Concierge reroute therefore stores its image under
  // the originally-requested key — correct (same inputs, same outcome), though
  // it means a cached row's generationModel need not match its key's model.
  //
  // These params are reused verbatim for generation on a miss; only a reroute
  // rebuilds them, since the fallback provider's shape mechanism, LoRA support
  // and stored options are all its own.
  const { params: avatarParams } = buildImageGenParams({
    profile: imageProfile,
    prompt,
    overrides: { n: 1, style: 'natural' },
    orientation: 'portrait',
    logContext: { context: 'background-jobs.character-avatar', jobId: job.id },
  });
  const cacheKeys = deriveAvatarCacheKeys({
    provider: imageProfile.provider,
    imageProfileId: imageProfile.id,
    params: avatarParams,
  });

  if (!payload.force) {
    const cached = await lookupCachedAvatar(repos, cacheKeys, payload.characterId);
    if (cached) {
      await bindAvatarToChat(repos, {
        chat,
        character,
        chatId: payload.chatId,
        fileId: cached.id,
      });

      // No Lantern notification: nothing was produced. The avatar still reaches
      // the Salon through the normal realtime path.
      logger.info('[CharacterAvatar] Reused cached avatar for this configuration', {
        context: 'background-jobs.character-avatar',
        jobId: job.id,
        chatId: payload.chatId,
        characterId: payload.characterId,
        fileId: cached.id,
        leafCounts,
      });
      return;
    }
  }

  // 6. Concierge check — classify the prompt for dangerous content when the
  // chat's pre-screen is on (off duty, Locked and Unmoderated chats skip it)
  const chatSettings = await repos.chatSettings.findByUserId(job.userId) ?? undefined;
  const conciergePolicy = resolveConciergeSettings(chatSettings ?? null, chat);
  logger.debug('[CharacterAvatar] Concierge policy resolved', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    conciergeSource: conciergePolicy.source,
    preScreen: conciergePolicy.preScreen.enabled,
    scanImagePrompts: conciergePolicy.preScreen.scanImagePrompts,
  });

  let effectiveImageProfile = imageProfile;
  let effectiveApiKey: string = apiKey.key_value;

  if (conciergePolicy.routeDirect) {
    // An Unmoderated chat goes straight to the uncensored desk: the verdict is
    // already in, so there is no pre-screen to wait on.
    const routeResult = await resolveImageProviderForDangerousContent(
      imageProfile,
      apiKey.key_value,
      conciergePolicy,
      job.userId
    );
    if (routeResult.rerouted) {
      effectiveImageProfile = routeResult.imageProfile;
      effectiveApiKey = routeResult.apiKey;
    }
    logger.info('[CharacterAvatar] Unmoderated chat: routed direct to the uncensored desk', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      rerouted: routeResult.rerouted,
      profile: effectiveImageProfile.name,
    });
  } else if (conciergePolicy.preScreen.enabled && conciergePolicy.preScreen.scanImagePrompts) {
    let cheapLLMSelection: CheapLLMSelection | null = null;
    try {
      const resolved = await resolveCheapLLMSelectionForUser(repos, job.userId, chatSettings);
      cheapLLMSelection = resolved?.selection ?? null;
    } catch (error) {
      logger.warn('[CharacterAvatar] Failed to build cheap LLM selection for danger classification', {
        context: 'background-jobs.character-avatar',
        jobId: job.id,
        error: getErrorMessage(error),
      });
    }

    if (cheapLLMSelection) {
      try {
        const classification = await classifyDangerousContent(
          prompt,
          cheapLLMSelection,
          job.userId,
          conciergePolicy,
          payload.chatId
        );

        if (classification.isDangerous) {
          logger.info('[CharacterAvatar] Avatar prompt classified as dangerous', {
            context: 'background-jobs.character-avatar',
            jobId: job.id,
            score: classification.score,
            categories: classification.categories.map(c => c.category),
            conciergeSource: conciergePolicy.source,
          });

          if (conciergePolicy.failoverAllowed) {
            const routeResult = await resolveImageProviderForDangerousContent(
              imageProfile,
              apiKey.key_value,
              conciergePolicy,
              job.userId
            );

            if (routeResult.rerouted) {
              effectiveImageProfile = routeResult.imageProfile;
              effectiveApiKey = routeResult.apiKey;
              logger.info('[CharacterAvatar] Rerouted to uncensored image provider', {
                context: 'background-jobs.character-avatar',
                jobId: job.id,
                originalProfile: imageProfile.name,
                uncensoredProfile: routeResult.imageProfile.name,
                reason: routeResult.reason,
              });
            } else {
              logger.warn('[CharacterAvatar] No uncensored image provider available, using original', {
                context: 'background-jobs.character-avatar',
                jobId: job.id,
                reason: routeResult.reason,
              });
            }
          }
        }
      } catch (error) {
        // Fail safe — never block avatar generation on classification errors
        logger.error('[CharacterAvatar] Prompt classification failed, continuing normally', {
          context: 'background-jobs.character-avatar',
          jobId: job.id,
          error: getErrorMessage(error),
        });
      }
    }
  }

  // 7. Generate portrait image — through the Concierge's failover chokepoint,
  // which retries a content refusal once on an uncensored understudy.
  //
  // Avatars default to portrait; the shared builder maps that onto each
  // provider's own size / aspect ratio / prompt wording and attaches the
  // profile's LoRAs and residual options — the same params the Salon's
  // `generate_image` gets. The params the cache key was derived from are
  // reused for the requested profile; any other profile (a pre-generation
  // Concierge reroute, or the post-hoc understudy) has a shape mechanism, LoRA
  // support and stored options of its own, so that case rebuilds.
  const attemptPortrait = makeLoggedImageAttempt({
    userId: job.userId,
    logType: 'IMAGE_GENERATION',
    prompt,
    primaryProfileId: effectiveImageProfile.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
    params: {
      overrides: { n: 1, style: 'natural' },
      orientation: 'portrait',
      logContext: { context: 'background-jobs.character-avatar', jobId: job.id },
    },
    prebuilt: { profileId: imageProfile.id, params: avatarParams },
  });

  let failover;
  try {
    failover = await generateImageWithConciergeFailover(
      { profile: effectiveImageProfile, apiKey: effectiveApiKey },
      attemptPortrait,
      {
        userId: job.userId,
        chatId: payload.chatId,
        purpose: 'avatar',
        conciergePolicy,
        chat,
        primaryVia: effectiveImageProfile.id !== imageProfile.id ? 'concierge' : 'primary',
      },
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const trail = getConciergeTrail(error);
    logger.error('[CharacterAvatar] Image generation failed', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      error: errorMessage,
      conciergeTrail: trail?.map(a => ({ profileName: a.profileName, outcome: a.outcome })),
    }, error as Error);
    throw new Error(
      trail && trail.length > 1
        ? `Avatar image generation failed after Concierge reroute: ${errorMessage}`
        : `Avatar image generation failed: ${errorMessage}`,
    );
  }

  const generationResponse = failover.result;
  // Downstream file metadata records the provider that actually produced the image.
  effectiveImageProfile = failover.profile;
  if (failover.rerouted) {
    logger.info('[CharacterAvatar] Concierge uncensored reroute succeeded', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      fallbackProfileId: failover.profile.id,
      fallbackProvider: failover.profile.provider,
      fallbackModel: failover.profile.modelName,
    });
  }

  // 8. Save generated image
  const decoded = await decodeProviderImage(
    generationResponse,
    `avatar_${character.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
  );
  if (!decoded) {
    logger.warn('[CharacterAvatar] No image data returned from provider', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      imageCount: generationResponse.images?.length ?? 0,
    });
    return;
  }

  const fileId = crypto.randomUUID();

  try {
    // Every avatar goes to the character's vault, project context or not.
    //
    // Reading a mount blob is addressed by blob id with no project scoping and
    // no permission check (an instance has one user), so a chat in any project
    // can render a fileId whose bytes live in the vault. That is what lets the
    // configuration cache be shared across projects without hard-linking
    // anything: link groups exist to give write-through on mutable documents,
    // and avatar bytes are never edited in place.
    //
    // The vault is provisioned at character creation and re-asserted by startup
    // backfill; if it is somehow missing we refuse to write rather than leak
    // bytes into the catch-all _general/. The handler runs in the forked job
    // child whose DB connection is readonly and whose writes are buffered (no
    // read-your-writes), so we cannot ensureCharacterVault() inline here — the
    // parent's character-create flow (or the startup backfill) owns that.
    const vault = await getCharacterVaultStore(payload.characterId);
    if (!vault) {
      throw new Error(
        `Character ${payload.characterId} has no linked database-backed vault; cannot persist wardrobe avatar.`,
      );
    }
    const written = await writeCharacterAvatarToVault({
      characterId: payload.characterId,
      kind: 'history',
      filename: decoded.filename,
      content: decoded.buffer,
      contentType: decoded.mimeType,
    });

    // No legacy `folders` row: that table backs the pre-Scriptorium file tree
    // UI and is only meaningful for disk-backed or project-mount-backed writes.
    // Vault writes own their folder structure inside doc_mount_folders, so the
    // avatar path no longer mints a folder row per image at all (cf. bug 114).
    await createGeneratedFileRow(repos, {
      id: fileId,
      userId: job.userId,
      sha256: decoded.sha256,
      originalFilename: decoded.filename,
      stored: written,
      width: decoded.width,
      height: decoded.height,
      linkedTo: [payload.chatId, payload.characterId],
      tags: [payload.characterId],
      generation: {
        prompt,
        // The profile that actually produced the image — the understudy after a reroute.
        model: effectiveImageProfile.modelName,
        revisedPrompt: decoded.revisedPrompt,
      },
      // Bind this configuration's cache key to the new image — last write wins,
      // which is exactly what makes a forced reroll the new canonical portrait
      // for this character in this outfit. Keyed on the requested profile, not
      // the rerouted one.
      generationKey: cacheKeys.key,
    });

    logger.info('[CharacterAvatar] Avatar image saved', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      fileId,
    });
  } catch (error) {
    logger.error('[CharacterAvatar] Failed to save avatar image', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    }, error as Error);
    throw new Error(`Failed to save avatar image: ${getErrorMessage(error)}`);
  }

  // 9. Bind the chat (and the character's per-chat override) to the new avatar
  await bindAvatarToChat(repos, {
    chat,
    character,
    chatId: payload.chatId,
    fileId,
  });

  logger.info('[CharacterAvatar] Avatar generation completed', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
    fileId,
  });

  await postLanternImageNotification({
    chatId: payload.chatId,
    fileId,
    kind: { kind: 'avatar', characterName: character.name },
    prompt,
    routeTrail: failover.trail,
  });
}
