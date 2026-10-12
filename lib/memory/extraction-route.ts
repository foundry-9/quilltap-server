/**
 * Shared per-chat inputs for the memory extraction passes.
 *
 * Every extraction pass (per-turn, Carina, the fold OTHER and episode passes,
 * the OTHER catch-up) needs the same two things from the chat besides its
 * transcript: the uncensored fallback its cheap-LLM calls may retry on, and
 * the project description the extractor judges a memory's scope against.
 * Building them in one place is what keeps a pass from being wired without
 * one (bugs 213, 222).
 *
 * @module memory/extraction-route
 */

import { getRepositories } from '@/lib/repositories/factory'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import type { ResolvedConciergePolicy } from '@/lib/services/dangerous-content/resolver.service'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { UncensoredFallbackOptions } from './cheap-llm-tasks'
import { logger } from '@/lib/logger'

type ChatForRoute = Parameters<typeof shouldUseUncensoredRoute>[0]

/**
 * The uncensored fallback for an extraction pass on this chat.
 *
 * `isDangerousChat` on the options is the empty-response retry's question
 * "is this chat on the uncensored route?" — so it is answered by
 * `shouldUseUncensoredRoute` (Unmoderated, whoever set it), never by the
 * classifier's `chats.isDangerousChat` telemetry column. With it set, an
 * Unmoderated chat whose cheap model is already the desk's still retries an
 * empty answer on the configured desk text profile, as the chat path does.
 */
export function buildExtractionUncensoredFallback(
  chat: ChatForRoute,
  conciergePolicy: ResolvedConciergePolicy,
  availableProfiles: ConnectionProfile[],
): UncensoredFallbackOptions {
  return {
    conciergePolicy,
    availableProfiles,
    isDangerousChat: shouldUseUncensoredRoute(chat),
  }
}

/**
 * The description of the chat's project, as background for the extractor's
 * scope judgement. Null when the chat has no project or the project cannot be
 * read — a broken project store must never sink an extraction.
 */
export async function loadExtractionProjectDescription(
  projectId: string | null | undefined,
  logContext: Record<string, unknown> = {},
): Promise<string | null> {
  if (!projectId) return null
  try {
    const project = await getRepositories().projects.findById(projectId)
    return project?.description ?? null
  } catch (error) {
    logger.debug('[Memory] Project description unavailable; continuing without it', {
      ...logContext,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
