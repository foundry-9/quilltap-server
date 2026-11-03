/**
 * One image transport budget on the way to a provider.
 *
 * A Salon turn can carry images from three sources — this turn's uploads,
 * uploads the character has not yet been shown (bug 121's re-hydration), and
 * Lantern images posted since the character last spoke — and every one of
 * them costs the request three things: a slot under the profile's per-request
 * image cap (`resolveMaxImagesPerRequest`), base64 bytes under the provider's
 * request-body limit, and a model that can read it at all. Those three
 * questions used to be answered in five places, each locally sensible and
 * together uneven: the byte budget covered Lantern images only (bug 151's
 * 413 was still reachable with four uploads beside two portraits), the cap was
 * enforced twice with opposite tie-breaks, an image past the byte budget
 * vanished without a word, and a failover understudy had its count re-checked
 * but never its bytes.
 *
 * `applyImageTransportBudget` answers all three once, on the final message
 * array, for whichever profile is about to be called — the primary from the
 * context builder, and each substitute from the failover service — so an
 * understudy gets the full policy for free.
 *
 *  1. **Capability.** An attachment the profile cannot receive is put through
 *     `processFileAttachmentFallback` whatever its rank: an image becomes its
 *     description, a text file is inlined. This is the only place the
 *     capability rule is written for images; the loaders only tag.
 *  2. **Rank.** Receivable images are ranked by provenance and age, never by
 *     array position: this turn's uploads newest first, then re-hydrated
 *     uploads newest first, then Lantern images newest first. An attachment
 *     without a `transport` tag ranks after all of them, in array order — a
 *     caller that forgets to tag loses priority, never correctness.
 *  3. **Count, then bytes.** The cap and then `LLM_TRANSPORT_TOTAL_BASE64` are
 *     spent down the ranked list. Over the byte budget the walk continues, so a
 *     smaller image further down may still fit.
 *  4. **Overflow is described or dropped with a note — never silently.** A
 *     `describable` image (an upload, or a generated image whose prompt is on
 *     file) becomes its description; anything else, or a description that
 *     fails, is replaced by `IMAGE_OMITTED_NOTE` so the model and the LLM-log
 *     reader both see that something was there.
 *
 * Returns the **same array reference** when nothing changes, which callers use
 * as a cheap identity check and which is the overwhelmingly common case.
 * Never throws: a describer that fails leaves a note where the bytes were.
 *
 * The per-image shrink is not here: it needs the raw buffer, and stays at load
 * time in `lib/chat-files-v2.ts` (`shrinkImageForLlmTransport`). Nothing here
 * touches a stored file.
 *
 * Design of record: docs/developer/features/refactor-4-12-image-transport-budget.md
 *
 * @module chat/image-transport-budget
 */

import {
  processFileAttachmentFallback,
  generateImageDescription,
  formatFallbackAsMessagePrefix,
  type FallbackResult,
  type ImageDescriptionOptions,
} from '@/lib/chat/file-attachment-fallback'
import { LLM_TRANSPORT_TOTAL_BASE64 } from '@/lib/files/llm-image-budget'
import { resolveMaxImagesPerRequest } from '@/lib/llm/connection-profile-utils'
import { profileCanReceiveAttachment } from '@/lib/llm/image-transport'
import { getErrorMessage } from '@/lib/error-utils'
import { logger } from '@/lib/logger'

import type { ConnectionProfile } from '@/lib/schemas/types'

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/** Where an attachment on the final array came from. */
export type ImageTransportOrigin = 'upload' | 'rehydrated' | 'lantern'

/**
 * Transport-only provenance, set by the loader that built the attachment and
 * read by nothing but this pass. Stripped before the attachment reaches a
 * plugin or a log (`stripTransportTag`).
 */
