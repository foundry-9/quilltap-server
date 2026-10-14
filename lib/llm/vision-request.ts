/**
 * One picture, one question, one vision model — sent properly.
 *
 * Two features hand a stored or uploaded image to a vision-capable connection
 * profile and read back text: the describe-fallback (`describeImageWithProfile`
 * in `lib/chat/file-attachment-fallback.ts`, for chats whose model cannot see)
 * and the wardrobe's Import from image (`lib/wardrobe/image-analysis.ts`).
 * Everything between "which profile" and "what did it say" is the same, and
 * every step of it has been a bug when skipped:
 *
 *  - **The profile must be able to receive the picture** — the model reads
 *    images *and* its plugin puts them on the wire (`profileCanReceiveAttachment`,
 *    bug 91). {@link resolveVisionProfile} picks with that predicate.
 *  - **The bytes are cut to what a model needs** (`shrinkImageForLlmTransport`,
 *    bug 151) — never the stored original.
 *  - **The call is logged**, answered or not, under the caller's log type.
 *  - **The answer is not believed until the picture is known to have
 *    arrived** ({@link verifyImageReachedModel}, bug 116): a gateway that
 *    accepts an image and drops it produces confident, invented prose.
 *
 * {@link sendVisionRequest} is those steps, once.
 *
 * @module llm/vision-request
 */

import { createLLMProvider } from '@/lib/llm'
import { profileSupportsMimeType } from '@/lib/llm/connection-profile-utils'
import { profileCanReceiveAttachment, providerCanTransportImages } from '@/lib/llm/image-transport'
import { profileParams } from '@/lib/llm/cheap-llm'
import { shrinkImageForLlmTransport } from '@/lib/files/llm-image-budget'
import { logLLMCall } from '@/lib/services/llm-logging.service'
import { withTimeout } from '@/lib/promise-timeout'
import { getErrorMessage } from '@/lib/error-utils'
import { logger } from '@/lib/logger'
import type { FileAttachment, LLMResponse } from '@/lib/llm/base'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { LLMLogType } from '@/lib/schemas/llm-log.types'

const moduleLogger = logger.child({ module: 'vision-request' })

// ============================================================================
// ARRIVAL CHECK
// ============================================================================

/**
 * A deliberately pessimistic characters-per-token ratio, used only to put a
 * *ceiling* on what the text of a request could cost on its own. Real BPE
 * tokenizers run 3.5–4.5 chars/token on English prose, so 2.5 leaves ~40%
 * headroom before a text-only prompt could climb past the ceiling and be
 * mistaken for a real one.
 */
const MIN_CHARS_PER_TOKEN = 2.5

/** The most prompt tokens `text` could plausibly cost on its own. */
export function textOnlyTokenCeiling(text: string): number {
  return Math.ceil(text.length / MIN_CHARS_PER_TOKEN)
}

/** Verdict from {@link verifyImageReachedModel}. */
export type ImageArrivalVerdict =
  | { arrived: true }
  | { arrived: false; reason: string }

/**
 * Did the image actually reach the model, or did we get confident prose about
 * a picture nobody looked at?
 *
 * Bug 116: a NanoGPT route for an experimental vision model accepted the
 * `image_url` part and discarded it, then answered the text it had with a
 * detailed, entirely invented description. Two proofs were on the response
 * object and neither was read:
 *
 *  1. **The plugin's attachment ledger.** `attachmentResults.failed` is the
 *     plugin saying it did not send the bytes.
 *  2. **The response's own token count.** `promptTokens` at or below what the
 *     request's text costs by itself ({@link textOnlyTokenCeiling} of
 *     `requestText`) is a provider-agnostic statement that no image was
 *     processed — the cheapest image tier in the field (OpenAI low-detail, 85
 *     tokens) still lands a real call clear of it.
 *
 * Silence is not evidence: a missing `usage`, or a zero `promptTokens`, means
 * the provider reported nothing and must not be failed for it. Cache-read
 * tokens are added back before comparing, because every plugin normalises
 * them *out* of `promptTokens` (the 4.6.1 invariant) and a cache hit would
 * otherwise read as a dropped image.
 */
export function verifyImageReachedModel(
  response: Pick<LLMResponse, 'usage' | 'attachmentResults' | 'cacheUsage'>,
  attachmentId: string,
  requestText: string
): ImageArrivalVerdict {
  const failed = response.attachmentResults?.failed ?? []
  if (failed.length > 0) {
    const mine = failed.find(f => f.id === attachmentId) ?? failed[0]
    return {
      arrived: false,
      reason: `the provider reported the attachment as not sent: ${mine.error || 'no reason given'}`,
    }
  }

  const promptTokens = response.usage?.promptTokens
  if (typeof promptTokens !== 'number' || promptTokens <= 0) {
    return { arrived: true }
  }

  const ceiling = textOnlyTokenCeiling(requestText)
  const cacheRead =
    (response.cacheUsage?.cacheReadInputTokens ?? 0) +
    (response.cacheUsage?.cachedTokens ?? 0)
  const billedInput = promptTokens + cacheRead
  if (billedInput <= ceiling) {
    return {
      arrived: false,
      reason:
        `the model was billed for ${billedInput} prompt tokens, which is no more than the ` +
        `${ceiling} the request's text costs on its own — the image was accepted and discarded ` +
        `before it reached the model, and any answer returned is invented`,
    }
  }

  return { arrived: true }
}

