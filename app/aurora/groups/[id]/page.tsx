/**
 * Group Editor Route — redirects into the tabbed workspace with the Aurora tab
 * drilled into this group's editor.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function GroupEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return redirectToWorkspaceTab('aurora', { groupId: id })
}
