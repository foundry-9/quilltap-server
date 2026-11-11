/**
 * The one way the client patches fields on a chat row.
 *
 * `PUT /api/v1/chats/:id` with a `{ chat: { … } }` body. Every optimistic
 * toggle in the Salon, the sidebar's clock switch, the project-move dialog and
 * the Document/Terminal-mode layout persisters all send the same request; this
 * is the single spelling of it. Built on {@link apiFetch}, so a non-2xx
 * answer throws an {@link ApiFetchError} carrying `status` and the parsed
 * `{ error }` body — callers keep their own rollback and toast policy.
 *
 * CLIENT-SAFE: no runtime imports beyond the fetcher (the schema imports are
 * type-only). In a component, use `usePatchChat` (`use-patch-chat.ts`), which
 * adds the cache refresh and the toasts.
 *
 * @module lib/chat/patch-chat
 */

import { apiFetch } from '@/lib/query/fetcher'
import type { z } from 'zod'
import type { chatUpdateRequestSchema, updateChatSchema } from '@/app/api/v1/chats/[id]/schemas'

/** Fields accepted under the `chat` key of the update request. */
export type ChatPatch = z.input<typeof updateChatSchema>

/**
 * The whole `PUT /api/v1/chats/:id` body. The route's schema is strict: a
 * field at the wrong level is a 400, never a silent strip (#176).
 */
export type ChatUpdateRequest = z.input<typeof chatUpdateRequestSchema>

/**
 * Send one update request. `patchChat` is the common case (`{ chat }`); the
 * request form also carries the top-level writes — `roleplayTemplateId` and
 * `imageProfileId` (checked against their tables), `conciergeState`,
 * `turnMode` and the participant edits.
 */
export async function putChatUpdate<T = unknown>(chatId: string, request: ChatUpdateRequest): Promise<T> {
  return apiFetch<T>(`/api/v1/chats/${chatId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

/**
 * Persist `updates` onto the chat. Resolves with the route's JSON body on
 * success; rejects with an {@link ApiFetchError} (server refusal) or the
 * underlying fetch error (network fault).
 */
export async function patchChat<T = unknown>(chatId: string, updates: ChatPatch): Promise<T> {
  return putChatUpdate<T>(chatId, { chat: updates })
}
