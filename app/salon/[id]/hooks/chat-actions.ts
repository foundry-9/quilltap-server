'use client'

/**
 * One spelling of a Salon call to `/api/v1/chats/:id?action=…`.
 *
 * Built on {@link apiFetch}, so a refusal throws an `ApiFetchError` whose
 * parsed body carries the server's `{ error }` sentence; callers read it with
 * `apiErrorMessage(err, fallback)` and keep their own toasts.
 *
 * @module app/salon/[id]/hooks/chat-actions
 */

import { apiFetch } from '@/lib/query/fetcher'

/**
 * Send `?action=<action>` to the chat. A `body` is sent as JSON; without one
 * the request carries no body at all.
 */
export function postChatAction<T = unknown>(
  chatId: string,
  action: string,
  body?: unknown,
  method: 'POST' | 'DELETE' = 'POST',
): Promise<T> {
  return apiFetch<T>(`/api/v1/chats/${chatId}?action=${action}`, body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
