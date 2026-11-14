/**
 * Salon Conversation Route — redirects into the tabbed workspace's tab for the
 * chat, carrying `?msg=` (a Message search result: open scrolled to it).
 */

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
  return redirectToWorkspaceTab('salon', { chatId: id, msg: revealMessageId })
}
