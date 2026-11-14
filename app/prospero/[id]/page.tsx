/**
 * Project Detail Route — redirects into the tabbed workspace with the Prospero
 * tab drilled into this project.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return redirectToWorkspaceTab('prospero', { projectId: id })
}
