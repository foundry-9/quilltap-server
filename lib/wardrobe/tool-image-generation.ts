/**
 * Pictures commissioned by the wardrobe tools.
 *
 * `wardrobe_create` and `wardrobe_update` take an optional `generate_image`
 * flag. Whether anything is drawn is the operator's call, not the model's:
 * `chatSettings.wardrobeImageSettings.generateFromTools` (Settings → Images →
 * Wardrobe Images, off by default) is both the gate and the default. With it
 * off, a model that asks is told so and nothing is spent; with it on, the
 * tool's own default applies unless the model says otherwise.
 *
 * The picture is a background job (`WARDROBE_ITEM_IMAGE_GENERATION`), never
 * an inline wait: a provider call takes twenty-odd seconds and the turn must
 * not stand still for it.
 *
 * @module lib/wardrobe/tool-image-generation
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { enqueueWardrobeItemImageGeneration } from '@/lib/background-jobs/queue-service';
import { resolveWardrobeImageProfile } from '@/lib/image-gen/profile-resolution';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ChatSettings } from '@/lib/schemas/settings.types';

const LOG_CONTEXT = 'wardrobe.tool-image-generation';

/** What became of a picture a wardrobe tool asked for. */
export interface WardrobeToolImageResult {
  status: 'queued' | 'not-enabled' | 'no-image-profile' | 'failed';
  /** One plain sentence for the model. */
  message: string;
}

/** The operator's switch, read the one way. Absent settings read as off. */
export function wardrobeToolImagesEnabled(
  settings: Pick<ChatSettings, 'wardrobeImageSettings'> | null | undefined,
): boolean {
  return settings?.wardrobeImageSettings?.generateFromTools === true;
}

export interface QueueWardrobeToolImageArgs {
  userId: string;
  chatId: string;
  /** The character whose wardrobe holds the item. */
  characterId: string;
  itemId: string;
  /** The tool's `generate_image` input; undefined = the tool's default. */
  requested: boolean | undefined;
  /** What the tool does when the operator's switch is on and the model said nothing. */
  defaultWhenEnabled: boolean;
  /** The call site, for logs. */
  callerContext: string;
}

/**
 * Queue a picture of `itemId` if the operator allows it and the call wants
 * one. Returns undefined when no picture was wanted (nothing to report), and
 * never throws — a picture is never worth failing the garment over.
 */
export async function maybeQueueWardrobeToolImage(
  repos: Pick<RepositoryContainer, 'chatSettings' | 'imageProfiles'>,
  args: QueueWardrobeToolImageArgs,
): Promise<WardrobeToolImageResult | undefined> {
  const { userId, chatId, characterId, itemId, requested, defaultWhenEnabled, callerContext } = args;

  try {
    const settings = await repos.chatSettings.findByUserId(userId);
    const enabled = wardrobeToolImagesEnabled(settings);
    const wanted = requested ?? (enabled && defaultWhenEnabled);

    logger.debug('[WardrobeToolImage] Deciding on a tool-queued picture', {
      context: LOG_CONTEXT,
      callerContext,
      itemId,
      enabled,
      requested,
      defaultWhenEnabled,
      wanted,
    });

    if (!wanted) return undefined;

    if (!enabled) {
      return {
        status: 'not-enabled',
        message:
          'No picture was made: the operator has not allowed the wardrobe tools to generate pictures ' +
          '(Settings → Images → Wardrobe Images).',
      };
    }

    const profile = await resolveWardrobeImageProfile(userId, repos);
    if (!profile) {
      return {
        status: 'no-image-profile',
        message: 'No picture was made: no usable image profile is configured.',
      };
    }

    const { jobId, isNew } = await enqueueWardrobeItemImageGeneration(userId, {
      chatId,
      characterId,
      itemId,
    });

    logger.info('[WardrobeToolImage] Queued a picture for a wardrobe item', {
      context: LOG_CONTEXT,
      callerContext,
      chatId,
      characterId,
      itemId,
      jobId,
      isNew,
      profileId: profile.id,
    });

    return {
      status: 'queued',
      message:
        'A picture of this item is being drawn in the background. Once it is ready, wardrobe_read and ' +
        'wardrobe_list show its image_file_id.',
    };
  } catch (error) {
    logger.error('[WardrobeToolImage] Could not queue a picture for a wardrobe item', {
      context: LOG_CONTEXT,
      callerContext,
      itemId,
      error: getErrorMessage(error),
    }, error instanceof Error ? error : undefined);
    return { status: 'failed', message: 'No picture was made: queueing the picture failed.' };
  }
}

/** The one line a tool's formatted result carries about its picture. */
export function formatWardrobeToolImageLine(result: WardrobeToolImageResult | undefined): string | null {
  return result ? `- Picture: ${result.message}` : null;
}

/**
 * How an item's current picture is announced to a model: its file id and the
 * tool that looks at it. `describe_image` resolves an image-v2 file uuid, which
 * is what `imageFileId` is; `keep_image` files it into the character's album.
 */
export function formatWardrobeImageHandle(imageFileId: string): string {
  return `${imageFileId} (pass to describe_image to see it, or keep_image to file it in your album)`;
}
