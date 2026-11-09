/**
 * The Concierge's place in casting: which state a new chat starts in, and
 * applying it.
 *
 * The state is applied while the chat is cast — before the opening's staff
 * posts and greeting — so the Concierge's bubble is the first thing in the
 * history and the greeting is composed under the chosen state. Moderated (or
 * absence) is a no-op: `applyConciergeFlip` compares against the fresh row
 * and does nothing.
 *
 * Server-only.
 *
 * @module chat/opening/concierge
 */

import { logger } from '@/lib/logger'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { ChatMetadata } from '@/lib/schemas/types'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import { applyConciergeFlip } from '@/lib/services/dangerous-content/manual-flip'

/** The chat's stored Concierge columns, as the create response carries them. */
export type ConciergeColumns = Pick<ChatMetadata, 'conciergeMode' | 'conciergeModeSetBy' | 'conciergeModeReason'>

/**
 * The Concierge state a new chat should start in. The request's own
 * `conciergeState` wins; absent, the operator's `newChatsStartAs` default
 * applies — but only where the Concierge is on duty for this chat (enabled
 * globally and not a moderation-exempt chat type), so an off-duty Concierge
 * never posts an announcement on a brand-new chat.
 */
export function requestedConciergeStateAtCreation(
  requested: ConciergeState | undefined,
  chatSettings: Parameters<typeof resolveConciergeSettings>[0],
  chat: Parameters<typeof resolveConciergeSettings>[1] & { id?: string },
): ConciergeState | undefined {
  const policy = resolveConciergeSettings(chatSettings, chat)
  if (requested) {
    // Off duty, the per-chat select is disabled; a request that still names a
    // state (a form opened before the switch was thrown) is not honoured, so
    // an off-duty Concierge never stamps a new chat.
    if (!policy.onDuty && requested !== 'moderated') {
      logger.warn('[Casting] Ignoring a requested Concierge state: the Concierge is off duty', {
        chatId: chat?.id,
        requested,
        conciergeSource: policy.source,
      })
      return undefined
    }
    return requested
  }
  const fallback = policy.onDuty ? policy.newChatsStartAs : undefined
  logger.debug('[Casting] No Concierge state requested; using the default', {
    chatId: chat?.id,
    newChatsStartAs: policy.newChatsStartAs,
    conciergeSource: policy.source,
    applied: fallback ?? 'none',
  })
  return fallback
}

/**
 * Apply a Concierge state requested at creation. Returns the chat's Concierge
 * columns as they stand afterwards, re-read when the flip wrote anything, so
 * the create response reports the state actually applied.
 */
export async function applyRequestedConciergeState(
  chat: ChatMetadata,
  requested: ConciergeState | undefined,
  repos: RepositoryContainer,
): Promise<ConciergeColumns> {
  const asCreated: ConciergeColumns = {
    conciergeMode: chat.conciergeMode ?? null,
    conciergeModeSetBy: chat.conciergeModeSetBy ?? null,
    conciergeModeReason: chat.conciergeModeReason ?? null,
  }
  if (!requested || requested === 'moderated') return asCreated
  const result = await applyConciergeFlip(chat.id, requested, chat)
  logger.debug('[Casting] Applied Concierge state at creation', {
    chatId: chat.id,
    requested,
    changed: result.changed,
  })
  if (!result.changed) return asCreated
  const fresh = await repos.chats.findById(chat.id)
  return fresh
    ? {
        conciergeMode: fresh.conciergeMode ?? null,
        conciergeModeSetBy: fresh.conciergeModeSetBy ?? null,
        conciergeModeReason: fresh.conciergeModeReason ?? null,
      }
    : asCreated
}
