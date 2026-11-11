/**
 * New Character Route — redirects into the tabbed workspace's new-character tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function NewCharacterPage() {
  return redirectToWorkspaceTab('character-new')
}
