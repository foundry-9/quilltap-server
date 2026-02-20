/**
 * useThemePreview Hook
 *
 * Hook for lazy loading theme tokens from the API when a preview is opened.
 * Caches responses to avoid re-fetching the same theme multiple times.
 *
 * @module components/settings/appearance/hooks/useThemePreview
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ThemeTokens } from '@/lib/themes/types'
import type { ThemeFont } from '@/components/providers/theme/types'

/**
 * Response from the theme tokens API
 */
interface ThemeTokensResponse {
  tokens: ThemeTokens
  fonts?: ThemeFont[]
  cssOverrides?: string
}

/**
 * Return value from the useThemePreview hook
 */
export interface UseThemePreviewResult {
  /** The loaded theme tokens */
  tokens: ThemeTokens | null
  /** Custom fonts for the theme */
  fonts: ThemeFont[]
  /** CSS overrides from the theme */
  cssOverrides: string | null
  /** Whether the theme is currently loading */
  isLoading: boolean
  /** Any error that occurred during loading */
  error: string | null
  /** Fetch the theme tokens (call when preview is opened) */
  fetchTokens: () => Promise<void>
  /** Clear the cached tokens */
  clearCache: () => void
}

// Module-level cache for theme tokens
const tokensCache = new Map<string, ThemeTokensResponse>()

/**
 * Hook for lazy loading theme tokens for preview
 *
 * @param themeId - The theme ID to load tokens for (null for default theme)
 * @returns Object with tokens, fonts, cssOverrides, loading state, error, and fetch function
 */
export function useThemePreview(themeId: string | null): UseThemePreviewResult {
  const [tokens, setTokens] = useState<ThemeTokens | null>(null)
  const [fonts, setFonts] = useState<ThemeFont[]>([])
  const [cssOverrides, setCssOverrides] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track active fetch to handle race conditions
  const fetchIdRef = useRef(0)

  const fetchTokens = useCallback(async () => {
    // For default theme, we don't need to fetch - the tokens will be provided directly
    if (themeId === null) {
      return
    }

    // Check cache first
    const cached = tokensCache.get(themeId)
    if (cached) {
      setTokens(cached.tokens)
      setFonts(cached.fonts || [])
      setCssOverrides(cached.cssOverrides || null)
      return
    }

    // Increment fetch ID to track this specific fetch
    const currentFetchId = ++fetchIdRef.current

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/v1/themes/${themeId}?action=tokens`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to fetch theme: ${response.status}`)
      }

      const data: ThemeTokensResponse = await response.json()

      // Cache the response
      tokensCache.set(themeId, data)

      // Only update state if this is still the most recent fetch
      if (currentFetchId === fetchIdRef.current) {
        setTokens(data.tokens)
        setFonts(data.fonts || [])
        setCssOverrides(data.cssOverrides || null)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load theme'
      console.error('useThemePreview: Failed to fetch tokens', { themeId, error: message })
      if (currentFetchId === fetchIdRef.current) {
        setError(message)
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [themeId])

  const clearCache = useCallback(() => {
    if (themeId) {
      tokensCache.delete(themeId)
      setTokens(null)
      setFonts([])
      setCssOverrides(null)
    }
  }, [themeId])

  return {
    tokens,
    fonts,
    cssOverrides,
    isLoading,
    error,
    fetchTokens,
    clearCache,
  }
}
