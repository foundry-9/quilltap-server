import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

/**
 * Calliope's Atelier (the theme editor) — `/calliope`, which redirects into
 * the tabbed workspace's theme-editor tab. `?draft=<id>` opens that draft.
 */
export default async function CalliopePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const draft = typeof params.draft === 'string' ? params.draft : undefined
  return redirectToWorkspaceTab('theme-editor', { draft })
}
