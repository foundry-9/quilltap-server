/**
 * Observed Tool Reliability
 *
 * Whether native tool calling has *worked in practice* on a route, read from
 * the LLM logs. A provider's catalog can say a model takes native tools when
 * the route does not honour them well — Gemini called directly is the
 * standing example: it answers a native tool request with a malformed call
 * (`MALFORMED_FUNCTION_CALL`) or writes the call out as prose. This module
 * turns the logs into a verdict that connection-profile Auto-Configure ranks
 * above every catalog for `supportsTools` (`lib/llm/model-catalog.ts`).
 *
 * The sample is the route's own: log rows written by connection profiles that
 * share the target's provider, model and base URL. Only rows that *sent*
 * native tools count (`request.toolCount > 0`) — the text protocols
 * (Simple JSON, text-block) send none — so every sample is a native-mode
 * request. Each is classified by {@link classifyNativeToolOutcome}:
 *
 * - **ok** — the provider returned a native call that parsed (`toolCalls`
 *   non-empty), or said it stopped to call one (`tool_calls` / `tool_use`)
 *   on a row logged before calls were recorded.
 * - **failed** — the provider reported a malformed call, said it stopped to
 *   call a tool that nothing could parse, refused tool calling outright, or
 *   the model wrote a tool call into its prose instead of making one.
 * - **none** — the model answered without a tool, or the call failed for an
 *   unrelated reason (network, rate limit). Not evidence either way.
 *
 * @module llm/tool-reliability
 */

import { isToolUnsupportedError } from '@/lib/llm/errors'
import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'

/** One native-tool request as the logs hold it. */
export interface NativeToolSample {
  /** Tools sent natively with the request */
  toolCount: number
  /** Native calls the provider's parser found; undefined on rows logged before 4.15 recorded them */
  toolCalls?: Array<{ name: string }> | null
  finishReason?: string | null
  error?: string | null
  content?: string | null
}

export type NativeToolOutcome = 'ok' | 'failed' | 'none'

/** Finish reasons that mean the model stopped to make a native call. */
const TOOL_CALL_FINISH_REASONS = new Set(['tool_calls', 'tool_use', 'function_call', 'tool_call'])

/** Finish reasons that mean the provider caught a broken native call (Gemini). */
const MALFORMED_FINISH_REASONS = new Set(['malformed_function_call', 'unexpected_tool_call'])

/**
 * Prose shapes of a tool call the model wrote out instead of making. Kept
 * narrow — each is a tool protocol's own markup, not something a story
 * would say — because a false match here counts against the route.
 */
