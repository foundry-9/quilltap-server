/**
 * Refusal classification — the one place Quilltap decides whether a provider
 * declined a request on content-moderation grounds.
 *
 * Before this module there were five approximations: a six-substring match
 * for images, a finish-reason list for empty text bodies, and nothing at all
 * for a thrown text refusal (which fell through the fallback engine's generic
 * 4xx check and was treated as our own malformed request). Every caller now
 * asks here, and the evidence is ranked by how much it can be trusted:
 *
 *   1. `typed-error`     — the plugin threw an error carrying
 *                          `code: 'MODERATION_REJECTED'`. Detected by the code
 *                          string, never `instanceof`: plugins bundle their own
 *                          copy of `@quilltap/plugin-types`, so the class in the
 *                          host is a different class.
 *   2. `provider-code`   — a known SDK / provider moderation code on the error.
 *   3. `finish-reason`   — a stated moderation stop reason.
 *   4. `message-pattern` — wording providers use for a refusal. Deliberately
 *                          narrow: never a bare "400", never "try a different
 *                          prompt", both of which are ambiguous.
 *   5. `inferred`        — an empty body on content the Concierge had flagged.
 *
 * A false positive tells a user their content was refused when it was not,
 * and spends an uncensored call on a rate limit — so anything unrecognised
 * stays unrecognised.
 *
 * @module services/dangerous-content/refusal
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { isModerationFinishReason } from '@/lib/llm/moderation-finish-reason'

const logger = createServiceLogger('ConciergeRefusal')

/** The contract between plugins and the host. See `ModerationRejectionError` in `@quilltap/plugin-types`. */
export const MODERATION_REJECTION_CODE = 'MODERATION_REJECTED' as const

/** The class name, accepted as well so an un-bundled plugin copy still qualifies. */
const MODERATION_REJECTION_NAME = 'ModerationRejectionError'

export type RefusalEvidence =
  | 'typed-error'
  | 'provider-code'
  | 'finish-reason'
  | 'message-pattern'
  | 'inferred'

export interface RefusalVerdict {
  refused: boolean
  evidence?: RefusalEvidence
  /** ≤ 200 chars, never the full error body. */
  detail?: string
}

export interface RefusalInput {
  error?: unknown
  finishReason?: string | null
  emptyBody?: boolean
  contentWasFlagged?: boolean
}

/**
 * Provider / SDK codes that mean a moderation refusal, lower-cased.
 *
 * - `moderation_blocked`, `content_policy_violation` — OpenAI Images (gpt-image, DALL-E)
 * - `content_filter` — OpenAI / Azure
 * - `safety` — Google
 * - `1301` — Z.AI (GLM) "sensitive content"
 */
const PROVIDER_MODERATION_CODES = new Set([
  'moderation_blocked',
  'content_policy_violation',
  'content_filter',
  'safety',
  '1301',
])

/**
 * Message fragments that state a refusal, lower-cased. The first six are the
 * historical `isImageModerationError` list; the rest cover Google's
 * Responsible AI filter, OpenRouter's "declined to generate", and Gemini's
 * block reasons as they appear in error text.
 */
const REFUSAL_MESSAGE_PATTERNS = [
  'content moderation',
  'content_policy',
  'content policy',
  'safety system',
  'rejected by content',
  'moderation_blocked',
  'responsible ai',
  'declined to generate',
  'blocked by safety',
  'prompt_blocked',
  'image_safety',
]

const DETAIL_MAX = 200

function truncate(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > DETAIL_MAX ? `${trimmed.slice(0, DETAIL_MAX - 1)}…` : trimmed
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function codeString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

/** Every code an error carries: its own, and the OpenAI SDK's nested `error.code`. */
function collectCodes(error: unknown): string[] {
  const codes: string[] = []
  const record = asRecord(error)
  if (!record) return codes
  const own = codeString(record.code)
  if (own) codes.push(own)
  const nested = asRecord(record.error)
  const nestedCode = nested ? codeString(nested.code) : null
  if (nestedCode) codes.push(nestedCode)
  return codes
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  const record = asRecord(error)
  if (record && typeof record.message === 'string') return record.message
  return ''
}

function classify(input: RefusalInput): RefusalVerdict {
  const { error, finishReason, emptyBody, contentWasFlagged } = input

  if (error !== undefined && error !== null) {
    const record = asRecord(error)
    const message = messageOf(error)

    // 1. The plugin said so.
    if (record && (record.code === MODERATION_REJECTION_CODE || record.name === MODERATION_REJECTION_NAME)) {
      const reason = typeof record.providerReason === 'string' ? record.providerReason : null
      return {
        refused: true,
        evidence: 'typed-error',
        detail: truncate(reason ? `${message} (${reason})` : message || 'moderation rejection'),
      }
    }

    // 2. A known provider code.
    const moderationCode = collectCodes(error).find((c) => PROVIDER_MODERATION_CODES.has(c.toLowerCase()))
    if (moderationCode) {
      return {
        refused: true,
        evidence: 'provider-code',
        detail: truncate(`code ${moderationCode}${message ? `: ${message}` : ''}`),
      }
    }
  }

  // 3. A stated moderation stop.
  if (isModerationFinishReason(finishReason)) {
    return { refused: true, evidence: 'finish-reason', detail: `finish_reason: ${finishReason}` }
  }

  // 4. Refusal wording in the error text.
  if (error !== undefined && error !== null) {
    const message = messageOf(error)
    const lowered = message.toLowerCase()
    if (lowered && REFUSAL_MESSAGE_PATTERNS.some((p) => lowered.includes(p))) {
      return { refused: true, evidence: 'message-pattern', detail: truncate(message) }
    }
  }

  // 5. Inference: nothing came back for content the Concierge had flagged.
  if (emptyBody && contentWasFlagged) {
    return {
      refused: true,
      evidence: 'inferred',
      detail: 'empty response on content the Concierge had flagged',
    }
  }

  return { refused: false }
}

/**
 * Decide whether a call was refused on content-moderation grounds.
 *
 * First hit wins, in the order of trust documented on the module. Pure apart
 * from logging; safe in the forked job child.
 */
export function classifyRefusal(input: RefusalInput): RefusalVerdict {
  const verdict = classify(input)

  logger.debug('Classified a provider outcome for refusal', {
    refused: verdict.refused,
    evidence: verdict.evidence,
    hasError: input.error !== undefined && input.error !== null,
    finishReason: input.finishReason ?? undefined,
    emptyBody: input.emptyBody,
    contentWasFlagged: input.contentWasFlagged,
  })
  if (verdict.refused) {
    logger.info('Provider refused on content-moderation grounds', {
      evidence: verdict.evidence,
      detail: verdict.detail,
    })
  }

  return verdict
}

/** Shorthand for the common question at a catch site. */
export function isModerationRefusal(error: unknown): boolean {
  return classifyRefusal({ error }).refused
}
