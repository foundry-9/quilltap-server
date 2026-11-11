/**
 * Scriptorium Route — redirects into the tabbed workspace's Scriptorium tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function DocumentStoresPage() {
  return redirectToWorkspaceTab('scriptorium')
}
