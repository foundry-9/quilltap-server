/**
 * Shared rules for the idle catch-ups of the two fold-grain passes.
 *
 * The fold OTHER pass and the fold episode pass both run on the fold cadence
 * and both cap how much one run reads. A chat that stops folding would leave
 * either backlog stalled, so the daily maintenance sweep enqueues a catch-up
 * job for each (bug 232 added the episode one beside the OTHER one). Which
 * chats a sweep looks at, which seat's connection profile a catch-up job runs
 * on, and how a catch-up resolves its cheap LLM through the Concierge are the
 * same for both and live here.
 *
 * @module memory/fold-catchup
 */

import { getRepositories } from '@/lib/repositories/factory'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'
import { isHelpLikeChatType } from '@/lib/schemas/chat.types'
import type { ChatMetadata, ConnectionProfile } from '@/lib/schemas/types'
import type { CheapLLMSettings } from '@/lib/schemas/settings.types'
import type { UncensoredFallbackOptions } from './cheap-llm-tasks'
import { buildExtractionUncensoredFallback } from './extraction-route'
import { logger } from '@/lib/logger'

/** A chat must have been quiet this long before a sweep treats its backlog as stalled. */
export const FOLD_CATCHUP_IDLE_MS = 2 * 60 * 60 * 1000

/** Chats whose last message is older than this are not swept (an old backlog is a backfill, not a catch-up). */
export const FOLD_CATCHUP_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000

/** Most catch-up jobs of one kind a sweep will enqueue; the rest wait for tomorrow. */
export const FOLD_CATCHUP_MAX_CHATS = 50

/**
 * Chats a catch-up sweep may consider: not help/brahma, at least two
 * messages, idle more than {@link FOLD_CATCHUP_IDLE_MS} and active within
 * {@link FOLD_CATCHUP_LOOKBACK_MS}. Most recently active first. A cheap
 * prefilter on the chat rows; each pass then checks its own watermark.
 */
export function idleChatsForCatchup(chats: readonly ChatMetadata[], now: number): ChatMetadata[] {
  return chats
    .filter(c => !isHelpLikeChatType(c.chatType))
    .filter(c => (c.messageCount ?? 0) >= 2)
    .map(c => ({ chat: c, last: c.lastMessageAt ? Date.parse(c.lastMessageAt) : NaN }))
    .filter(x => Number.isFinite(x.last))
    .filter(x => now - x.last > FOLD_CATCHUP_IDLE_MS && now - x.last < FOLD_CATCHUP_LOOKBACK_MS)
    .sort((a, b) => b.last - a.last)
    .map(x => x.chat)
}

/** True when the chat has spoken within the idle window, so the fold, not a catch-up, owns its backlog. */
export function isChatActiveForCatchup(chat: Pick<ChatMetadata, 'lastMessageAt'>, now: number): boolean {
  const lastAt = chat.lastMessageAt ? Date.parse(chat.lastMessageAt) : NaN
  return Number.isFinite(lastAt) && now - lastAt <= FOLD_CATCHUP_IDLE_MS
}

/** The connection profile a catch-up job runs on: an LLM-controlled seat's, else any seat's. */
export function pickCatchupConnectionProfileId(chat: Pick<ChatMetadata, 'participants'>): string | null {
  const llmSeat = chat.participants.find(
    p => p.type === 'CHARACTER' && p.controlledBy !== 'user' && p.connectionProfileId,
  )
  const anySeat = llmSeat ?? chat.participants.find(p => p.connectionProfileId)
  return anySeat?.connectionProfileId ?? null
}

export interface FoldCatchupRouteInput {
  userId: string
  connectionProfile: ConnectionProfile
  cheapLLMSettings: CheapLLMSettings
  availableProfiles: ConnectionProfile[]
}

export interface FoldCatchupRoute {
  cheapLLM: CheapLLMSelection
  uncensoredFallback: UncensoredFallbackOptions
}

/**
 * The cheap LLM a catch-up runs on, resolved through the chat's Concierge
 * state exactly as the per-turn handler resolves it, plus the uncensored
 * fallback an empty answer retries on (bug 213).
 */
export async function resolveFoldCatchupRoute(
  chat: ChatMetadata,
  input: FoldCatchupRouteInput,
): Promise<FoldCatchupRoute> {
  const base = getCheapLLMProvider(
    input.connectionProfile,
    {
      strategy: input.cheapLLMSettings.strategy,
      userDefinedProfileId: input.cheapLLMSettings.userDefinedProfileId ?? undefined,
      fallbackToLocal: input.cheapLLMSettings.fallbackToLocal,
    },
    input.availableProfiles,
    false,
  )
  const chatSettings = await getRepositories().chatSettings.findByUserId(input.userId)
  const conciergePolicy = resolveConciergeSettings(chatSettings, chat)
  const uncensoredRoute = shouldUseUncensoredRoute(chat)
  const cheapLLM = resolveUncensoredCheapLLMSelection(base, uncensoredRoute, conciergePolicy, input.availableProfiles)
  logger.debug('[FoldCatchup] Catch-up route resolved', {
    chatId: chat.id,
    provider: cheapLLM?.provider ?? null,
    uncensoredRoute,
  })
  return {
    cheapLLM,
    uncensoredFallback: buildExtractionUncensoredFallback(chat, conciergePolicy, input.availableProfiles),
  }
}
