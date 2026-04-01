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
import { BrandName } from '@/components/ui/brand-name'
import { ColorModeSelector } from './components/ColorModeSelector'

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
    <div className="space-y-8">
      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-800 dark:text-red-200">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Nav Theme Selector Toggle */}
      <section>
        <h2 className="text-xl font-semibold mb-2 text-foreground">Quick Theme Access</h2>
        <p className="text-muted-foreground mb-4">
          Show a theme selector dropdown in the navigation bar for quick theme switching.
        </p>

        <label
          className={`
          flex items-center justify-between gap-4 p-4 border rounded-lg transition-colors cursor-pointer
          ${showNavThemeSelector ? 'border-primary bg-accent' : 'border-border hover:bg-accent'}
          ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        >
          <div className="flex items-center gap-4">
            <div
              className={`
              flex-shrink-0 p-2 rounded-full
              ${showNavThemeSelector ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}
            `}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
                />
              </svg>
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
              ${showNavThemeSelector ? 'bg-primary' : 'bg-muted'}
              ${isLoading ? 'cursor-not-allowed' : ''}
            `}
          >
            <span
              className={`
                pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                transition duration-200 ease-in-out
                ${showNavThemeSelector ? 'translate-x-5' : 'translate-x-0'}
              `}
            />
          </button>
        </label>
      </section>

      {/* Color Mode Section */}
      <section>
        <h2 className="text-xl font-semibold mb-2 text-foreground">Color Mode</h2>
        <p className="text-muted-foreground mb-4">
          Choose how <BrandName /> should appear. You can select light mode, dark mode, or follow
          your system settings.
        </p>

        <ColorModeSelector
          value={colorMode}
          resolvedMode={resolvedColorMode}
          onChange={onColorModeChange}
          disabled={isLoading}
        />
      </section>
    </div>
  )
}
