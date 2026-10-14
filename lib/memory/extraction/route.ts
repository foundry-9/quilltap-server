/**
 * The cheap-LLM route an extraction unit of work runs on (memory refactor
 * §3.7), resolved once per unit of work through the chat's Concierge state.
 *
 *  - The selection comes from the user's cheap-LLM settings
 *    (`buildCheapLLMConfig`, the global default cheap profile first) against
 *    the unit of work's connection profile, then through
 *    `resolveUncensoredCheapLLMSelection`: only an Unmoderated chat whose
 *    policy routes direct goes to the uncensored desk.
 *  - The uncensored fallback is the empty-answer retry every pass carries
 *    (bug 213). Its `isDangerousChat` is the question "is this chat on the
 *    uncensored route?", answered by `shouldUseUncensoredRoute` — never the
 *    classifier's `chats.isDangerousChat` telemetry. A Locked chat's policy is
 *    inert, so it neither reroutes nor fails over.
 *  - The output budget is the connection profile's (`resolveMaxTokens`): it
 *    bounds every pass's cap ({@link passCap}).
 *
 * @module memory/extraction/route
 */

import { buildCheapLLMConfig, getCheapLLMProvider, resolveUncensoredCheapLLMSelection, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { resolveMaxTokens } from '@/lib/llm/model-context-data'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'
import type { ChatMetadata, ChatSettings, ConnectionProfile } from '@/lib/schemas/types'
import type { UncensoredFallbackOptions } from '../cheap-llm-tasks/types'
import { logger } from '@/lib/logger'

export interface ExtractionRoute {
  cheapLLM: CheapLLMSelection
  /** Null only when the Concierge policy could not be resolved. */
  uncensoredFallback: UncensoredFallbackOptions | null
  /** The output budget the pass caps are clamped by. */
  maxTokens: number
  /** The profile the unit of work runs against (cost events are booked to it). */
  connectionProfile: ConnectionProfile
}

export interface ResolveExtractionRouteInput {
  chat: ChatMetadata
  connectionProfile: ConnectionProfile
  chatSettings: ChatSettings | null
  availableProfiles: ConnectionProfile[]
}

/** The route, resolved once. Never throws: a Concierge read that fails leaves the fallback off. */
export function resolveExtractionRoute(input: ResolveExtractionRouteInput): ExtractionRoute {
  const { chat, connectionProfile, chatSettings, availableProfiles } = input
  const base = getCheapLLMProvider(connectionProfile, buildCheapLLMConfig(chatSettings), availableProfiles, false)
  const uncensoredRoute = shouldUseUncensoredRoute(chat)

  let cheapLLM = base
  let uncensoredFallback: UncensoredFallbackOptions | null = null
  try {
    const conciergePolicy = resolveConciergeSettings(chatSettings, chat)
    cheapLLM = resolveUncensoredCheapLLMSelection(base, uncensoredRoute, conciergePolicy, availableProfiles)
    uncensoredFallback = { conciergePolicy, availableProfiles, isDangerousChat: uncensoredRoute }
  } catch (error) {
    logger.warn('[Memory] Could not resolve the Concierge policy for extraction; running without the uncensored fallback', {
      chatId: chat.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const route: ExtractionRoute = {
    cheapLLM,
    uncensoredFallback,
    maxTokens: resolveMaxTokens(connectionProfile),
    connectionProfile,
  }
  logger.debug('[Memory] Extraction route resolved', {
    chatId: chat.id,
    provider: cheapLLM?.provider ?? null,
    model: cheapLLM?.modelName ?? null,
    uncensoredRoute,
    hasUncensoredFallback: uncensoredFallback !== null,
    maxTokens: route.maxTokens,
  })
  return route
}
