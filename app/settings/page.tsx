/**
 * Settings Route (The Foundry) — redirects into the tabbed workspace's Settings
 * tab, preserving the deep-link (`?group=`, `?section=`, `?persona=`, `?q=`,
 * `?provider=`, and the legacy `?tab=`).
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; tab?: string; section?: string; persona?: string; q?: string; provider?: string }>
}) {
  const { group, tab, section, persona, q, provider } = await searchParams
  return redirectToWorkspaceTab('settings', { group, tab, section, persona, q, provider })
}
