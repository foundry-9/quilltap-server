/**
 * Projects Route (Prospero) — redirects into the tabbed workspace's Prospero tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function ProjectsPage() {
  return redirectToWorkspaceTab('prospero')
}
