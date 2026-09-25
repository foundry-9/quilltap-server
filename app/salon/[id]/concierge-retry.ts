/**
 * "Try uncensored" — client-side helpers shared by the text and picture
 * retries (the server half is `lib/services/dangerous-content/retry-uncensored.ts`).
 *
 * Pure and client-safe.
 */

import type { Message } from './types'

/** The endpoint that re-rolls an assistant line on the uncensored desk, narrated. */
export function retryUncensoredTurnUrl(chatId: string, messageId: string): string {
  return `/api/v1/chats/${chatId}/messages/${messageId}?action=retry-uncensored&stream=1`
}

/**
 * The operator-facing sentence for a refused retry (HTTP 409), or null when the
 * body names no reason we know.
 */
export function describeRetryRefusal(error: unknown): string | null {
  switch (error) {
    case 'no-understudy':
      return 'There is no uncensored desk to send this to — appoint one under Settings → The Concierge.'
    case 'locked':
      return 'This conversation is Locked to the usual desks; set it to Moderated should you wish the Concierge to take things elsewhere.'
    default:
      return null
  }
}

/** Whether a row is the Lantern's report that its painter refused the backdrop. */
export function isLanternBackgroundRefusal(message: Pick<Message, 'systemSender' | 'systemKind'>): boolean {
  return message.systemSender === 'lantern' && message.systemKind === 'background-refused'
}

/** The retry callbacks the transcript offers; absent on a Locked chat. */
export interface ConciergeRetryHandlers {
  onRetryTurn: (messageId: string) => void
  onRetryPicture: (toolMessageId: string) => void
  onRetryBackground: () => void
}
