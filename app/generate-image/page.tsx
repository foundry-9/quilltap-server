/**
 * Generate Image Route — redirects into the tabbed workspace's image tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function GenerateImagePage() {
  return redirectToWorkspaceTab('generate-image')
}
