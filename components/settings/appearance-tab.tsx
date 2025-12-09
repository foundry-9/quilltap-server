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
import { BrandName } from '@/components/ui/brand-name'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'

// Default theme preview colors (from DEFAULT_THEME_TOKENS)
const DEFAULT_PREVIEW_COLORS = {
  light: {
    background: DEFAULT_THEME_TOKENS.colors.light.background,
    primary: DEFAULT_THEME_TOKENS.colors.light.primary,
    secondary: DEFAULT_THEME_TOKENS.colors.light.secondary,
    accent: DEFAULT_THEME_TOKENS.colors.light.accent,
  },
  dark: {
    background: DEFAULT_THEME_TOKENS.colors.dark.background,
    primary: DEFAULT_THEME_TOKENS.colors.dark.primary,
    secondary: DEFAULT_THEME_TOKENS.colors.dark.secondary,
    accent: DEFAULT_THEME_TOKENS.colors.dark.accent,
  },
}

// ============================================================================
// THEME PREVIEW SWATCHES
// ============================================================================

interface PreviewColors {
  light: { background: string; primary: string; secondary: string; accent: string };
  dark: { background: string; primary: string; secondary: string; accent: string };
}

/**
 * Renders color swatches showing the theme's actual colors.
 * Shows both light and dark mode colors side by side.
 */
function ThemePreviewSwatches({ previewColors }: { previewColors?: PreviewColors }) {
  // Fall back to default colors if not provided
  const colors = previewColors || DEFAULT_PREVIEW_COLORS

  return (
    <div className="w-full h-full flex">
      {/* Light mode colors (top half) and dark mode colors (bottom half) */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1" style={{ backgroundColor: colors.light.background }} />
        <div className="flex-1" style={{ backgroundColor: colors.dark.background }} />
      </div>
      <div className="flex-1 flex flex-col">
        <div className="flex-1" style={{ backgroundColor: colors.light.secondary }} />
        <div className="flex-1" style={{ backgroundColor: colors.dark.secondary }} />
      </div>
      <div className="flex-1 flex flex-col">
        <div className="flex-1" style={{ backgroundColor: colors.light.primary }} />
        <div className="flex-1" style={{ backgroundColor: colors.dark.primary }} />
      </div>
    </div>
  )
}

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
    ? <>The default <BrandName /> theme with a clean, professional appearance</>
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
            ? 'border-primary bg-accent'
            : 'border-border hover:border-input'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      {/* Theme Preview */}
      <div className="w-full h-20 rounded-md mb-3 overflow-hidden border border-border">
        {theme?.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={theme.preview}
            alt={`${name} theme preview`}
            className="w-full h-full object-cover"
          />
        ) : (
          // Theme preview using actual theme colors
          <ThemePreviewSwatches
            previewColors={isDefault ? DEFAULT_PREVIEW_COLORS : theme?.previewColors}
          />
        )}
      </div>

      {/* Theme Name */}
      <div className="font-medium text-foreground">{name}</div>

      {/* Theme Description */}
      {description && (
        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {description}
        </div>
      )}

      {/* Dark Mode Support Badge */}
      {!isDefault && theme.supportsDarkMode && (
        <div className="mt-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
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
            className="w-5 h-5 text-primary"
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
                ? 'border-primary bg-accent'
                : 'border-border hover:bg-accent'
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
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }
          `}
          >
            {option.icon}
          </div>

          {/* Label and Description */}
          <div className="flex-1">
            <div className="font-medium text-foreground">{option.label}</div>
            <div className="text-sm text-muted-foreground">
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
                className="w-5 h-5 text-primary"
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
        <h2 className="text-xl font-semibold mb-2 text-foreground">Color Mode</h2>
        <p className="text-muted-foreground mb-4">
          Choose how <BrandName /> should appear. You can select light mode, dark mode, or follow your
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
      <section className="border-t border-border pt-8">
        <h2 className="text-xl font-semibold mb-2 text-foreground">Theme</h2>
        <p className="text-muted-foreground mb-4">
          Select a theme to customize the colors and appearance of <BrandName />.
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
          <div className="mt-4 p-4 bg-accent rounded-lg border border-border">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5"
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
                <p className="text-sm text-muted-foreground">
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
        <section className="border-t border-border pt-8">
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Debug: Current Theme State
            </summary>
            <div className="mt-2 p-3 bg-muted rounded-lg font-mono text-xs space-y-2">
              <div>Active Theme ID: {activeThemeId ?? 'default'}</div>
              <div>Color Mode: {colorMode}</div>
              <div>Resolved Mode: {resolvedColorMode}</div>
              <div>Available Themes: {themes.length}</div>

              {/* Visual test: These boxes use CSS variables directly */}
              <div className="mt-4 pt-4 border-t border-border">
                <div className="text-xs font-semibold mb-2">CSS Variable Test (should change with theme):</div>
                <div className="flex gap-2">
                  <div
                    className="w-12 h-12 rounded border"
                    style={{ backgroundColor: 'var(--theme-background)' }}
                    title="--theme-background"
                  />
                  <div
                    className="w-12 h-12 rounded border"
                    style={{ backgroundColor: 'var(--theme-primary)' }}
                    title="--theme-primary"
                  />
                  <div
                    className="w-12 h-12 rounded border"
                    style={{ backgroundColor: 'var(--theme-secondary)' }}
                    title="--theme-secondary"
                  />
                  <div
                    className="w-12 h-12 rounded border"
                    style={{ backgroundColor: 'var(--theme-accent)' }}
                    title="--theme-accent"
                  />
                </div>
                <div className="text-xs mt-1 text-muted-foreground">
                  bg / primary / secondary / accent
                </div>
              </div>
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
