'use client'

/**
 * Theme Submenu Content
 *
 * Flyout submenu content for theme selection within the user menu.
 * Displays available themes with color previews and heading fonts.
 *
 * @module components/dashboard/nav-user-menu-theme
 */

import { useEffect, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import { useTheme, type ThemeSummary } from '@/components/providers/theme-provider'
import { DEFAULT_THEME_TOKENS, DEFAULT_TYPOGRAPHY } from '@/lib/themes/default-tokens'
import type { ColorMode } from '@/lib/themes/types'

// Default theme preview colors - derived from DEFAULT_THEME_TOKENS
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

// Default heading font (Inter/sans-serif)
const DEFAULT_HEADING_FONT = DEFAULT_TYPOGRAPHY.fontSans

/**
 * Generate @font-face CSS for a custom font
 */
function generateFontFaceCSS(family: string, url: string): string {
  // Check if URL is a data URL or embedded base64
  const isDataUrl = url.startsWith('data:')
  const format = isDataUrl
    ? url.includes('woff2') ? 'woff2' : 'woff'
    : url.endsWith('.woff2') ? 'woff2' : 'woff'

  return `
    @font-face {
      font-family: '${family}';
      src: url('${url}') format('${format}');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
  `
}

/**
 * Hook to lazy load custom theme fonts
 * Injects @font-face CSS for custom fonts when themes are available
 */
function useThemeFonts(themes: ThemeSummary[]) {
  // Collect all custom fonts that need loading
  const fontsToLoad = useMemo(() => {
    const fonts: Array<{ family: string; url: string }> = []
    const seen = new Set<string>()

    for (const theme of themes) {
      if (theme.headingFont?.url && !seen.has(theme.headingFont.family)) {
        seen.add(theme.headingFont.family)
        fonts.push({
          family: theme.headingFont.family,
          url: theme.headingFont.url,
        })
      }
    }
    return fonts
  }, [themes])

  // Load fonts when component mounts or themes change
  useEffect(() => {
    if (fontsToLoad.length === 0) return

    // Generate CSS for all fonts
    const css = fontsToLoad
      .map(font => generateFontFaceCSS(font.family, font.url))
      .join('\n')

    // Create style element
    const styleId = 'theme-preview-fonts'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    styleEl.textContent = css

    // Cleanup on unmount
    return () => {
      const el = document.getElementById(styleId)
      if (el) {
        el.remove()
      }
    }
  }, [fontsToLoad])
}

interface ThemeOptionProps {
  theme: ThemeSummary | null // null = default theme
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
        <Icon name="check" className="w-4 h-4 text-primary flex-shrink-0" />
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

function ThemeOption({ theme, isActive, onSelect, resolvedColorMode, headingFontFamily }: ThemeOptionProps) {
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
        <Icon name="check" className="w-4 h-4 text-primary flex-shrink-0" />
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
  } = useTheme()

  // Ensure availableThemes is always an array
  const themes = Array.isArray(availableThemes) ? availableThemes : []

  // Lazy load custom fonts for theme preview
  useThemeFonts(themes)

  const handleThemeSelect = async (themeId: string | null) => {
    await setTheme(themeId)
    onThemeSelected?.()
  }

  const handleColorModeSelect = async (mode: ColorMode) => {
    await setColorMode(mode)
  }

  // Get heading font family for a theme
  const getHeadingFontFamily = (theme: ThemeSummary | null): string => {
    if (theme === null) {
      // Default theme uses Inter
      return DEFAULT_HEADING_FONT
    }
    return theme.headingFont?.family || DEFAULT_HEADING_FONT
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
        headingFontFamily={getHeadingFontFamily(null)}
      />

      {/* Divider if there are plugin themes */}
      {themes.length > 0 && (
        <div className="my-2 border-t qt-border-default" />
      )}

      {/* Plugin theme options */}
      {themes.map((theme) => (
        <ThemeOption
          key={theme.id}
          theme={theme}
          isActive={activeThemeId === theme.id}
          onSelect={() => handleThemeSelect(theme.id)}
          resolvedColorMode={resolvedColorMode}
          headingFontFamily={getHeadingFontFamily(theme)}
        />
      ))}

      {/* Hint when no plugin themes */}
      {themes.length === 0 && (
        <div className="px-3 py-2 qt-text-xs">
          Install theme plugins for more options
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

