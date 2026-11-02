/**
 * Re-deciding the attachment question after the model changes underneath a
 * message array.
 *
 * A formatted message array is built once, against one connection profile.
 * `processFileAttachmentFallback` runs at that moment and answers, for that
 * profile: send the raw bytes, or replace them with a description? Whichever
 * it answers is baked into the array — raw `attachments` on the anchor
 * message, or description text prepended to its content.
 *
 * Every mid-turn model swap inherits that array. The uncensored reroute is the
 * one that bit us: a vision profile's array, bytes and all, handed to a
 * text-only substitute, which the gateway refuses with a 400 before the
 * remedy has a chance to run (bug 106). The failure is structural rather than
 * unlucky — the answer in the array was computed for a model that is no longer
 * the one being called.
 *
 * `adaptMessagesForProfile` asks the question again, for the profile actually
 * about to be called. An image a text-only stand-in cannot read becomes its
 * description, exactly as it would have if that profile had been the primary,
 * and the retry proceeds instead of dying at the gateway. A profile that *can*
 * take the bytes gets the array back untouched — same reference, no copy, no
 * describer spent.
 *
 * It is also where a profile's per-request image cap
 * (`resolveMaxImagesPerRequest`) is enforced. Some vision models refuse a
 * request carrying more than four images outright; images past the cap are
 * described in text instead of sent. The newest messages' images are kept
 * first, and within a message the attachments that come first.
 *
 * @module chat/message-attachment-adapter
 */

import {
  needsFallbackProcessing,
  processFileAttachmentFallback,
  generateImageDescription,
  formatFallbackAsMessagePrefix,
  type ImageDescriptionOptions,
} from '@/lib/chat/file-attachment-fallback'
import { resolveMaxImagesPerRequest } from '@/lib/llm/connection-profile-utils'
import { profileCanReceiveAttachment } from '@/lib/llm/image-transport'
import { getErrorMessage } from '@/lib/error-utils'
import { logger } from '@/lib/logger'

import type { ConnectionProfile } from '@/lib/schemas/types'

/**
 * The subset of a formatted message this module reads. Deliberately loose:
 * callers hold richer shapes (thought signatures, tool calls, names) and every
 * extra field is carried through untouched.
 */
export interface AttachmentBearingMessage {
  role: string
  content: string
  attachments?: unknown[]
}

/** One attachment as `loadChatFilesForLLM` produces it. */
interface LoadedAttachment {
  id: string
  filepath?: string
  filename: string
  mimeType: string
  size: number
  data?: string
}

function isLoadedAttachment(value: unknown): value is LoadedAttachment {
  if (!value || typeof value !== 'object') return false
  const a = value as Partial<LoadedAttachment>
  return typeof a.id === 'string' && typeof a.mimeType === 'string'
}

/**
 * Every MIME type riding in a message array's `attachments`, de-duplicated.
 *
 * The routing question — "which substitute should we even offer?" — is asked
 * before a profile is in hand, so it needs the payload's shape rather than a
 * per-profile verdict. Feed this to `resolveProviderForDangerousContent`.
 */
export function collectAttachmentMimeTypes(
  messages: readonly AttachmentBearingMessage[]
): string[] {
  const seen = new Set<string>()
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (isLoadedAttachment(attachment)) seen.add(attachment.mimeType)
    }
  }
  return Array.from(seen)
}

function isImageAttachment(value: unknown): value is LoadedAttachment {
  return isLoadedAttachment(value) && value.mimeType.startsWith('image/')
}

/**
 * The images in a message array that `profile` would be sent raw but that
 * fall past its per-request cap. Walked newest message first, and within a
 * message in array order, so the cap spends itself on the most recent turn.
 * Identity-keyed: the caller tests the very attachment objects it walks.
 */
