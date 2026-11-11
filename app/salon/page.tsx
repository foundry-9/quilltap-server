/**
 * Chats Route (The Salon) — redirects into the tabbed workspace's chat list tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function ChatsPage() {
  return redirectToWorkspaceTab('salon-list')
}
