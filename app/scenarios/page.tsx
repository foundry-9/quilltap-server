/**
 * Scenarios Route — redirects into the tabbed workspace's Scenarios tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function GeneralScenariosPage() {
  return redirectToWorkspaceTab('scenarios')
}
