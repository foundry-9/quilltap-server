'use client'

/**
 * Appearance Settings Tab
 *
 * Provides UI for managing theme and color mode preferences.
 * Part of the Phase 5 implementation of the theming plugin system.
 *
 * Features:
 * - Color mode selection (light/dark/system)
 * - Theme selection from available plugin themes
 * - Live preview of theme changes
 *
 * @module components/settings/appearance-tab
 */

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useTheme, type ThemeSummary } from '@/components/providers/theme-provider'
import type { ColorMode } from '@/lib/themes/types'

// ============================================================================
// COLOR MODE OPTIONS
// ============================================================================

interface ColorModeOption {
  value: ColorMode
  label: string
  description: string
  icon: React.ReactNode
}

const COLOR_MODE_OPTIONS: ColorModeOption[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Always use light mode',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use dark mode',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow your system settings',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
  },
]

// ============================================================================
// THEME CARD COMPONENT
// ============================================================================

interface ThemeCardProps {
  theme: ThemeSummary | null // null = default theme
  isActive: boolean
  onSelect: () => void
  disabled?: boolean
}

function ThemeCard({ theme, isActive, onSelect, disabled }: ThemeCardProps) {
  const isDefault = theme === null
  const name = isDefault ? 'Default' : theme.name
  const description = isDefault
    ? 'The default Quilltap theme with a clean, professional appearance'
    : theme.description

  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('ThemeCard: rendered', {
      themeId: isDefault ? 'default' : theme?.id,
      isActive,
      disabled,
    })
  }, [isDefault, theme?.id, isActive, disabled])

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`
        relative flex flex-col items-start p-4 rounded-lg border-2 transition-all
        text-left w-full
        ${
          isActive
            ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {/* Theme Preview */}
      <div className="w-full h-20 rounded-md mb-3 overflow-hidden border border-gray-200 dark:border-slate-600">
        {theme?.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={theme.preview}
            alt={`${name} theme preview`}
            className="w-full h-full object-cover"
          />
        ) : (
          // Default theme preview - color swatches
          <div className="w-full h-full flex">
            <div className="flex-1 bg-white dark:bg-slate-900" />
            <div className="flex-1 bg-slate-100 dark:bg-slate-800" />
            <div className="flex-1 bg-slate-200 dark:bg-slate-700" />
            <div className="flex-1 bg-blue-500 dark:bg-blue-400" />
          </div>
        )}
      </div>

      {/* Theme Name */}
      <div className="font-medium text-gray-900 dark:text-white">{name}</div>

      {/* Theme Description */}
      {description && (
        <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
          {description}
        </div>
      )}

      {/* Dark Mode Support Badge */}
      {!isDefault && theme.supportsDarkMode && (
        <div className="mt-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300">
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
            Dark mode
          </span>
        </div>
      )}

      {/* Active Indicator */}
      {isActive && (
        <div className="absolute top-2 right-2">
          <svg
            className="w-5 h-5 text-blue-500 dark:text-blue-400"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  )
}

// ============================================================================
// COLOR MODE SELECTOR COMPONENT
// ============================================================================

interface ColorModeSelectorProps {
  value: ColorMode
  resolvedMode: 'light' | 'dark'
  onChange: (mode: ColorMode) => void
  disabled?: boolean
}

function ColorModeSelector({
  value,
  resolvedMode,
  onChange,
  disabled,
}: ColorModeSelectorProps) {
  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('ColorModeSelector: rendered', {
      value,
      resolvedMode,
      disabled,
    })
  }, [value, resolvedMode, disabled])

  return (
    <div className="space-y-3">
      {COLOR_MODE_OPTIONS.map((option) => (
        <label
          key={option.value}
          className={`
            flex items-center gap-4 p-4 border rounded-lg transition-colors
            ${
              value === option.value
                ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <input
            type="radio"
            name="colorMode"
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              if (!disabled) {
                clientLogger.debug('ColorModeSelector: mode selected', {
                  mode: option.value,
                })
                onChange(option.value)
              }
            }}
            disabled={disabled}
            className="sr-only"
          />

          {/* Icon */}
          <div
            className={`
            flex-shrink-0 p-2 rounded-full
            ${
              value === option.value
                ? 'bg-blue-100 dark:bg-blue-800 text-blue-600 dark:text-blue-300'
                : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400'
            }
          `}
          >
            {option.icon}
          </div>

          {/* Label and Description */}
          <div className="flex-1">
            <div className="font-medium text-gray-900 dark:text-white">{option.label}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {option.description}
              {option.value === 'system' && (
                <span className="ml-1 text-xs">
                  (currently {resolvedMode})
                </span>
              )}
            </div>
          </div>

          {/* Selected Indicator */}
          {value === option.value && (
            <div className="flex-shrink-0">
              <svg
                className="w-5 h-5 text-blue-500 dark:text-blue-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          )}
        </label>
      ))}
    </div>
  )
}

