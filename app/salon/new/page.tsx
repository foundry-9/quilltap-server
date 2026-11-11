/**
 * New Chat Route — redirects into the tabbed workspace with an `open=new-chat`
 * intent (the workspace pops the new-chat modal, carrying the
 * project/character/autonomous deep-links).
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const projectId = typeof sp.projectId === 'string' ? sp.projectId : undefined
  const characterId = typeof sp.characterId === 'string' ? sp.characterId : undefined
  const autonomous = sp.autonomous === '1' ? '1' : undefined
  return redirectToWorkspaceTab('new-chat', { projectId, characterId, autonomous })
}
