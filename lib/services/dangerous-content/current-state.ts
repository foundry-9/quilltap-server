/**
 * The chat's Concierge state as it stands *now* — for decisions taken at the
 * moment a provider refuses, not when the request began.
 *
 * A turn or a picture reads its chat once, before a provider call that can
 * take many seconds. If the operator locks the chat meanwhile, a failover gate
 * that trusts that snapshot would send the refused request to the uncensored
 * desk anyway, which is exactly what Locked promises never happens. The
 * failover chokepoints ask this instead of the snapshot. Server-only (it
 * reads the database); `chat-override.ts` stays client-safe.
 *
 * @module services/dangerous-content/current-state
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getErrorMessage } from '@/lib/error-utils'
import { getRepositories } from '@/lib/repositories/factory'
import { getConciergeState, type ConciergeState } from './chat-override'
import { readConciergeSettings } from './resolver.service'

const logger = createServiceLogger('ConciergeCurrentState')

/**
 * Re-read a chat's Concierge state. Falls back to `snapshot` when there is no
 * chat to read or the read fails, and never throws. A missing snapshot reads
 * as Moderated, like a missing column.
 */
export async function readCurrentConciergeState(
  chatId: string | null | undefined,
  snapshot?: ConciergeState | null,
): Promise<ConciergeState> {
  const fallback: ConciergeState = snapshot ?? 'moderated'
  if (!chatId) return fallback
  try {
    const chat = await getRepositories().chats.findById(chatId)
    if (!chat) {
      logger.debug('Current Concierge state: chat not found; using the snapshot', { chatId, snapshot: fallback })
      return fallback
    }
    const state = getConciergeState(chat)
    if (state !== fallback) {
      logger.info('Concierge state changed since the request began', { chatId, snapshot: fallback, current: state })
    }
    return state
  } catch (error) {
    logger.warn('Could not re-read the Concierge state; using the snapshot', {
      chatId,
      snapshot: fallback,
      error: getErrorMessage(error),
    })
    return fallback
  }
}

/**
 * Whether the Concierge is on duty *now* — the global half of the refusal-time
 * check. A policy resolved when the turn began says `failoverAllowed`; if the
 * operator switched the Concierge off while the provider was thinking, the
 * refusal must not reach the uncensored desk. Falls back to `snapshot` when
 * there is no user or the read fails, and never throws.
 */
export async function readCurrentConciergeOnDuty(
  userId: string | null | undefined,
  snapshot: boolean,
): Promise<boolean> {
  if (!userId) return snapshot
  try {
    const settings = await getRepositories().chatSettings.findByUserId(userId)
    const onDuty = readConciergeSettings(settings).enabled
    if (onDuty !== snapshot) {
      logger.info('Concierge on-duty switch changed since the request began', { userId, snapshot, current: onDuty })
    }
    return onDuty
  } catch (error) {
    logger.warn('Could not re-read the Concierge on-duty switch; using the snapshot', {
      userId,
      snapshot,
      error: getErrorMessage(error),
    })
    return snapshot
  }
}
