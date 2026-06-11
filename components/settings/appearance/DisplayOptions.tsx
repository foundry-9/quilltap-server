'use client'

/**
 * Display Options Component
 *
 * Manages display-related settings including:
 * - Color mode (light/dark/system)
 * - Navigation theme selector visibility
 *
 * @module components/settings/appearance/DisplayOptions
 */

import type { ColorMode } from '@/lib/themes/types'
import { SettingsCard } from '@/components/ui/SettingsCard'
import { ColorModeSelector } from './components/ColorModeSelector'
import { Icon } from '@/components/ui/icon'

interface DisplayOptionsProps {
  colorMode: ColorMode
  resolvedColorMode: 'light' | 'dark'
  showNavThemeSelector: boolean
  isLoading?: boolean
  error?: string | null
  onColorModeChange: (mode: ColorMode) => void
  onNavThemeSelectorChange: (show: boolean) => void
}

/**
 * Renders display options section including color mode and nav theme selector toggle
 */
export function DisplayOptions({
  colorMode,
  resolvedColorMode,
  showNavThemeSelector,
  isLoading = false,
  error = null,
  onColorModeChange,
  onNavThemeSelectorChange,
}: DisplayOptionsProps) {
  return (
    <>
      {/* Error Display */}
      {error && (
        <div className="qt-alert-error mb-4 flex items-center gap-2">
          <Icon name="alert-circle" className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Nav Theme Selector Toggle */}
      <SettingsCard
        title="Quick Theme Access"
        subtitle="Show a theme selector dropdown in the navigation bar for quick theme switching."
      >
        <label
          className={`
          flex items-center justify-between gap-4 p-4 border rounded-lg transition-colors cursor-pointer
          ${showNavThemeSelector ? 'qt-border-primary qt-bg-primary/10' : 'qt-border-default qt-hover-accent'}
          ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        >
          <div className="flex items-center gap-4">
            <div
              className={`
              flex-shrink-0 p-2 rounded-full
              ${showNavThemeSelector ? 'qt-bg-primary/10 text-primary' : 'qt-bg-muted qt-text-secondary'}
            `}
            >
              <Icon name="themes" className="w-5 h-5" />
            </div>
            <div>
              <div className="qt-text-primary">Show theme selector in navigation</div>
              <div className="qt-text-small">
                Quickly switch themes from the navigation bar
              </div>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showNavThemeSelector}
            disabled={isLoading}
            onClick={() => !isLoading && onNavThemeSelectorChange(!showNavThemeSelector)}
            className={`
              relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
              transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
              ${showNavThemeSelector ? 'bg-primary' : 'qt-bg-muted'}
              ${isLoading ? 'cursor-not-allowed' : ''}
            `}
          >
            <span
              className={`
                pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0
                transition duration-200 ease-in-out
                ${showNavThemeSelector ? 'translate-x-5' : 'translate-x-0'}
              `}
            />
          </button>
        </label>
      </SettingsCard>

      {/* Color Mode Section */}
      <SettingsCard
        title="Color Mode"
        subtitle="Choose how Quilltap should appear. You can select light mode, dark mode, or follow your system settings."
      >
        <ColorModeSelector
          value={colorMode}
          resolvedMode={resolvedColorMode}
          onChange={onColorModeChange}
          disabled={isLoading}
        />
      </SettingsCard>
    </>
  )
}
