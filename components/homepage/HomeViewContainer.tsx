'use client'

/**
 * HomeViewContainer
 *
 * Client wrapper that fetches the home dashboard payload (via
 * `/api/v1/system/home`, backed by the shared `home-data.service`) and renders
 * {@link HomeView}. Used for the workspace home tab, where the surrounding route
 * is client-rendered. The legacy `/` route renders `HomeView` directly with
 * server-fetched data. See `docs/developer/features/complete/tabbed-workspace.md`.
 *
 * @module components/homepage/HomeViewContainer
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { HomeView, type HomeViewProps } from '@/components/homepage/HomeView'
import { useReportWorkspaceBackdrop } from '@/components/workspace/workspace-backdrop'
import { useDynamicBackground } from '@/hooks/useDynamicBackground'

type HomeData = HomeViewProps

export function HomeViewContainer() {
  const { data, isLoading, error } = useQuery<HomeData>({
    queryKey: queryKeys.home.all,
    queryFn: ({ signal }) => apiFetch<HomeData>('/api/v1/system/home', { signal }),
  })

  // The home tab has no background of its own; with dynamic backgrounds on,
  // the workspace backdrop paints the collage behind it, and HomeView marks
  // its root so the collage takes precedence over a theme's page background.
  const dynamicUrl = useDynamicBackground('home')
  useReportWorkspaceBackdrop(dynamicUrl, false)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="qt-text-muted text-sm">Setting the table…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="qt-text-destructive text-sm">
          The home parlour could not be readied just now.
        </p>
      </div>
    )
  }

  return (
    <HomeView
      displayName={data.displayName}
      lastChatId={data.lastChatId}
      recentChats={data.recentChats}
      projects={data.projects}
      characters={data.characters}
      backgroundUrl={dynamicUrl}
    />
  )
}
