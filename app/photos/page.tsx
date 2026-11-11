/**
 * Photos Route — redirects into the tabbed workspace's Photos tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function PhotosPage() {
  return redirectToWorkspaceTab('photos')
}
