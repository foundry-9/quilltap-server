/**
 * Salon Conversation Route
 *
 * Thin wrapper around {@link SalonView}; the conversation body — including the
 * SSE streaming hooks and virtualized message list, which must not be touched —
 * is extracted so it can also render kept-alive as a workspace tab. When the
 * tabbed workspace is enabled, this route redirects into it for the chat.
 * See `docs/developer/features/complete/tabbed-workspace.md`.
 */

import { SalonView } from './SalonView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ msg?: string | string[] }>
}) {
  const { id } = await params
  // `?msg=<messageId>` — a Message search result: open scrolled to that message.
  const { msg } = await searchParams
  const revealMessageId = typeof msg === 'string' && msg ? msg : undefined
  redirectToWorkspaceTab('salon', { chatId: id, msg: revealMessageId })
  return <SalonView chatId={id} revealMessageId={revealMessageId} />
}