// ============================================================================
// PROFILE RESOLUTION
// ============================================================================

/** The slice of the repositories the vision path reads. */
export interface VisionRepos {
  chatSettings: { findByUserId(userId: string): Promise<{ imageDescriptionProfileId?: string | null } | null> }
  connections: {
    findById(id: string): Promise<ConnectionProfile | null>
    findByUserId(userId: string): Promise<ConnectionProfile[]>
    findApiKeyByIdAndUserId(id: string, userId: string): Promise<{ key_value: string } | null>
  }
}

export interface ResolveVisionProfileOptions {
  /**
   * Among auto-picked profiles, prefer a cheap one (the describe-fallback,
   * which runs on every unseen image) or a non-cheap one (Import from image,
   * an occasional, deliberate request where quality is the point).
   */
  prefer: 'cheap' | 'capable'
  /**
   * What to do with a configured Image Description profile that cannot
   * receive images. `'honour'` returns it anyway, so the caller can say why it
   * failed (the describe-fallback: the operator chose it). `'skip-incapable'`
   * passes over it to an auto-pick.
   */
  configured: 'honour' | 'skip-incapable'
}

/**
 * The vision profile for a request: the operator's configured Image
 * Description profile (Chat settings) first, else any profile that can
 * receive an image (`profileCanReceiveAttachment`), by the stated preference.
 */
export async function resolveVisionProfile(
  repos: VisionRepos,
  userId: string,
  options: ResolveVisionProfileOptions
): Promise<ConnectionProfile | null> {
  const chatSettings = await repos.chatSettings.findByUserId(userId)
  const configuredId = chatSettings?.imageDescriptionProfileId
  if (configuredId) {
    const configured = await repos.connections.findById(configuredId)
    if (configured) {
      if (options.configured === 'honour' || profileCanReceiveAttachment(configured, 'image/jpeg')) {
        moduleLogger.debug('[Vision] Using the configured image description profile', {
          profileId: configured.id,
          provider: configured.provider,
          model: configured.modelName,
        })
        return configured
      }
      moduleLogger.debug('[Vision] Configured image description profile cannot receive images; auto-picking', {
        profileId: configured.id,
        provider: configured.provider,
        model: configured.modelName,
      })
    }
  }

  const visionProfiles = (await repos.connections.findByUserId(userId)).filter(p =>
    profileCanReceiveAttachment(p, 'image/jpeg')
  )
  if (visionProfiles.length === 0) {
    moduleLogger.debug('[Vision] No profile can receive images', { userId })
    return null
  }

  const preferred = visionProfiles.find(p =>
    options.prefer === 'cheap' ? p.isCheap === true : !p.isCheap
  )
  const picked = preferred ?? visionProfiles[0]
  moduleLogger.debug('[Vision] Auto-picked a vision profile', {
    profileId: picked.id,
    provider: picked.provider,
    model: picked.modelName,
    isCheap: picked.isCheap,
    prefer: options.prefer,
  })
  return picked
}

// ============================================================================
// THE REQUEST
// ============================================================================

export interface VisionRequestInput {
  profile: ConnectionProfile
  repos: Pick<VisionRepos, 'connections'>
  userId: string
  /**
   * The picture. Base64 `data` is shrunk for transport here; an attachment
   * the plugin loads itself (no `data`) is passed through as given.
   */
  attachment: FileAttachment
  /** Optional system message. */
  systemPrompt?: string
  /** The user message the picture rides on. */
  instruction: string
  sampling: { temperature?: number; maxTokens?: number; topP?: number }
  timeoutMs: number
  /** The `llm_logs` type the call is recorded under. */
  logType: LLMLogType
  /** Refuse (rather than send keyless) when the profile has no API key. Ollama is exempt. */
  requireApiKey?: boolean
}

/** Why a vision request produced no usable answer without throwing. */
export type VisionRequestRefusal =
  | 'model-cannot-read'
  | 'plugin-cannot-send'
  | 'missing-api-key'
  | 'image-not-received'

export type VisionRequestResult =
  | { ok: true; response: LLMResponse; sentAttachment: FileAttachment }
  | { ok: false; refusal: VisionRequestRefusal; detail: string; response?: LLMResponse }

/**
 * Send one picture to one vision profile and return its answer — only once
 * the picture is known to have arrived. A provider error or timeout is logged
 * and rethrown; the four refusals come back as `ok: false`.
 */
