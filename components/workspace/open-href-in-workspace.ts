/**
 * openHrefInWorkspace — what "go to this href" means inside the workspace.
 *
 * The one place an in-app href becomes a tab: the delegated anchor handler
 * ({@link WorkspaceLinkInterceptor}) and the programmatic one
 * ({@link useWorkspaceNavigate}) both call it once they have decided they are
 * on the workspace surface. Returns `false` when the href has no tab
 * equivalent, so the caller lets the ordinary navigation happen.
 *
 * Beyond the tab itself: a Salon href's `?msg=` asks that chat to reveal a
 * message (a one-off request, not part of the tab), and — when the caller can
 * open the New Chat modal — a character href's `?action=chat` pops it with the
 * character preselected.
 *
 * @module components/workspace/open-href-in-workspace
 */

import type { WorkspaceContextValue } from '@/components/providers/workspace-provider'
import { characterChatActionFromHref, parseHrefToIntent } from '@/lib/navigation/route-to-intent'
import { requestMessageReveal, revealRequestFromSalonHref } from '@/lib/chat/message-navigation'

export function openHrefInWorkspace(
  href: string,
  openTab: WorkspaceContextValue['openTab'],
  openNewChat?: (options: { characterId?: string }) => void,
): boolean {
  const intent = parseHrefToIntent(href)
  if (!intent) return false
  openTab(intent.kind, intent.payload)
  if (openNewChat) {
    const chatCharacterId = characterChatActionFromHref(href)
    if (chatCharacterId) openNewChat({ characterId: chatCharacterId })
  }
  const reveal = revealRequestFromSalonHref(href)
  if (reveal) requestMessageReveal(reveal.chatId, reveal.messageId)
  return true
}
