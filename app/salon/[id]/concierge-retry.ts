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

/**
 * The toast for a retry request that never opened: the Concierge's reason on a
 * 409, else the server's `error`, else `fallback`.
 */
export async function describeRetryFailure(res: Response, fallback: string): Promise<string> {
  const info = await res.json().catch(() => null) as { error?: unknown } | null
  const refusal = res.status === 409 ? describeRetryRefusal(info?.error) : null
  return refusal || (info?.error as string | undefined) || fallback
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
