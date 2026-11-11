import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

/**
 * Pascal's Workbench — `/custom-tools`, which redirects into the tabbed
 * workspace's Workbench tab.
 *
 * Deep-linkable builder state rides the query string into the tab:
 *   `?mount=<mountPointId>&path=Tools/<file>` — open one definition to edit
 *   `?new=1&mount=<mountPointId>`            — create, destination preselected
 */
export default async function CustomToolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const mount = typeof params.mount === 'string' ? params.mount : undefined
  const path = typeof params.path === 'string' ? params.path : undefined
  const isNew = params.new === '1'

  return redirectToWorkspaceTab('custom-tools', { mount, path, new: isNew ? '1' : undefined })
}