export interface ImageTransportTag {
  origin: ImageTransportOrigin
  /** Epoch ms of the message (or upload) that carried it; newer ranks higher. */
  createdAt: number
  /**
   * True when describing this image past the budget is worth a describer call:
   * the operator's own uploads always, and a generated image only when its
   * prompt or a description is on file (free to reuse). A vault-stored avatar
   * comes back from `loadChatFilesForLLM` with a mount-link id that the
   * persisted-description lookup cannot find, so it is not describable until
   * a lookup by link id exists, and past the budget it is dropped with a note
   * rather than spend a vision call on every turn.
   */
  describable: boolean
}

const ORIGIN_RANK: Record<ImageTransportOrigin, number> = {
  upload: 0,
  rehydrated: 1,
  lantern: 2,
}
const UNTAGGED_RANK = 3

/** Attach provenance to a loaded attachment (returns a shallow copy). */
export function tagForTransport<T extends object>(
  attachment: T,
  tag: ImageTransportTag,
): T & { transport: ImageTransportTag } {
  return { ...attachment, transport: tag }
}

/**
 * The attachment a plugin may see: `transport` removed. Anything that is not
 * an object comes back unchanged, and so does an object with no tag (same
 * reference).
 */
export function stripTransportTag<T>(attachment: T): T {
  if (!attachment || typeof attachment !== 'object' || !('transport' in attachment)) return attachment
  const { transport: _transport, ...rest } = attachment as T & { transport?: unknown }
  return rest as T
}

