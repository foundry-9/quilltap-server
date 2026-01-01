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
import { DisplayOptions } from './DisplayOptions'
import { SidebarWidthControl } from './SidebarWidthControl'
import { ThemeSelector } from './ThemeSelector'
import { DebugThemeInfo } from './components/DebugThemeInfo'

/**
 * Renders a loading spinner
 */
function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="flex items-center gap-2 text-muted-foreground">
        <svg
          className="animate-spin h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span>Loading appearance settings...</span>
      </div>
    </div>
  )
}

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
    showNavThemeSelector,
    handleThemeSelect,
    handleColorModeChange,
    handleNavThemeSelectorChange,
  } = useAppearanceSettings()

  // Loading state
  if (isLoading) {
    return <LoadingSpinner />
  }

  return (
    <div className="space-y-8">
      {/* Display Options (Color Mode & Nav Selector) */}
      <DisplayOptions
        colorMode={colorMode}
        resolvedColorMode={resolvedColorMode}
        showNavThemeSelector={showNavThemeSelector}
        isLoading={isLoading}
        error={error}
        onColorModeChange={handleColorModeChange}
        onNavThemeSelectorChange={handleNavThemeSelectorChange}
      />

      {/* Sidebar Width */}
      <SidebarWidthControl />

      {/* Theme Selector */}
      <ThemeSelector
        activeThemeId={activeThemeId}
        availableThemes={availableThemes}
        isLoading={isLoading}
        onThemeSelect={handleThemeSelect}
      />

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
