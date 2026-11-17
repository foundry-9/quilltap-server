'use client'

/**
 * The page's dynamic background — the URL of a server-composed collage, or
 * null when the feature is off, the pool is below the floor, or the view is
 * not on screen. Callers put it first in the expression that already picks
 * their background, so null leaves today's background in place.
 *
 * - The switch, uncensored allowance and interval come from the one
 *   chat-settings query (narrowed with `select`).
 * - Only the visible workspace tab asks: a kept-alive tab in the background
 *   composes nothing.
 * - A new URL is preloaded before it is returned; the previous one stays up
 *   meanwhile, and stays if the new one fails — no blank frame on refresh.
 *
 * @module hooks/useDynamicBackground
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { useWorkspaceTabVisible } from '@/components/workspace/workspace-tab-context'
import { DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS, type DynamicBackgroundsSettings } from '@/lib/schemas/settings.types'

export type DynamicBackgroundScope = 'home' | 'project' | 'character'
type Orientation = 'landscape' | 'portrait'

interface CollageStatus {
  enabled: boolean
  available: boolean
  count: number
  refreshMinutes: number
  url: string | null
}

const RESIZE_DEBOUNCE_MS = 250

function currentOrientation(): Orientation {
  if (typeof window === 'undefined') return 'landscape'
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait'
}

/** Landscape or portrait, re-read on a debounced resize that crosses the boundary. */
function useOrientation(): Orientation {
  const [orientation, setOrientation] = useState<Orientation>(currentOrientation)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setOrientation(currentOrientation()), RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return orientation
}

function selectDynamicBackgrounds(settings: { dynamicBackgrounds?: Partial<DynamicBackgroundsSettings> }): DynamicBackgroundsSettings {
  return { ...DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS, ...settings.dynamicBackgrounds }
}

/** Hold a URL back until it has loaded; keep the last good one meanwhile and on failure. */
function usePreloadedUrl(next: string | null, active: boolean): string | null {
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (!active || !next || next === shown) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setShown(next)
    }
    img.onerror = () => {
      // Keep whatever is already up.
    }
    img.src = next
    return () => {
      cancelled = true
      img.onload = null
      img.onerror = null
    }
  }, [next, active, shown])
  return active ? shown : null
}

export function useDynamicBackground(scope: 'home'): string | null
export function useDynamicBackground(scope: 'project' | 'character', id: string): string | null
export function useDynamicBackground(scope: DynamicBackgroundScope, id?: string): string | null {
  const { data: settings } = useChatSettingsQuery(selectDynamicBackgrounds)
  const visible = useWorkspaceTabVisible()
  const orientation = useOrientation()

  const enabled = !!settings?.enabled && visible && (scope === 'home' || !!id)
  const refreshMinutes = settings?.refreshMinutes ?? DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS.refreshMinutes
  const intervalMs = refreshMinutes * 60_000

  const params = new URLSearchParams({ scope, orientation })
  if (scope !== 'home' && id) params.set('id', id)

  const { data } = useQuery<CollageStatus>({
    queryKey: queryKeys.dynamicBackgrounds.status(scope, scope === 'home' ? null : id ?? null, orientation, {
      allowUncensored: settings?.allowUncensored ?? false,
      refreshMinutes,
    }),
    queryFn: ({ signal }) => apiFetch<CollageStatus>(`/api/v1/system/dynamic-backgrounds?${params.toString()}`, { signal }),
    enabled,
    // A rotation timer, not a poll for server changes: each fetch mints a new
    // seed, so each tick is a new collage. No realtime topic stands in for it.
    refetchInterval: enabled ? intervalMs : false,
    refetchIntervalInBackground: false,
    staleTime: intervalMs,
    refetchOnWindowFocus: false,
  })

  const nextUrl = enabled && data?.enabled && data.available ? data.url : null
  // Turning the feature off (or leaving the screen) returns null at once.
  return usePreloadedUrl(nextUrl, enabled && !!data?.available)
}
