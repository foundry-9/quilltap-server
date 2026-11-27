/**
 * useThemePreview Hook
 *
 * Loads a theme's compiled CSS, choices, icon overrides and preview images
 * while its preview is open. The response is held in the query cache under
 * `queryKeys.themes.tokens(id)`, so reopening a preview shows it at once.
 *
 * @module components/settings/appearance/hooks/useThemePreview
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { ThemePreviewImage } from '@/lib/themes/types'
import type { ThemeTokensResponse as ApiThemeTokensResponse } from '@/components/providers/theme/types'

/** Response from the theme tokens API, plus the images list. */
type ThemeTokensResponse = ApiThemeTokensResponse & { images?: ThemePreviewImage[] }

/** A theme's compiled CSS and choices, for ThemePreviewPanel. */
export interface ThemePreviewCss {
  css: string
  choices: Record<string, string>
}

/** Return value from the useThemePreview hook */
export interface UseThemePreviewResult {
  /** The compiled theme (null until loaded, and for the default theme) */
  preview: ThemePreviewCss | null
  /** Icon overrides for the theme */
  icons: { name: string; src: string }[]
  /** Preview images for the theme */
  images: ThemePreviewImage[]
  /** Whether the theme is currently loading */
  isLoading: boolean
  /** Any error that occurred during loading */
  error: string | null
}

const NO_ICONS: { name: string; src: string }[] = []
const NO_IMAGES: ThemePreviewImage[] = []

/**
 * Load a theme for preview.
 *
 * @param themeId - The theme to load (null for the default theme, which needs no fetch)
 * @param enabled - Whether the preview is open
 */
export function useThemePreview(themeId: string | null, enabled: boolean): UseThemePreviewResult {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.themes.tokens(themeId ?? ''),
    queryFn: ({ signal }) =>
      apiFetch<ThemeTokensResponse>(`/api/v1/themes/${encodeURIComponent(themeId ?? '')}?action=tokens`, { signal }),
    enabled: enabled && themeId !== null,
  })

  const preview = useMemo(
    () => (data ? { css: data.css, choices: data.choices || {} } : null),
    [data],
  )

  return {
    preview,
    icons: data?.icons ?? NO_ICONS,
    images: data?.images ?? NO_IMAGES,
    isLoading,
    error: error ? apiErrorMessage(error, 'Failed to load theme') : null,
  }
}
