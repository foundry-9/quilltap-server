/**
 * Settings Route (The Foundry)
 *
 * Thin wrapper around {@link SettingsView}. When the tabbed workspace is
 * enabled, redirects into it preserving the deep-link (`?group=`, `?section=`,
 * `?persona=`, `?q=`, and the legacy `?tab=`).
 * Otherwise renders the view, which reads those params off the URL itself.
 * See `docs/developer/features/complete/tabbed-workspace.md`.
 */

import { SettingsView } from './SettingsView'
import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; tab?: string; section?: string; persona?: string; q?: string; provider?: string }>
}) {
  const { group, tab, section, persona, q, provider } = await searchParams
  redirectToWorkspaceTab('settings', { group, tab, section, persona, q, provider })
  return <SettingsView />
}