export function findImagesOverCap(
  messages: readonly AttachmentBearingMessage[],
  profile: ConnectionProfile
): Set<unknown> {
  const cap = resolveMaxImagesPerRequest(profile)
  const overCap = new Set<unknown>()
  let kept = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const attachment of messages[i].attachments ?? []) {
      if (!isImageAttachment(attachment)) continue
      if (!profileCanReceiveAttachment(profile, attachment.mimeType)) continue
      if (kept < cap) {
        kept++
      } else {
        overCap.add(attachment)
      }
    }
  }
  return overCap
}

/**
 * Re-run the attachment decision for `profile` and return an array it can
 * actually accept.
 *
 * Returns the **same array reference** when nothing needs changing, which is
 * the overwhelmingly common case: no attachments at all, or a substitute that
 * reads the same things the original did. Only a genuine mismatch costs a
 * describer call.
 *
 * Never throws. A describer that fails leaves the bytes dropped and a
 * `⚠️ Attachment Processing Failed` note in their place — a degraded turn the
 * model can still answer, which is strictly better than the 400 that dropping
 * this step guarantees.
 */
export async function adaptMessagesForProfile<T extends AttachmentBearingMessage>(
  messages: T[],
  profile: ConnectionProfile,
  repos: unknown,
  userId: string,
  logContext: Record<string, unknown> = {},
  options: ImageDescriptionOptions = {}
): Promise<T[]> {
  const overCap = findImagesOverCap(messages, profile)
  const needsWork = overCap.size > 0 || messages.some(m =>
    (m.attachments ?? []).some(
      a => isLoadedAttachment(a) && needsFallbackProcessing(profile, a.mimeType)
    )
  )
  if (!needsWork) return messages

  if (overCap.size > 0) {
    logger.info('[Attachment] Images exceed the profile\'s per-request cap; describing the overflow', {
      ...logContext,
      profileId: profile.id,
      profileName: profile.name,
      maxImagesPerRequest: resolveMaxImagesPerRequest(profile),
      overCap: overCap.size,
    })
  }

  logger.info('[Attachment] Re-deciding attachments for a substituted profile', {
    ...logContext,
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
  })

  const adapted: T[] = []
  for (const message of messages) {
    const attachments = message.attachments ?? []
    if (attachments.length === 0) {
      adapted.push(message)
      continue
    }

    const keep: unknown[] = []
    let prefix = ''

    for (const attachment of attachments) {
      if (!isLoadedAttachment(attachment)) {
        // Not ours to reason about — a caller's own shape. Leave it alone.
        keep.push(attachment)
        continue
      }
      const pastCap = overCap.has(attachment)
      if (!pastCap && !needsFallbackProcessing(profile, attachment.mimeType)) {
        keep.push(attachment)
        continue
      }

      try {
        // Past the cap the profile could read the image but may not be sent
        // it, so the describer is asked directly — `processFileAttachmentFallback`
        // would wave a readable image through untouched.
        const result = pastCap
          ? await generateImageDescription(attachment as never, repos as never, userId, options)
          : await processFileAttachmentFallback(
              {
                id: attachment.id,
                filepath: attachment.filepath ?? `/api/v1/files/${attachment.id}`,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
              },
              attachment as never,
              profile,
              repos as never,
              userId,
              options,
            )
        prefix += formatFallbackAsMessagePrefix(result)
        // Mirror `loadAndProcessFiles`: the bytes ride along only when the
        // profile natively supports them, which `needsFallbackProcessing`
        // has already said it does not. Anything else here — a description,
        // inlined text, or a failed describe — replaces them.
      } catch (error) {
        prefix += `⚠️ Attachment Processing Failed: ${attachment.filename}\n${getErrorMessage(error)}\n\n`
        logger.warn('[Attachment] Re-decide failed for a substituted profile; dropping the attachment', {
          ...logContext,
          profileId: profile.id,
          attachmentId: attachment.id,
          mimeType: attachment.mimeType,
          error: getErrorMessage(error),
        })
      }
    }

    const next: T = { ...message, content: prefix + message.content }
    if (keep.length > 0) {
      next.attachments = keep
    } else {
      delete next.attachments
    }
    adapted.push(next)
  }

  return adapted
}
