/**
 * Wardrobe Avatar Preview API v1
 *
 * POST /api/v1/wardrobe/preview-avatar
 *
 * Generates a one-off character avatar against an arbitrary equipped-slot
 * snapshot the dialog is showing. The result is saved as a regular generated
 * image (so the user can download it from the dialog), but is NOT persisted
 * onto the character's `avatarOverrides` or any chat's `characterAvatars`.
 * Out-of-chat avatars never overwrite the canonical character avatar.
 *
 * It is drawn the way the chat avatar job draws one: the same profile choice
 * (`resolveAvatarImageProfile`), the same prompt, the same portrait shape from
 * the shared params builder, the same logged attempt, and the Concierge's
 * image failover — a refusal is retried once on an uncensored understudy
 * while the Concierge is on duty. There is no chat, so nothing is announced
 * and no ledger is kept; the trail comes back in the response instead. The
 * dangerous-content pre-screen is still skipped: the operator chose the model
 * and the outfit by hand.
 *
 * Body: { characterId, equippedSlots, imageProfileId? }
 *
 * Response: { fileId, url, mimeType, prompt, rerouted, trail }
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { badRequest, errorResponse, serverError } from '@/lib/api/responses';
import { buildCharacterAvatarPrompt } from '@/lib/image-gen/avatar-prompt';
import { resolveAesthetic } from '@/lib/image-gen/aesthetic';
import { resolveAvatarImageProfile } from '@/lib/image-gen/profile-resolution';
import { decodeProviderImage, makeLoggedImageAttempt } from '@/lib/image-gen/image-attempt';
import { createGeneratedFileRow } from '@/lib/files/generated-file-row';
import { trackActivity } from '@/lib/background-jobs/activity-registry';
import {
  getCharacterVaultStore,
  writeCharacterAvatarToVault,
} from '@/lib/file-storage/character-vault-bridge';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import {
  generateImageWithConciergeFailover,
  getConciergeTrail,
} from '@/lib/services/dangerous-content/image-failover';
import type { ImageProfile } from '@/lib/schemas/types';
import { EquippedSlotsSchema } from '@/lib/schemas/wardrobe.types';

const LOG_CONTEXT = 'api.v1.wardrobe.preview-avatar';

const previewAvatarSchema = z.object({
  characterId: z.string().min(1, 'characterId is required'),
  equippedSlots: EquippedSlotsSchema,
  imageProfileId: z.string().min(1).optional(),
});

const handlePreviewAvatar = async (req: NextRequest, { user, repos }: RequestContext) => {
  let parsed: z.infer<typeof previewAvatarSchema>;
  try {
    parsed = previewAvatarSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest(err.issues.map((e) => e.message).join(', '));
    }
    throw err;
  }

  const { characterId, equippedSlots, imageProfileId } = parsed;

  const character = await repos.characters.findById(characterId);
  if (!character || character.userId !== user.id) {
    return badRequest('Character not found');
  }

  // The one-shot pick, else the user's default — each checked for an API key.
  const imageProfile = (await resolveAvatarImageProfile(user.id, repos, {
    override: imageProfileId ?? null,
  })) as ImageProfile | null;
  if (!imageProfile?.apiKeyId) {
    return badRequest('No image profile is configured. Set one in Settings → Images before generating avatars.');
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(imageProfile.apiKeyId, user.id);
  if (!apiKey?.key_value) {
    return badRequest('API key for image profile is missing or invalid');
  }

  // Aurora character aesthetic (global tier — a preview has no project context).
  const characterAesthetic = await resolveAesthetic({ kind: 'aurora' });

  const { prompt, hasAppearance, leafCounts } = await buildCharacterAvatarPrompt(
    repos,
    character,
    { equippedSlots, characterAesthetic },
  );

  if (!hasAppearance) {
    return badRequest(
      'No appearance data available — add a physical description or equip wardrobe items first',
    );
  }

  logger.debug('[Avatar Preview] Generating preview', {
    context: LOG_CONTEXT,
    characterId,
    profileId: imageProfile.id,
    profileOverride: !!imageProfileId,
    leafCounts,
  });

  // No chat: the global Concierge policy decides whether a refusal may fail
  // over; there is no Locked state to honour and nothing to announce.
  const chatSettings = await repos.chatSettings.findByUserId(user.id);
  const conciergePolicy = resolveConciergeSettings(chatSettings ?? null, null);

  // Portrait through the shared builder, so the preview shows what the profile
  // actually produces — LoRAs, residual options and all — mapped onto the
  // provider's own shape mechanism, exactly as the chat avatar job asks.
  const attempt = makeLoggedImageAttempt({
    userId: user.id,
    logType: 'IMAGE_GENERATION',
    prompt,
    primaryProfileId: imageProfile.id,
    characterId,
    params: {
      overrides: { n: 1, style: 'natural' },
      orientation: 'portrait',
      logContext: { context: LOG_CONTEXT, characterId },
    },
  });

  let failover;
  try {
    failover = await generateImageWithConciergeFailover(
      { profile: imageProfile, apiKey: apiKey.key_value },
      attempt,
      { userId: user.id, chatId: null, purpose: 'avatar', conciergePolicy },
    );
  } catch (error) {
    const trail = getConciergeTrail(error);
    const refused = !!trail && trail.some((row) => row.outcome === 'refused');
    logger.warn('[Avatar Preview] Image generation failed', {
      context: LOG_CONTEXT,
      characterId,
      error: getErrorMessage(error),
      refused,
      conciergeTrail: trail?.map((row) => ({ profileName: row.profileName, outcome: row.outcome })),
    });
    return errorResponse(
      refused
        ? 'The image provider declined to draw this portrait'
        : `Image generation failed: ${getErrorMessage(error)}`,
      // 422 is a content refusal; anything else is the provider failing.
      refused ? 422 : 502,
      { trail, refused },
    );
  }

  const decoded = await decodeProviderImage(
    failover.result,
    `avatar_preview_${character.name.replace(/[^a-zA-Z0-9]/g, '_')}`,
  );
  if (!decoded) {
    return serverError('Image provider returned no image data');
  }

  try {
    // Previews are character-scoped and never tied to a chat. The character's
    // vault is provisioned at character creation and re-asserted by startup
    // backfill, so getCharacterVaultStore should never return null in practice.
    // Refuse to write rather than leaking bytes into the catch-all _general/.
    const vault = await getCharacterVaultStore(characterId);
    if (!vault) {
      throw new Error(
        `Character ${characterId} has no linked database-backed vault; cannot persist avatar preview.`,
      );
    }
    const written = await writeCharacterAvatarToVault({
      characterId,
      kind: 'history',
      filename: decoded.filename,
      content: decoded.buffer,
      contentType: decoded.mimeType,
    });

    // Linked to the character so it surfaces in the character's gallery, but
    // NOT to a chat — the caller may have no chat context, and even when they
    // do, this preview is intentionally not bound to it. No `description`
    // label (bug 132): the prompt is the account of record.
    const file = await createGeneratedFileRow(repos, {
      userId: user.id,
      sha256: decoded.sha256,
      originalFilename: decoded.filename,
      stored: written,
      width: decoded.width,
      height: decoded.height,
      linkedTo: [characterId],
      tags: [characterId],
      generation: {
        prompt,
        model: failover.profile.modelName,
        revisedPrompt: decoded.revisedPrompt,
      },
    });

    logger.info('[Avatar Preview] Preview saved', {
      context: LOG_CONTEXT,
      characterId,
      fileId: file.id,
      profileId: failover.profile.id,
      rerouted: failover.rerouted,
    });

    return NextResponse.json({
      fileId: file.id,
      url: `/api/v1/files/${file.id}?action=download`,
      mimeType: written.storedMimeType,
      prompt,
      rerouted: failover.rerouted,
      trail: failover.trail.length > 0 ? failover.trail : null,
    });
  } catch (error) {
    logger.error(
      '[Avatar Preview] Failed to save preview image',
      { context: LOG_CONTEXT, characterId },
      error instanceof Error ? error : undefined,
    );
    return serverError('Failed to save avatar preview');
  }
};

/**
 * Avatar previews generate synchronously rather than through the job queue, so
 * the route registers with the activity registry — the toolbar's "Img" chip
 * stays lit for the whole preview, prompt build and provider wait included.
 */
export const POST = createContextHandler((req, ctx) =>
  trackActivity('image', () => handlePreviewAvatar(req, ctx))
);
