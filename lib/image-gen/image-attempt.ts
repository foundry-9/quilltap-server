/**
 * One image-provider call, logged — and what comes back, decoded.
 *
 * Every path that draws a picture (the avatar job, the Lantern's story
 * background, a wardrobe item's picture, the `generate_image` tool, the
 * avatar preview) hands `generateImageWithConciergeFailover` an `attempt`
 * closure that does the same four things against whichever profile the
 * chokepoint asks: create the provider, build that profile's params through
 * `buildImageGenParams`, call it, and write one `llm_logs` row whether it
 * answered or threw. {@link makeLoggedImageAttempt} is that closure, once.
 *
 * {@link decodeProviderImage} is the tail every one of them then ran: take
 * `images[n]`, decode its base64, transcode to WebP (measuring the real
 * dimensions — providers often return a different shape than was asked) and
 * hash the stored bytes.
 *
 * **The log type is decided here.** A picture's row is `IMAGE_GENERATION`
 * unless it is a wardrobe item's picture, which keeps its own
 * `WARDROBE_ITEM_IMAGE` so the LLM Inspector can tell the two apart. Both are
 * image spend: `IMAGE_SPEND_LOG_TYPES` (`lib/schemas/llm-log.types.ts`) is the list the Almanack's
 * per-image-profile roll-up filters on (bug 196 — wardrobe pictures used to
 * vanish from it). A new image log type joins that tuple, and with it the
 * spend, or it cannot be passed here at all.
 *
 * @module image-gen/image-attempt
 */

import { createImageProvider } from '@/lib/llm/plugin-factory';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { convertToWebP } from '@/lib/files/webp-conversion';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import { getErrorMessage } from '@/lib/error-utils';
import { logger } from '@/lib/logger';
import type { ImageSpendLogType } from '@/lib/schemas/llm-log.types';
import type { ImageProfile } from '@/lib/schemas/types';
import type { ImageGenParams, ImageGenResponse } from '@quilltap/plugin-types';
import { buildImageGenParams, type BuildImageGenParamsOptions } from './params-builder';

const LOG_CONTEXT = 'image-gen.image-attempt';

/** The log types an image attempt may write — the image-spend types. */
export type ImageAttemptLogType = ImageSpendLogType;

/** The closure `generateImageWithConciergeFailover` calls once per profile it tries. */
export type ImageAttempt = (profile: ImageProfile, apiKey: string) => Promise<ImageGenResponse>;

export interface LoggedImageAttemptOptions {
  userId: string;
  /** `'IMAGE_GENERATION'`, or `'WARDROBE_ITEM_IMAGE'` for a wardrobe item's picture. */
  logType: ImageAttemptLogType;
  /** The final prompt — what the provider is sent and what the log records. */
  prompt: string;
  /**
   * The profile first asked for. Any other profile the chokepoint tries is a
   * Concierge reroute, and its log line and `logContext` say so.
   */
  primaryProfileId: string;
  chatId?: string | null;
  characterId?: string | null;
  /** The per-call shape: overrides, orientation, fallback model, log context. */
  params?: Omit<BuildImageGenParamsOptions, 'profile' | 'prompt'>;
  /**
   * Params already built for one profile — the avatar job derives its cache
   * key from them — reused verbatim when that profile is the one asked. Every
   * other profile builds its own: its shape mechanism, LoRAs and stored
   * options are its own.
   */
  prebuilt?: { profileId: string; params: ImageGenParams };
}

/**
 * Build the attempt closure for one picture. Logging never fails the call:
 * `logLLMCall` swallows its own errors, and a throw from it is caught here.
 */