// ============================================================================
// MAIN APPEARANCE TAB COMPONENT
// ============================================================================

export default function AppearanceTab() {
  const {
    activeThemeId,
    colorMode,
    resolvedColorMode,
    setTheme,
    setColorMode,
    availableThemes,
    isLoading,
    error,
  } = useTheme()

  // Ensure availableThemes is always an array
  const themes = Array.isArray(availableThemes) ? availableThemes : []

  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('AppearanceTab: rendered', {
      activeThemeId,
      colorMode,
      resolvedColorMode,
      themesCount: themes.length,
      isLoading,
      error,
    })
  }, [activeThemeId, colorMode, resolvedColorMode, themes.length, isLoading, error])

  // Handle theme selection
  const handleThemeSelect = async (themeId: string | null) => {
    clientLogger.info('AppearanceTab: selecting theme', { themeId })
    await setTheme(themeId)
  }

  // Handle color mode change
  const handleColorModeChange = async (mode: ColorMode) => {
    clientLogger.info('AppearanceTab: changing color mode', { mode })
    await setColorMode(mode)
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
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

  return (
    <div className="space-y-8">
      {/* Error Display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-800 dark:text-red-200">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      {/* Color Mode Section */}
      <section>
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Color Mode</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Choose how Quilltap should appear. You can select light mode, dark mode, or follow your
          system settings.
        </p>

        <ColorModeSelector
          value={colorMode}
          resolvedMode={resolvedColorMode}
          onChange={handleColorModeChange}
          disabled={isLoading}
        />
      </section>

      {/* Theme Selection Section */}
      <section className="border-t border-gray-200 dark:border-slate-700 pt-8">
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">Theme</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Select a theme to customize the colors and appearance of Quilltap.
          {themes.length === 0 && (
            <span className="block mt-1 text-sm">
              Install theme plugins to see more options here.
            </span>
          )}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Default Theme Card */}
          <ThemeCard
            theme={null}
            isActive={activeThemeId === null}
            onSelect={() => handleThemeSelect(null)}
            disabled={isLoading}
          />

          {/* Plugin Theme Cards */}
          {themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              isActive={activeThemeId === theme.id}
              onSelect={() => handleThemeSelect(theme.id)}
              disabled={isLoading}
            />
          ))}
        </div>

        {/* Hint about theme plugins */}
        {themes.length === 0 && (
          <div className="mt-4 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Additional themes can be added by installing theme plugins from the{' '}
                  <span className="font-medium">Plugins</span> tab.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Current Theme Info (Debug Section - only in development) */}
      {process.env.NODE_ENV === 'development' && (
        <section className="border-t border-gray-200 dark:border-slate-700 pt-8">
          <details className="text-sm">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              Debug: Current Theme State
            </summary>
            <div className="mt-2 p-3 bg-gray-50 dark:bg-slate-800 rounded-lg font-mono text-xs">
              <div>Active Theme ID: {activeThemeId ?? 'default'}</div>
              <div>Color Mode: {colorMode}</div>
              <div>Resolved Mode: {resolvedColorMode}</div>
              <div>Available Themes: {themes.length}</div>
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
