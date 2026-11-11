/**
 * Profile Route — redirects into the tabbed workspace's Profile tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function ProfilePage() {
  return redirectToWorkspaceTab('profile')
}
