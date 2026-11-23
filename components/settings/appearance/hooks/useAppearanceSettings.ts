'use client'

/**
 * useAppearanceSettings Hook
 *
 * Custom hook for managing appearance settings state and theme/color mode changes.
 * Wraps theme provider functionality with logging and error handling.
 *
 * @module components/settings/appearance/hooks/useAppearanceSettings
 */

import { useTheme, type ThemeSummary } from '@/components/providers/theme-provider'
import type { ColorMode } from '@/lib/themes/types'
/**
 * Appearance settings state and handlers
 */
export interface AppearanceSettings {
  activeThemeId: string | null
  colorMode: ColorMode
  resolvedColorMode: 'light' | 'dark'
  availableThemes: ThemeSummary[]
  isLoading: boolean
  error: string | null
  handleThemeSelect: (themeId: string | null) => Promise<void>
  handleColorModeChange: (mode: ColorMode) => Promise<void>
  refreshThemes: () => Promise<void>
}

/**
 * Hook for managing appearance settings
 *
 * Provides theme and color mode management with logging.
 *
 * @returns {AppearanceSettings} Appearance settings state and handlers
 */
export function useAppearanceSettings(): AppearanceSettings {
  const {
    activeThemeId,
    colorMode,
    resolvedColorMode,
    setTheme,
    setColorMode,
    availableThemes,
    isLoading,
    error,
    refreshThemes,
  } = useTheme()

  // Ensure availableThemes is always an array
  const themes = Array.isArray(availableThemes) ? availableThemes : []

  /**
   * Handle theme selection with logging
   */
  const handleThemeSelect = async (themeId: string | null) => {
    await setTheme(themeId)
  }

  /**
   * Handle color mode change with logging
   */
  const handleColorModeChange = async (mode: ColorMode) => {
    await setColorMode(mode)
  }

  return {
    activeThemeId,
    colorMode,
    resolvedColorMode,
    availableThemes: themes,
    isLoading,
    error,
    handleThemeSelect,
    handleColorModeChange,
    refreshThemes,
  }
}
