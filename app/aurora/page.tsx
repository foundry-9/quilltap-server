/**
 * Characters Route (Aurora) — redirects into the tabbed workspace's Aurora tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function CharactersPage() {
  return redirectToWorkspaceTab('aurora')
}
