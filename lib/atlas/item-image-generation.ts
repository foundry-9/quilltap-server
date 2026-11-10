/**
 * Generate a picture of an Atlas entry — synchronously, in the calling API
 * route, through the Concierge's image failover chokepoint, as the
 * Inventory's object pictures are (`lib/inventory/item-image-generation.ts`).
 *
 * The subject is the entry's graphic prompt, else its name. The editor has no
 * chat, so there is no Locked state, no announcement and no ledger; the trail
 * is returned for the editor. Log rows are `ATLAS_ENTRY_IMAGE`, counted as
 * image spend.
 *
 * @module lib/atlas/item-image-generation
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { resolveAesthetic, getProjectOfficialMountPointId } from '@/lib/image-gen/aesthetic';
import { withArtDirection } from '@/lib/image-gen/avatar-prompt';
import { resolveWardrobeImageProfile } from '@/lib/image-gen/profile-resolution';
import { decodeProviderImage, makeLoggedImageAttempt } from '@/lib/image-gen/image-attempt';
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service';
import { generateImageWithConciergeFailover, getConciergeTrail } from '@/lib/services/dangerous-content/image-failover';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { RouteAttempt } from '@/lib/schemas/chat.types';
import type { ImageProfile } from '@/lib/schemas/types';
import type { AtlasRecord } from '@/lib/schemas/atlas.types';
import { addAtlasEntryImage, type AtlasEntryHome } from '@/lib/atlas/item-images';

const LOG_CONTEXT = 'atlas.item-image-generation';

/** No usable profile (a 400). */
export class NoAtlasImageProfileError extends Error {
  constructor() {
    super('No image profile is configured. Set one in Settings → Images before generating pictures of Atlas entries.');
    this.name = 'NoAtlasImageProfileError';
  }
}

/** The provider refused or failed; carries the trail. */
export class AtlasImageGenerationError extends Error {
  constructor(message: string, readonly trail: RouteAttempt[] | null, readonly refused: boolean) {
    super(message);
    this.name = 'AtlasImageGenerationError';
  }
}

/** What the picture shows: the graphic prompt, else the name. Pure. */
export function atlasImageSubject(entry: Pick<AtlasRecord, 'graphicPrompt' | 'name'>): string {
  return (entry.graphicPrompt?.trim() || entry.name.trim()).replace(/[.!?]+$/, '');
}

/** The entry picture prompt: the thing itself, whole, no person. Pure. */
export function buildAtlasEntryImagePrompt(entry: Pick<AtlasRecord, 'graphicPrompt' | 'name'>): string {
  return `A clear, faithful depiction of ${atlasImageSubject(entry)}. The thing is the subject, shown whole and unobstructed, with no person in the foreground.`;
}

export interface AtlasEntryImageGenerationResult {
  fileId: string;
  prompt: string;
  profile: { id: string; name: string };
  rerouted: boolean;
  trail: RouteAttempt[] | null;
}

/** Generate, store and make current a picture of `home.record`. */
export async function generateAtlasEntryImage(
  repos: RepositoryContainer,
  args: { userId: string; home: AtlasEntryHome; imageProfileId?: string | null },
): Promise<AtlasEntryImageGenerationResult> {
  const { userId, home } = args;
  await home.location.writableMountPointId();

  const profile = (await resolveWardrobeImageProfile(userId, repos, args.imageProfileId)) as ImageProfile | null;
  if (!profile || !profile.apiKeyId) throw new NoAtlasImageProfileError();
  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId);
  if (!apiKey?.key_value) throw new NoAtlasImageProfileError();

  const projectMount = home.location.scope === 'project' ? await getProjectOfficialMountPointId(home.location.id) : null;
  const prompt = withArtDirection(
    buildAtlasEntryImagePrompt(home.record),
    await resolveAesthetic({ kind: 'lantern', projectOfficialMountPointId: projectMount ?? undefined }),
  );
  logger.debug('[AtlasEntryImage] Generating atlas entry picture', {
    context: LOG_CONTEXT,
    entryId: home.record.id,
    scope: home.location.scope,
    profileId: profile.id,
  });

  const conciergePolicy = resolveConciergeSettings((await repos.chatSettings.findByUserId(userId)) ?? null, null);
  const attempt = makeLoggedImageAttempt({
    userId,
    logType: 'ATLAS_ENTRY_IMAGE',
    prompt,
    primaryProfileId: profile.id,
    chatId: null,
    characterId: home.location.characterId,
    params: {
      overrides: { n: 1, style: 'natural' },
      orientation: 'square',
      logContext: { context: LOG_CONTEXT, entryId: home.record.id },
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
    logger.warn('[AtlasEntryImage] Atlas entry picture generation failed', {
      context: LOG_CONTEXT,
      entryId: home.record.id,
      error: getErrorMessage(error),
      refused,
    });
    throw new AtlasImageGenerationError(getErrorMessage(error), trail, refused);
  }

  const decoded = await decodeProviderImage(failover.result, 'atlas');
  if (!decoded) {
    throw new AtlasImageGenerationError('The image provider returned no picture', failover.trail.length ? failover.trail : null, false);
  }
  const { file } = await addAtlasEntryImage(repos, home, {
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
  logger.info('[AtlasEntryImage] Atlas entry picture generated', {
    context: LOG_CONTEXT,
    entryId: home.record.id,
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
