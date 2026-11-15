/**
 * useThemePreview Hook
 *
 * Lazily loads a theme's compiled CSS, choices, icon overrides and preview
 * images when a preview is opened. Caches responses so the same theme is not
 * fetched twice.
 *
 * @module components/settings/appearance/hooks/useThemePreview
 */

import { useState, useCallback, useRef } from 'react'
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
  /** Fetch the theme (call when preview is opened) */
  fetchTokens: () => Promise<void>
  /** Clear the cached theme */
  clearCache: () => void
}

// Module-level cache for theme responses
const tokensCache = new Map<string, ThemeTokensResponse>()

/**
 * Hook for lazy loading a theme for preview
 *
 * @param themeId - The theme ID to load (null for the default theme, which needs no fetch)
 */
export function useThemePreview(themeId: string | null): UseThemePreviewResult {
  const [preview, setPreview] = useState<ThemePreviewCss | null>(null)
  const [icons, setIcons] = useState<{ name: string; src: string }[]>([])
  const [images, setImages] = useState<ThemePreviewImage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track active fetch to handle race conditions
  const fetchIdRef = useRef(0)

  const applyResponse = useCallback((data: ThemeTokensResponse) => {
    setPreview({ css: data.css, choices: data.choices || {} })
    setIcons(data.icons || [])
    setImages(data.images || [])
  }, [])

  const fetchTokens = useCallback(async () => {
    if (themeId === null) {
      return
    }

    const cached = tokensCache.get(themeId)
    if (cached) {
      applyResponse(cached)
      return
    }

    const currentFetchId = ++fetchIdRef.current

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/v1/themes/${encodeURIComponent(themeId)}?action=tokens`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to fetch theme: ${response.status}`)
      }

      const data: ThemeTokensResponse = await response.json()
      tokensCache.set(themeId, data)

      if (currentFetchId === fetchIdRef.current) {
        applyResponse(data)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load theme'
      console.error('useThemePreview: Failed to fetch theme', { themeId, error: message })
      if (currentFetchId === fetchIdRef.current) {
        setError(message)
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [themeId, applyResponse])

  const clearCache = useCallback(() => {
    if (themeId) {
      tokensCache.delete(themeId)
      setPreview(null)
      setIcons([])
      setImages([])
    }
  }, [themeId])

  return { preview, icons, images, isLoading, error, fetchTokens, clearCache }
}