const SPOKEN_TOOL_CALL_PATTERNS: readonly RegExp[] = [
  /<\s*(?:tool_call|toolcall|function_call|function_calls|tool_use)\b/i,
  /```\s*tool_code\b/i,
  /\bdefault_api\.\w+\s*\(/,
  /\[TOOL_CALLS\]/,
  /<\|(?:tool_call|python_tag|tool_calls_begin)/i,
  /tool▁calls?▁begin/,
  /\{\s*"(?:name|tool_name|function)"\s*:\s*"[\w.-]+"\s*,\s*"(?:arguments|parameters|args)"\s*:/,
]

/** Whether the text carries a tool call written out as prose. */
export function hasSpokenToolCall(content: string | null | undefined): boolean {
  if (!content) return false
  return SPOKEN_TOOL_CALL_PATTERNS.some(pattern => pattern.test(content))
}

/** Classify one native-tool request. Pure. */
export function classifyNativeToolOutcome(sample: NativeToolSample): NativeToolOutcome {
  if (!(sample.toolCount > 0)) return 'none'

  if (sample.error) {
    return isToolUnsupportedError(sample.error) ? 'failed' : 'none'
  }

  if (Array.isArray(sample.toolCalls) && sample.toolCalls.length > 0) return 'ok'

  const finish = sample.finishReason?.toLowerCase() ?? ''
  if (MALFORMED_FINISH_REASONS.has(finish)) return 'failed'

  if (TOOL_CALL_FINISH_REASONS.has(finish)) {
    // Recorded and empty: the provider stopped to call a tool nobody could parse.
    // Not recorded (an older row): trust the provider's own word.
    return Array.isArray(sample.toolCalls) ? 'failed' : 'ok'
  }

  if (hasSpokenToolCall(sample.content)) return 'failed'
  return 'none'
}

/** Fewest decisive samples (ok + failed) a verdict needs. */
export const MIN_DECISIVE_SAMPLES = 5
/** Fewest failures that can call a route unreliable. */
export const MIN_FAILURES = 3
/** Failure share at or above which native tools are judged unreliable. */
export const UNRELIABLE_FAILURE_RATE = 1 / 3
/** Failure share at or below which native tools are judged reliable. */
export const RELIABLE_FAILURE_RATE = 0.1
/** Most recent native-tool requests read for the verdict. */
export const SAMPLE_LIMIT = 50

export type ToolReliabilityVerdict = 'reliable' | 'unreliable' | 'inconclusive'

export interface ToolReliabilitySummary {
  /** Native-tool requests read */
  sampled: number
  /** Requests that produced a well-formed native call */
  ok: number
  /** Requests whose native call was malformed, refused or written as prose */
  failed: number
  verdict: ToolReliabilityVerdict
}

/** Roll classified samples up into a verdict. Pure. */
export function summarizeToolReliability(samples: readonly NativeToolSample[]): ToolReliabilitySummary {
  let ok = 0
  let failed = 0
  for (const sample of samples) {
    const outcome = classifyNativeToolOutcome(sample)
    if (outcome === 'ok') ok++
    else if (outcome === 'failed') failed++
  }
  const decisive = ok + failed
  let verdict: ToolReliabilityVerdict = 'inconclusive'
  if (decisive >= MIN_DECISIVE_SAMPLES) {
    const rate = failed / decisive
    if (failed >= MIN_FAILURES && rate >= UNRELIABLE_FAILURE_RATE) verdict = 'unreliable'
    else if (rate <= RELIABLE_FAILURE_RATE) verdict = 'reliable'
  }
  return { sampled: samples.length, ok, failed, verdict }
}

/** The label shown beside the verdict in the profile editor. */
export function describeToolReliability(summary: ToolReliabilitySummary): string {
  const decisive = summary.ok + summary.failed
  return `observed in your last ${decisive} native tool call${decisive === 1 ? '' : 's'} on this route (${summary.failed} failed)`
}

/** Fold a base URL so `https://x/v1/` and `https://x/v1` name one route. */
export function normalizeRouteBaseUrl(baseUrl: string | null | undefined): string {
  return (baseUrl ?? '').trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * The ids of the profiles that reach `provider`/`modelName` by `baseUrl` —
 * the route whose logs count as evidence about it.
 */
export function sameRouteProfileIds(
  profiles: ReadonlyArray<{ id: string; provider: string; modelName: string; baseUrl?: string | null }>,
  route: { provider: string; modelName: string; baseUrl?: string | null }
): string[] {
  const wantedBase = normalizeRouteBaseUrl(route.baseUrl)
  return profiles
    .filter(p =>
      p.provider === route.provider
      && p.modelName === route.modelName
      && normalizeRouteBaseUrl(p.baseUrl) === wantedBase
    )
    .map(p => p.id)
}

/**
 * Read and judge a route's recent native-tool requests. Never throws: a log
 * database that cannot be read yields an inconclusive empty summary.
 */
export async function observeToolReliability(profileIds: readonly string[]): Promise<ToolReliabilitySummary> {
  const empty: ToolReliabilitySummary = { sampled: 0, ok: 0, failed: 0, verdict: 'inconclusive' }
  if (profileIds.length === 0) return empty
  try {
    const samples = await getRepositories().llmLogs.findRecentNativeToolSamples(profileIds, SAMPLE_LIMIT)
    const summary = summarizeToolReliability(samples)
    logger.debug('[ToolReliability] Route observed', {
      profiles: profileIds.length,
      ...summary,
    })
    return summary
  } catch (error) {
    logger.warn('[ToolReliability] Could not read the logs; no observation', {
      error: error instanceof Error ? error.message : String(error),
    })
    return empty
  }
}