export async function sendVisionRequest(input: VisionRequestInput): Promise<VisionRequestResult> {
  const { profile, userId, attachment } = input
  const startedAt = Date.now()

  // Both halves of `profileCanReceiveAttachment`, asked separately so the
  // refusal can say which one failed.
  if (!profileSupportsMimeType(profile, attachment.mimeType)) {
    return { ok: false, refusal: 'model-cannot-read', detail: `${profile.provider} ${profile.modelName} does not read ${attachment.mimeType} files` }
  }
  if (attachment.mimeType.startsWith('image/') && !providerCanTransportImages(profile.provider)) {
    return { ok: false, refusal: 'plugin-cannot-send', detail: `the ${profile.provider} plugin does not forward image attachments` }
  }

  let apiKeyValue = ''
  if (profile.apiKeyId) {
    const apiKey = await input.repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
    if (apiKey) apiKeyValue = apiKey.key_value
  }
  if (input.requireApiKey && !apiKeyValue && profile.provider !== 'OLLAMA') {
    return { ok: false, refusal: 'missing-api-key', detail: `API key not found for provider ${profile.provider}` }
  }

  // What a model needs, not what the archive keeps (bug 151). Never throws:
  // an unshrinkable image goes as it came.
  const shrunk = attachment.data
    ? await shrinkImageForLlmTransport({
        buffer: Buffer.from(attachment.data, 'base64'),
        mimeType: attachment.mimeType,
        provider: profile.provider,
        filename: attachment.filename,
      })
    : null
  const sentAttachment: FileAttachment = shrunk?.wasShrunk
    ? { ...attachment, data: shrunk.buffer.toString('base64'), mimeType: shrunk.mimeType, size: shrunk.finalSize }
    : attachment

  const modelParams = profileParams(profile)
  const messages = [
    ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
    { role: 'user' as const, content: input.instruction, attachments: [sentAttachment] },
  ]
  const messageParams: Record<string, unknown> = { model: profile.modelName, messages }
  if (input.sampling.temperature !== undefined) messageParams.temperature = input.sampling.temperature
  if (input.sampling.maxTokens !== undefined && input.sampling.maxTokens > 0) messageParams.maxTokens = input.sampling.maxTokens
  if (input.sampling.topP !== undefined) messageParams.topP = input.sampling.topP
  // Forward the profile's provider params (e.g. DeepSeek thinking mode) so a
  // "reasoning off" setting on the vision profile takes effect.
  if (modelParams && typeof modelParams === 'object') messageParams.profileParameters = modelParams

  const loggedRequest = {
    messages: [
      ...(input.systemPrompt ? [{ role: 'system', content: input.systemPrompt }] : []),
      {
        role: 'user',
        content: input.instruction,
        attachments: [{ filename: attachment.filename, mimeType: sentAttachment.mimeType }],
      },
    ],
    temperature: input.sampling.temperature,
    maxTokens: input.sampling.maxTokens,
  }
  const record = async (call: Pick<Parameters<typeof logLLMCall>[0], 'response' | 'usage'>) => {
    try {
      await logLLMCall({
        userId,
        type: input.logType,
        provider: profile.provider,
        modelName: profile.modelName,
        request: loggedRequest,
        ...call,
        durationMs: Date.now() - startedAt,
      })
    } catch (logErr) {
      moduleLogger.warn('[Vision] Failed to record the vision call in llm_logs', {
        logType: input.logType,
        error: getErrorMessage(logErr),
      })
    }
  }

  moduleLogger.debug('[Vision] Sending image to vision model', {
    logType: input.logType,
    profileId: profile.id,
    provider: profile.provider,
    model: profile.modelName,
    originalBytes: shrunk?.originalSize ?? null,
    sentBytes: shrunk?.finalSize ?? null,
    shrunk: shrunk?.wasShrunk ?? false,
  })

  let response: LLMResponse
  try {
    const provider = await createLLMProvider(profile.provider as never, profile.baseUrl || undefined)
    response = await withTimeout(
      provider.sendMessage(messageParams as never, apiKeyValue),
      input.timeoutMs,
      `Vision request timed out after ${input.timeoutMs}ms`,
    )
  } catch (error) {
    await record({ response: { content: '', error: getErrorMessage(error) } })
    throw error
  }

  await record({
    response: { content: response.content ?? '', finishReason: response.finishReason ?? null },
    usage: response.usage,
  })

  // Before believing a word of it: did the image arrive? (bug 116)
  const arrival = verifyImageReachedModel(
    response,
    sentAttachment.id,
    `${input.systemPrompt ?? ''}${input.instruction}`,
  )
  if (!arrival.arrived) {
    moduleLogger.warn('[Vision] Model answered without the image; discarding its answer', {
      logType: input.logType,
      profileId: profile.id,
      provider: profile.provider,
      model: profile.modelName,
      reason: arrival.reason,
      promptTokens: response.usage?.promptTokens,
      contentLength: response.content?.length ?? 0,
    })
    return { ok: false, refusal: 'image-not-received', detail: arrival.reason, response }
  }

  moduleLogger.debug('[Vision] Vision answer received', {
    logType: input.logType,
    profileId: profile.id,
    contentLength: response.content?.length ?? 0,
    durationMs: Date.now() - startedAt,
  })
  return { ok: true, response, sentAttachment }
}