/** `stripTransportTag` over an attachment list (undefined stays undefined). */
export function stripTransportTags<T>(attachments: T[] | undefined): T[] | undefined {
  return attachments?.map(stripTransportTag)
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

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

/** One attachment as `loadChatFilesForLLM` produces it, plus the optional tag. */
interface LoadedAttachment {
  id: string
  filepath?: string
  filename: string
  mimeType: string
  size: number
  data?: string
  transport?: ImageTransportTag
}

function isLoadedAttachment(value: unknown): value is LoadedAttachment {
  if (!value || typeof value !== 'object') return false
  const a = value as Partial<LoadedAttachment>
  return typeof a.id === 'string' && typeof a.mimeType === 'string'
}

function isImage(attachment: LoadedAttachment): boolean {
  return attachment.mimeType.startsWith('image/')
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

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface ImageTransportPolicy {
  /** Most images one request may carry (`resolveMaxImagesPerRequest`). */
  maxImages: number
  /** Most base64 the kept images may sum to (`LLM_TRANSPORT_TOTAL_BASE64`). */
  maxTotalBase64: number
  /** May this profile be sent these bytes raw? */
  canReceive: (mimeType: string) => boolean
}

/** The policy for a profile about to be called. */
export function imageTransportPolicyFor(profile: ConnectionProfile): ImageTransportPolicy {
  return {
    maxImages: resolveMaxImagesPerRequest(profile),
    maxTotalBase64: LLM_TRANSPORT_TOTAL_BASE64,
    canReceive: mimeType => profileCanReceiveAttachment(profile, mimeType),
  }
}

/**
 * What stands in for an image that was over the request budget and could not
 * be described. Plain and short: it reaches the model.
 */
export const IMAGE_OMITTED_NOTE = '[image omitted: over the request budget]'

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type TransportOutcome = 'kept' | 'described' | 'dropped'
export type TransportReason = 'within-budget' | 'capability' | 'count' | 'bytes'

export interface TransportReportEntry {
  attachmentId: string
  filename: string
  mimeType: string
  origin: ImageTransportOrigin | null
  base64Bytes: number
  outcome: TransportOutcome
  reason: TransportReason
}

export interface TransportReport {
  entries: TransportReportEntry[]
  kept: number
  described: number
  dropped: number
  /** Base64 bytes of the images kept on the wire. */
  base64Kept: number
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface ImageTransportDeps {
  repos: unknown
  userId: string
  /** Extra fields for every log line (chat id, participant id, failover kind). */
  logContext?: Record<string, unknown>
  /** Forwarded to the describer (the chat decides the uncensored desk). */
  describeOptions?: ImageDescriptionOptions
}

type Verdict =
  | { kind: 'keep' }
  | { kind: 'capability' }
  | { kind: 'overflow'; reason: 'count' | 'bytes' }

interface Located {
  attachment: LoadedAttachment
  order: number
}

function base64Bytes(attachment: LoadedAttachment): number {
  return attachment.data?.length ?? 0
}

/**
 * Rank receivable images: origin, then newest first, then array order. Stable
 * by construction (array order is the last key).
 */
function rankImages(images: Located[]): Located[] {
  return [...images].sort((a, b) => {
    const ra = a.attachment.transport ? ORIGIN_RANK[a.attachment.transport.origin] : UNTAGGED_RANK
    const rb = b.attachment.transport ? ORIGIN_RANK[b.attachment.transport.origin] : UNTAGGED_RANK
    if (ra !== rb) return ra - rb
    const ta = a.attachment.transport?.createdAt ?? 0
    const tb = b.attachment.transport?.createdAt ?? 0
    if (ta !== tb) return tb - ta
    return a.order - b.order
  })
}

/**
 * Decide every loaded attachment's fate for `policy`. Pure; exported so the
 * ranking can be tested without a describer.
 */
export function planImageTransport(
  messages: readonly AttachmentBearingMessage[],
  policy: ImageTransportPolicy,
): Map<unknown, Verdict> {
  const verdicts = new Map<unknown, Verdict>()
  const receivableImages: Located[] = []
  let order = 0

  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (!isLoadedAttachment(attachment)) continue
      if (!policy.canReceive(attachment.mimeType)) {
        verdicts.set(attachment, { kind: 'capability' })
      } else if (isImage(attachment)) {
        receivableImages.push({ attachment, order: order++ })
      } else {
        verdicts.set(attachment, { kind: 'keep' })
      }
    }
  }

  let kept = 0
  let bytesLeft = policy.maxTotalBase64
  for (const { attachment } of rankImages(receivableImages)) {
    if (kept >= policy.maxImages) {
      verdicts.set(attachment, { kind: 'overflow', reason: 'count' })
      continue
    }
    const cost = base64Bytes(attachment)
    if (cost > bytesLeft) {
      verdicts.set(attachment, { kind: 'overflow', reason: 'bytes' })
      continue
    }
    bytesLeft -= cost
    kept++
    verdicts.set(attachment, { kind: 'keep' })
  }

  return verdicts
}

function fileMetadataOf(attachment: LoadedAttachment) {
  return {
    id: attachment.id,
    filepath: attachment.filepath ?? `/api/v1/files/${attachment.id}`,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
  }
}

function entryFor(
  attachment: LoadedAttachment,
  outcome: TransportOutcome,
  reason: TransportReason,
): TransportReportEntry {
  return {
    attachmentId: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    origin: attachment.transport?.origin ?? null,
    base64Bytes: base64Bytes(attachment),
    outcome,
    reason,
  }
}

/** Should an overflow image be put to the describer? Untagged ones are, as before. */
function isDescribable(attachment: LoadedAttachment): boolean {
  return attachment.transport?.describable ?? true
}

/**
 * Apply the one image transport policy to the final message array for the
 * profile about to be called. See the module note for the rules.
 */
export async function applyImageTransportBudget<T extends AttachmentBearingMessage>(
  messages: T[],
  profile: ConnectionProfile,
  deps: ImageTransportDeps,
  policy: ImageTransportPolicy = imageTransportPolicyFor(profile),
): Promise<{ messages: T[]; report: TransportReport }> {
  const logContext = {
    ...(deps.logContext ?? {}),
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
  }
  const verdicts = planImageTransport(messages, policy)
  const report: TransportReport = { entries: [], kept: 0, described: 0, dropped: 0, base64Kept: 0 }

  const needsWork = [...verdicts.values()].some(v => v.kind !== 'keep')
  if (!needsWork) {
    for (const message of messages) {
      for (const attachment of message.attachments ?? []) {
        if (!isLoadedAttachment(attachment) || !isImage(attachment)) continue
        report.entries.push(entryFor(attachment, 'kept', 'within-budget'))
        report.kept++
        report.base64Kept += base64Bytes(attachment)
      }
    }
    return { messages, report }
  }

  const describeOptions = deps.describeOptions ?? {}
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
      const verdict = isLoadedAttachment(attachment) ? verdicts.get(attachment) : undefined
      if (!isLoadedAttachment(attachment) || !verdict) {
        // Not ours to reason about — a caller's own shape. Leave it alone.
        keep.push(attachment)
        continue
      }

      if (verdict.kind === 'keep') {
        keep.push(attachment)
        if (isImage(attachment)) {
          report.entries.push(entryFor(attachment, 'kept', 'within-budget'))
          report.kept++
          report.base64Kept += base64Bytes(attachment)
        }
        continue
      }

      if (verdict.kind === 'capability') {
        // The profile cannot take these bytes at all: describe or inline,
        // exactly as if it had been the primary all along (bug 106). The
        // bytes never ride along here, described or not.
        try {
          const result = await processFileAttachmentFallback(
            fileMetadataOf(attachment),
            stripTransportTag(attachment) as never,
            profile,
            deps.repos as never,
            deps.userId,
            describeOptions,
          )
          prefix += formatFallbackAsMessagePrefix(result)
          const described = result.type !== 'unsupported'
          report.entries.push(entryFor(attachment, described ? 'described' : 'dropped', 'capability'))
          if (described) report.described++
          else report.dropped++
        } catch (error) {
          prefix += `⚠️ Attachment Processing Failed: ${attachment.filename}\n${getErrorMessage(error)}\n\n`
          report.entries.push(entryFor(attachment, 'dropped', 'capability'))
          report.dropped++
          logger.warn('[ImageTransport] Fallback failed for an attachment the profile cannot receive; dropping it', {
            ...logContext,
            attachmentId: attachment.id,
            mimeType: attachment.mimeType,
            error: getErrorMessage(error),
          })
        }
        continue
      }

      // Over the count cap or the byte budget: the profile could read it but
      // may not be sent it, so the describer is asked directly —
      // `processFileAttachmentFallback` would wave a readable image through.
      let result: FallbackResult | null = null
      if (isDescribable(attachment)) {
        try {
          result = await generateImageDescription(
            stripTransportTag(attachment) as never,
            deps.repos as never,
            deps.userId,
            describeOptions,
          )
        } catch (error) {
          logger.warn('[ImageTransport] Describing an over-budget image failed; omitting it with a note', {
            ...logContext,
            attachmentId: attachment.id,
            error: getErrorMessage(error),
          })
        }
      }
      if (result && result.type === 'image_description') {
        prefix += formatFallbackAsMessagePrefix(result)
        report.entries.push(entryFor(attachment, 'described', verdict.reason))
        report.described++
      } else {
        prefix += `${IMAGE_OMITTED_NOTE}\n\n`
        report.entries.push(entryFor(attachment, 'dropped', verdict.reason))
        report.dropped++
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

  const overflow = report.entries.filter(e => e.reason === 'count' || e.reason === 'bytes')
  if (overflow.length > 0) {
    logger.info('[ImageTransport] Images over the request budget were described or omitted', {
      ...logContext,
      maxImages: policy.maxImages,
      maxTotalBase64: policy.maxTotalBase64,
      base64Kept: report.base64Kept,
      kept: report.kept,
      overCount: overflow.filter(e => e.reason === 'count').length,
      overBytes: overflow.filter(e => e.reason === 'bytes').length,
      described: overflow.filter(e => e.outcome === 'described').length,
      omitted: overflow.filter(e => e.outcome === 'dropped').length,
    })
  }
  logger.debug('[ImageTransport] Transport report', { ...logContext, report })

  return { messages: adapted, report }
}
