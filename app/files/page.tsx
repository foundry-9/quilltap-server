/**
 * Files Route — redirects into the tabbed workspace's Files tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function FilesPage() {
  return redirectToWorkspaceTab('files')
}
