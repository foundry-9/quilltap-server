/**
 * About Route — redirects into the tabbed workspace's About tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function AboutPage() {
  return redirectToWorkspaceTab('about')
}
