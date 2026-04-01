'use client'

/**
 * Theme Selector Component
 *
 * Displays available themes as selectable cards with previews.
 * Includes default theme and plugin-provided themes.
 *
 * @module components/settings/appearance/ThemeSelector
 */

import { useEffect } from 'react'
import type { ThemeSummary } from '@/components/providers/theme-provider'
import { BrandName } from '@/components/ui/brand-name'
import { clientLogger } from '@/lib/client-logger'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'
import { ThemeCard } from './components/ThemeCard'

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

interface ThemeSelectorProps {
  activeThemeId: string | null
  availableThemes: ThemeSummary[]
  isLoading?: boolean
  onThemeSelect: (themeId: string | null) => void
}

/**
 * Renders the theme selector section with theme cards
 */
export function ThemeSelector({
  activeThemeId,
  availableThemes,
  isLoading = false,
  onThemeSelect,
}: ThemeSelectorProps) {
  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('ThemeSelector: rendered', {
      activeThemeId,
      themesCount: availableThemes.length,
      isLoading,
    })
  }, [activeThemeId, availableThemes.length, isLoading])

  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-xl font-semibold mb-2 text-foreground">Theme</h2>
      <p className="text-muted-foreground mb-4">
        Select a theme to customize the colors and appearance of <BrandName />.
        {availableThemes.length === 0 && (
          <span className="block mt-1 qt-text-small">
            Install theme plugins to see more options here.
          </span>
        )}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Default Theme Card */}
        <ThemeCard
          theme={null}
          isActive={activeThemeId === null}
          onSelect={() => onThemeSelect(null)}
          disabled={isLoading}
        />

        {/* Plugin Theme Cards */}
        {availableThemes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            isActive={activeThemeId === theme.id}
            onSelect={() => onThemeSelect(theme.id)}
            disabled={isLoading}
          />
        ))}
      </div>

      {/* Hint about theme plugins */}
      {availableThemes.length === 0 && (
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
              <p className="qt-text-small">
                Additional themes can be added by installing theme plugins from the{' '}
                <span className="font-medium">Plugins</span> tab.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
