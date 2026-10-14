/**
 * What an image costs on the wire to an LLM.
 *
 * Storage and transport are different questions, and conflating them is what
 * bug 151 was. The bytes on disk are the *archive*: a `gpt-image-2.5` portrait
 * lands at 1024x1536 and ~1.7 MB of quality-90 WebP, and that is what the
 * gallery, the album and every export should keep. What a vision model needs
 * to read the same picture is far less — it downsamples on arrival anyway —
 * and every byte above that is paid twice, once on the wire and once in the
 * provider's request-size limit.
 *
 * So nothing here touches a stored file. `shrinkImageForLlmTransport` is
 * applied at the two points where bytes are loaded *for a model*
 * (`lib/chat-files-v2.ts`), and its output is thrown away after the request.
 *
 * Two budgets, and both are needed:
 *
 *  - **Per image** (`LLM_TRANSPORT_MAX_EDGE`, `LLM_TRANSPORT_TARGET_BASE64`).
 *    A long-edge cap plus a quality ladder down to a byte ceiling.
 *  - **Per turn** (`LANTERN_IMAGE_BASE64_BUDGET`, spent by the Lantern walk in
 *    `lib/services/chat-message/context-builder.service.ts`). The per-image
 *    cap cannot see how many images a turn carries, which is precisely how
 *    bug 151 happened: two avatars, each comfortably under the provider's
 *    4 MB per-image limit, summed to 4.52 MB of base64 and NanoGPT answered
 *    the turn with `413 Request Entity Too Large`.
 *
 * The provider's own per-image limit still applies on top — this module
 * lowers the ceiling, it never raises it.
 *
 * @module lib/files/llm-image-budget
 */

import sharp from 'sharp'
import { logger } from '@/lib/logger'
import { calculateBase64Size, canResizeImage, getProviderMaxBase64Size } from './image-processing'

/**
 * Longest edge, in pixels, of an image sent to an LLM.
 *
 * 1024 is the figure the major vision stacks converge on for a single-tile
 * read, and it is the size the operator asked for: a 1536x1024 story
 * background becomes 1024x683, a 1024x1536 portrait becomes 683x1024. Neither
 * loses anything a model was going to use.
 */
export const LLM_TRANSPORT_MAX_EDGE = 1024

/**
 * Byte ceiling for one image's base64 payload — the operator's "under 500K,
 * and still carries enough information to be useful".
 *
 * Reached by stepping down `LLM_TRANSPORT_QUALITY_LADDER` after the resize,
 * not by refusing the image. An image that cannot make the ceiling even at
 * the bottom of the ladder is still sent, at the smallest encoding we got.
 */
export const LLM_TRANSPORT_TARGET_BASE64 = 500 * 1024

/**
 * WebP qualities tried in order until the encoding fits
 * `LLM_TRANSPORT_TARGET_BASE64`.
 *
 * Starts well below storage's quality 90 — at 1024px a model is reading shape,
 * colour and text, none of which survive differently at 78 than at 90 — and
 * stops at 45, below which artefacts start costing the model information
 * rather than saving it bytes.
 */
export const LLM_TRANSPORT_QUALITY_LADDER = [78, 65, 55, 45] as const

/**
 * Ceiling on the *total* base64 an unseen-image walk may add to one turn.
 *
 * ~2 MB is four images at the per-image ceiling, which is more pictures than
 * a turn has ever usefully carried, and leaves a wide margin under the
 * narrowest provider body limit we have met (NanoGPT's, which bug 151 found
 * somewhere under 4.5 MB). Spent newest-first: see the consumer's note.
 */
export const LANTERN_IMAGE_BASE64_BUDGET = 2 * 1024 * 1024

/** Outcome of a transport shrink. `wasShrunk` is false when nothing was done. */
export interface LlmImageShrinkResult {
  buffer: Buffer
  mimeType: string
  wasShrunk: boolean
  originalSize: number
  finalSize: number
  width?: number
  height?: number
}

/**
 * Reduce an image to what a model actually needs to read it.
 *
 * Caps the long edge at {@link LLM_TRANSPORT_MAX_EDGE} (never enlarging), then
 * re-encodes as WebP, stepping down {@link LLM_TRANSPORT_QUALITY_LADDER} until
 * the base64 payload fits the smaller of {@link LLM_TRANSPORT_TARGET_BASE64}
 * and the provider's own per-image limit.
 *
 * Never throws and never refuses: a format sharp cannot resize, an unreadable
 * buffer or an encode failure all return the input unchanged, because a turn
 * that sends the original bytes is strictly better than a turn that sends
 * none. Callers get `wasShrunk: false` and carry on.
 *
 * @param provider used only to read the provider's per-image ceiling; omit to
 *   apply this module's budget alone.
 */
export async function shrinkImageForLlmTransport(args: {
  buffer: Buffer
  mimeType: string
  provider?: string
  /** For logging only. */
  filename?: string
}): Promise<LlmImageShrinkResult> {
  const { buffer, mimeType, provider, filename } = args
  const originalSize = buffer.length
  const unchanged: LlmImageShrinkResult = {
    buffer,
    mimeType,
    wasShrunk: false,
    originalSize,
    finalSize: originalSize,
  }

  if (!mimeType.startsWith('image/') || !canResizeImage(mimeType)) return unchanged

  // The provider's limit is a ceiling we may lower but must not exceed.
  const ceiling = provider
    ? Math.min(LLM_TRANSPORT_TARGET_BASE64, getProviderMaxBase64Size(provider))
    : LLM_TRANSPORT_TARGET_BASE64

  try {
    const metadata = await sharp(buffer).metadata()
    const longestEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0)

    // Already small in both dimensions and already under the ceiling: sending
    // the stored bytes costs less than a pointless re-encode.
    if (longestEdge > 0 && longestEdge <= LLM_TRANSPORT_MAX_EDGE && calculateBase64Size(buffer) <= ceiling) {
      return unchanged
    }

    let best: Buffer | null = null
    for (const quality of LLM_TRANSPORT_QUALITY_LADDER) {
      const encoded = await sharp(buffer)
        .resize({
          width: LLM_TRANSPORT_MAX_EDGE,
          height: LLM_TRANSPORT_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer()
      best = encoded
      if (calculateBase64Size(encoded) <= ceiling) break
    }

    if (!best) return unchanged

    // A re-encode that grew the payload is a re-encode worth discarding — a
    // small PNG of flat colour can beat WebP at these qualities.
    if (best.length >= originalSize && longestEdge <= LLM_TRANSPORT_MAX_EDGE) return unchanged

    const finalMeta = await sharp(best).metadata()
    logger.debug('Image shrunk for LLM transport', {
      module: 'files:llm-image-budget',
      filename,
      provider,
      originalSize,
      finalSize: best.length,
      originalDimensions: `${metadata.width}x${metadata.height}`,
      finalDimensions: `${finalMeta.width}x${finalMeta.height}`,
      ceiling,
    })

    return {
      buffer: best,
      mimeType: 'image/webp',
      wasShrunk: true,
      originalSize,
      finalSize: best.length,
      width: finalMeta.width,
      height: finalMeta.height,
    }
  } catch (error) {
    logger.warn('Could not shrink image for LLM transport; sending stored bytes', {
      module: 'files:llm-image-budget',
      filename,
      provider,
      mimeType,
      error: error instanceof Error ? error.message : String(error),
    })
    return unchanged
  }
}