export function makeLoggedImageAttempt(options: LoggedImageAttemptOptions): ImageAttempt {
  const { userId, logType, prompt, primaryProfileId } = options;

  const record = async (
    profile: ImageProfile,
    startedAt: number,
    response: { content: string; error?: string },
  ): Promise<void> => {
    try {
      await logLLMCall({
        userId,
        type: logType,
        chatId: options.chatId ?? undefined,
        characterId: options.characterId ?? undefined,
        provider: profile.provider,
        modelName: profile.modelName,
        imageProfileId: profile.id,
        request: { messages: [{ role: 'user', content: prompt }] },
        response,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.warn('[ImageAttempt] Failed to record the image call in llm_logs', {
        context: LOG_CONTEXT,
        logType,
        profileId: profile.id,
        error: getErrorMessage(error),
      });
    }
  };

  return async (profile, apiKey) => {
    const rerouted = profile.id !== primaryProfileId;
    const provider = createImageProvider(profile.provider);
    const params = options.prebuilt && options.prebuilt.profileId === profile.id
      ? options.prebuilt.params
      : buildImageGenParams({
          ...options.params,
          profile,
          prompt,
          logContext: { ...options.params?.logContext, profileId: profile.id, rerouted },
        }).params;

    logger.debug('[ImageAttempt] Calling image provider', {
      context: LOG_CONTEXT,
      logType,
      profileId: profile.id,
      provider: profile.provider,
      model: profile.modelName,
      rerouted,
      reusedPrebuiltParams: params === options.prebuilt?.params,
    });

    const startedAt = Date.now();
    try {
      const response = await provider.generateImage(params, apiKey);
      await record(profile, startedAt, {
        content: response.images?.[0]?.revisedPrompt
          || `Generated ${response.images?.length ?? 0} image(s)${rerouted ? ' (Concierge reroute)' : ''}`,
      });
      return response;
    } catch (error) {
      await record(profile, startedAt, { content: '', error: getErrorMessage(error) });
      throw error;
    }
  };
}

/** A provider's picture, ready to store. */
export interface DecodedProviderImage {
  /** The stored bytes: WebP when the provider's format converts, else as sent. */
  buffer: Buffer;
  mimeType: string;
  /** `<stem>_<epoch ms>.<ext>`, extension following the stored format. */
  filename: string;
  /** Measured from the stored bytes; null when unmeasurable (SVG, a decode failure). */
  width: number | null;
  height: number | null;
  sha256: string;
  revisedPrompt: string | null;
}

/**
 * Decode `response.images[index]` into storable bytes. Returns null when the
 * provider sent no such image, or one with no inline data (a URL-only answer
 * is the provider plugin's to download, never the caller's).
 */
export async function decodeProviderImage(
  response: Pick<ImageGenResponse, 'images'> | null | undefined,
  filenameStem: string,
  index = 0,
): Promise<DecodedProviderImage | null> {
  const image = response?.images?.[index];
  const raw = image?.data || image?.b64Json;
  if (!image || !raw) {
    logger.debug('[ImageAttempt] Provider response carried no image data', {
      context: LOG_CONTEXT,
      index,
      imageCount: response?.images?.length ?? 0,
      hasUrl: !!image?.url,
    });
    return null;
  }

  const providerMimeType = image.mimeType || 'image/png';
  const providerExt = providerMimeType.split('/')[1] || 'png';
  const converted = await convertToWebP(
    Buffer.from(raw, 'base64'),
    providerMimeType,
    `${filenameStem}_${Date.now()}.${providerExt}`,
  );

  const decoded: DecodedProviderImage = {
    buffer: converted.buffer,
    mimeType: converted.mimeType,
    filename: converted.filename,
    width: converted.width ?? null,
    height: converted.height ?? null,
    sha256: sha256OfBuffer(converted.buffer),
    revisedPrompt: image.revisedPrompt || null,
  };

  logger.debug('[ImageAttempt] Decoded provider image', {
    context: LOG_CONTEXT,
    index,
    providerMimeType,
    storedMimeType: decoded.mimeType,
    bytes: decoded.buffer.length,
    width: decoded.width,
    height: decoded.height,
  });

  return decoded;
}
