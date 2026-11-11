/**
 * Terminal Popout Route — redirects into the tabbed workspace: the intent opens
 * the conversation's Salon tab (the portal source for the live PTY) plus a
 * child terminal tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function TerminalPopoutPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>
}) {
  const { id, sessionId } = await params
  return redirectToWorkspaceTab('terminal', { chatId: id, sessionId })
}
