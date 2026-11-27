'use client'

/**
 * Appearance Settings Tab
 *
 * Main component for managing theme and color mode preferences.
 * Part of the Phase 5 implementation of the theming plugin system.
 *
 * Features:
 * - Color mode selection (light/dark/system)
 * - Theme selection from available plugin themes
 * - Live preview of theme changes
 * - Quick theme access toggle
 *
 * @module components/settings/appearance
 */

import { useAppearanceSettings } from './hooks/useAppearanceSettings'
import { LoadingState } from '@/components/ui/LoadingState'
import { DisplayOptions } from './DisplayOptions'
import { ThemeSelector } from './ThemeSelector'
import { ThemeBrowser } from './components/ThemeBrowser'
import { DebugThemeInfo } from './components/DebugThemeInfo'

/**
 * Main appearance settings tab component
 */
export default function AppearanceTab() {
  const {
    activeThemeId,
    colorMode,
    resolvedColorMode,
    availableThemes,
    isLoading,
    error,
    handleThemeSelect,
    handleColorModeChange,
    refreshThemes,
  } = useAppearanceSettings()

  // Loading state
  if (isLoading) {
    return <LoadingState message="Loading appearance settings..." />
  }

  return (
    <div className="space-y-8">
      {/* Display Options */}
      <DisplayOptions
        colorMode={colorMode}
        resolvedColorMode={resolvedColorMode}
        error={error}
        onColorModeChange={handleColorModeChange}
      />

      {/* Theme Selector - full width with expandable previews */}
      <ThemeSelector
        activeThemeId={activeThemeId}
        availableThemes={availableThemes}
        onThemeSelect={handleThemeSelect}
        onRefreshThemes={refreshThemes}
      />

      {/* Theme Browser - browse and install from registries */}
      <ThemeBrowser onRefreshThemes={refreshThemes} />

      {/* Debug Info (development only) */}
      {process.env.NODE_ENV === 'development' && (
        <DebugThemeInfo
          activeThemeId={activeThemeId}
          colorMode={colorMode}
          resolvedColorMode={resolvedColorMode}
          themesCount={availableThemes.length}
        />
      )}
    </div>
  )
}
