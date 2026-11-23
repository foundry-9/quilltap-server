import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

/**
 * Calliope's specimen gallery — `/calliope/specimens`, which redirects into
 * the tabbed workspace's theme-specimens tab.
 */
export default function CalliopeSpecimensPage() {
  return redirectToWorkspaceTab('theme-specimens')
}
