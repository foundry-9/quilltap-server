/**
 * Profile Route — thin wrapper around {@link ProfileView}. When the tabbed
 * workspace is enabled, redirects into it; otherwise renders the view.
 * See `docs/developer/features/complete/tabbed-workspace.md`.
 */

import { ProfileView } from './ProfileView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function ProfilePage() {
  redirectToWorkspaceTab('profile')
  return <ProfileView />
}
