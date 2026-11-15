'use client'

/**
 * Theme Submenu Content
 *
 * Flyout submenu content for theme selection within the user menu.
 * Displays available themes with color previews and heading fonts.
 *
 * @module components/dashboard/nav-user-menu-theme
 */

import { useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import { useTheme, type ThemeSummary } from '@/components/providers/theme-provider'
import { useThemeHeadingFonts } from '@/components/providers/theme/use-theme-heading-fonts'
import type { ColorMode } from '@/lib/themes/types'

/** Neutral swatches for a theme whose list entry carries none (before the list loads). */
const FALLBACK_SWATCH = { background: '#ffffff', primary: '#3b82f6', secondary: '#e5e7eb', accent: '#e5e7eb' }

interface ThemeOptionProps {
  theme: ThemeSummary | null // null = default theme
  /** The default theme's list entry (swatches from the registry defaults) */
  defaultTheme: ThemeSummary | null
  isActive: boolean
  onSelect: () => void
  resolvedColorMode: 'light' | 'dark'
  /** Font family to use for the theme name */
  headingFontFamily?: string
}

interface ColorModeOptionProps {
  mode: ColorMode
  label: string
  icon: React.ReactNode
  isActive: boolean
  onSelect: () => void
}

function ColorModeOption({ mode, label, icon, isActive, onSelect }: ColorModeOptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        w-full flex items-center gap-3 px-3 py-2 text-left transition-colors rounded-md
        ${isActive ? 'qt-bg-primary/10' : 'hover:qt-bg-muted'}
      `}
    >
      <span className="w-4 h-4 flex-shrink-0 qt-text-secondary">{icon}</span>
      <span className="text-sm qt-text-primary flex-1">{label}</span>
      {isActive && (
        <Icon name="check" className="w-4 h-4 qt-text-brand flex-shrink-0" />
      )}
    </button>
  )
}

const COLOR_MODE_OPTIONS: { mode: ColorMode; label: string; icon: React.ReactNode }[] = [
  {
    mode: 'light',
    label: 'Light',
    icon: <Icon name="sun" className="w-4 h-4" />,
  },
  {
    mode: 'dark',
    label: 'Dark',
    icon: <Icon name="moon" className="w-4 h-4" />,
  },
  {
    mode: 'system',
    label: 'System',
    icon: <Icon name="monitor" className="w-4 h-4" />,
  },
]

function ThemeOption({ theme, defaultTheme, isActive, onSelect, resolvedColorMode, headingFontFamily }: ThemeOptionProps) {
  const isDefault = theme === null
  const name = isDefault ? 'Default' : theme.name

  const colors = (isDefault ? defaultTheme : theme)?.previewColors?.[resolvedColorMode] ?? FALLBACK_SWATCH

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        w-full flex items-center gap-3 px-3 py-2 text-left transition-colors rounded-md
        ${isActive ? 'qt-bg-primary/10' : 'hover:qt-bg-muted'}
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

      {/* Theme name - displayed in the theme's heading font */}
      <span
        className="text-sm qt-text-primary truncate flex-1 font-semibold"
        style={{ fontFamily: headingFontFamily }}
      >
        {name}
      </span>

      {/* Active indicator */}
      {isActive && (
        <Icon name="check" className="w-4 h-4 qt-text-brand flex-shrink-0" />
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
    colorMode,
    setColorMode,
    resolvedColorMode,
    isLoading,
    defaultTheme,
  } = useTheme()

  // Ensure availableThemes is always an array
  const themes = useMemo(() => (Array.isArray(availableThemes) ? availableThemes : []), [availableThemes])

  // Declare each theme's heading font so its name is set in its own face
  const fontThemes = useMemo(() => [defaultTheme, ...themes], [defaultTheme, themes])
  useThemeHeadingFonts(fontThemes)

  const handleThemeSelect = async (themeId: string | null) => {
    await setTheme(themeId)
    onThemeSelected?.()
  }

  const handleColorModeSelect = async (mode: ColorMode) => {
    await setColorMode(mode)
  }

  // Get heading font family for a theme
  const getHeadingFontFamily = (theme: ThemeSummary | null): string | undefined =>
    (theme ?? defaultTheme)?.headingFont?.family || undefined

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
        defaultTheme={defaultTheme}
        isActive={activeThemeId === null}
        onSelect={() => handleThemeSelect(null)}
        resolvedColorMode={resolvedColorMode}
        headingFontFamily={getHeadingFontFamily(null)}
      />

      {/* Divider if there are installed themes */}
      {themes.length > 0 && (
        <div className="my-2 border-t qt-border-default" />
      )}

      {/* Installed theme options */}
      {themes.map((theme) => (
        <ThemeOption
          key={theme.id}
          theme={theme}
          defaultTheme={defaultTheme}
          isActive={activeThemeId === theme.id}
          onSelect={() => handleThemeSelect(theme.id)}
          resolvedColorMode={resolvedColorMode}
          headingFontFamily={getHeadingFontFamily(theme)}
        />
      ))}

      {/* Hint when no themes are installed */}
      {themes.length === 0 && (
        <div className="px-3 py-2 qt-text-xs">
          Install theme bundles for more options
        </div>
      )}

      {/* Divider before color mode options */}
      <div className="my-2 border-t qt-border-default" />

      {/* Color mode options */}
      {COLOR_MODE_OPTIONS.map(({ mode, label, icon }) => (
        <ColorModeOption
          key={mode}
          mode={mode}
          label={label}
          icon={icon}
          isActive={colorMode === mode}
          onSelect={() => handleColorModeSelect(mode)}
        />
      ))}
    </div>
  )
}

