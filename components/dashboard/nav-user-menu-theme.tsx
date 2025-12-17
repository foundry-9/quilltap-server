'use client'

/**
 * Theme Submenu Content
 *
 * Flyout submenu content for theme selection within the user menu.
 * Displays available themes with color previews.
 *
 * @module components/dashboard/nav-user-menu-theme
 */

import { useTheme, type ThemeSummary } from '@/components/providers/theme-provider'
import { clientLogger } from '@/lib/client-logger'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'

// Default theme preview colors
const DEFAULT_PREVIEW_COLORS = {
  light: {
    background: DEFAULT_THEME_TOKENS.colors.light.background,
    primary: DEFAULT_THEME_TOKENS.colors.light.primary,
    secondary: DEFAULT_THEME_TOKENS.colors.light.secondary,
    foreground: DEFAULT_THEME_TOKENS.colors.light.foreground,
  },
  dark: {
    background: DEFAULT_THEME_TOKENS.colors.dark.background,
    primary: DEFAULT_THEME_TOKENS.colors.dark.primary,
    secondary: DEFAULT_THEME_TOKENS.colors.dark.secondary,
    foreground: DEFAULT_THEME_TOKENS.colors.dark.foreground,
  },
}

interface ThemeOptionProps {
  theme: ThemeSummary | null // null = default theme
  isActive: boolean
  onSelect: () => void
  resolvedColorMode: 'light' | 'dark'
}

function ThemeOption({ theme, isActive, onSelect, resolvedColorMode }: ThemeOptionProps) {
  const isDefault = theme === null
  const name = isDefault ? 'Default' : theme.name

  // Get the preview colors for this theme
  const getPreviewColors = () => {
    if (isDefault) {
      return DEFAULT_PREVIEW_COLORS[resolvedColorMode]
    }
    if (theme.previewColors) {
      return theme.previewColors[resolvedColorMode]
    }
    // Fallback to default colors if theme doesn't have preview colors
    return DEFAULT_PREVIEW_COLORS[resolvedColorMode]
  }

  const colors = getPreviewColors()

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        w-full flex items-center gap-3 px-3 py-2 text-left transition-colors rounded-md
        ${isActive ? 'bg-accent' : 'hover:bg-muted'}
      `}
      style={{
        // Apply theme colors as inline styles for preview
        borderLeft: `3px solid ${colors.primary}`,
      }}
    >
      {/* Color swatches */}
      <div className="flex gap-0.5 flex-shrink-0">
        <div
          className="w-4 h-4 rounded-sm"
          style={{ backgroundColor: colors.background }}
          title="Background"
        />
        <div
          className="w-4 h-4 rounded-sm"
          style={{ backgroundColor: colors.primary }}
          title="Primary"
        />
        <div
          className="w-4 h-4 rounded-sm"
          style={{ backgroundColor: colors.secondary }}
          title="Secondary"
        />
      </div>

      {/* Theme name */}
      <span className="text-sm qt-text-primary truncate flex-1">
        {name}
      </span>

      {/* Active indicator */}
      {isActive && (
        <svg className="w-4 h-4 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  )
}

interface NavUserMenuThemeContentProps {
  /** Callback when a theme is selected (to close parent menus) */
  onThemeSelected?: () => void
}

/**
 * Theme selection content for the user menu submenu flyout.
 */
export function NavUserMenuThemeContent({ onThemeSelected }: NavUserMenuThemeContentProps) {
  const {
    activeThemeId,
    availableThemes,
    setTheme,
    resolvedColorMode,
    isLoading,
  } = useTheme()

  // Ensure availableThemes is always an array
  const themes = Array.isArray(availableThemes) ? availableThemes : []

  const handleThemeSelect = async (themeId: string | null) => {
    clientLogger.info('NavUserMenuTheme: selecting theme', { themeId })
    await setTheme(themeId)
    onThemeSelected?.()
  }

  if (isLoading) {
    return (
      <div className="p-3 qt-text-small">
        Loading themes...
      </div>
    )
  }

  return (
    <div className="p-2 max-h-80 overflow-y-auto">
      {/* Default theme option */}
      <ThemeOption
        theme={null}
        isActive={activeThemeId === null}
        onSelect={() => handleThemeSelect(null)}
        resolvedColorMode={resolvedColorMode}
      />

      {/* Divider if there are plugin themes */}
      {themes.length > 0 && (
        <div className="my-2 border-t border-border" />
      )}

      {/* Plugin theme options */}
      {themes.map((theme) => (
        <ThemeOption
          key={theme.id}
          theme={theme}
          isActive={activeThemeId === theme.id}
          onSelect={() => handleThemeSelect(theme.id)}
          resolvedColorMode={resolvedColorMode}
        />
      ))}

      {/* Hint when no plugin themes */}
      {themes.length === 0 && (
        <div className="px-3 py-2 qt-text-xs">
          Install theme plugins for more options
        </div>
      )}
    </div>
  )
}

/**
 * Paint brush icon for theme menu item
 */
export function ThemeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
      />
    </svg>
  )
}
