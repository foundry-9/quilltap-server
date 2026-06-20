'use client'

/**
 * Theme Card Component
 *
 * Individual theme card with preview, name, description, and selection state.
 * The Preview button opens the full-page ThemePreviewModal (owned by the parent
 * ThemeSelector) via the onToggleExpand callback.
 *
 * @module components/settings/appearance/components/ThemeCard
 */

import { useEffect, useMemo } from 'react'
import type { ThemeSummary } from '@/components/providers/theme-provider'
import { BrandName } from '@/components/ui/brand-name'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'
import { generateFontFacesCSS } from '@/lib/themes/utils'
import type { ThemeCardProps, PreviewColors } from '../types'
import { useThemePreview } from '../hooks/useThemePreview'
import { Icon } from '@/components/ui/icon'
import { getContrastingTextColor, getMutedTextColor, getSourceBadge } from '../utils/contrast'

// Default theme preview colors
const DEFAULT_PREVIEW_COLORS: PreviewColors = {
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

/**
 * Individual theme card with preview and selection state
 */
export function ThemeCard({
  theme,
  isActive,
  onSelect,
  disabled,
  onToggleExpand,
  onUninstall,
  onExport,
}: ThemeCardProps) {
  const isDefault = theme === null
  const themeId = isDefault ? 'default' : theme.id
  const name = isDefault ? 'Default' : theme.name
  const description = isDefault
    ? <>The default <BrandName /> theme with a clean, professional appearance</>
    : theme.description
  const supportsDarkMode = isDefault ? true : theme.supportsDarkMode

  // Use the preview hook to lazy load tokens (for fonts + preview colors)
  const { tokens, fonts, fetchTokens } = useThemePreview(
    isDefault ? null : themeId
  )

  // Fetch tokens on mount (for fonts) and when expanded
  useEffect(() => {
    if (!isDefault) {
      fetchTokens()
    }
  }, [isDefault, fetchTokens])

  // Get tokens to use for preview (default theme uses DEFAULT_THEME_TOKENS)
  const previewTokens = isDefault ? DEFAULT_THEME_TOKENS : tokens

  // Get preview colors for card styling (use dark mode for more visual distinction)
  const previewColors = isDefault ? DEFAULT_PREVIEW_COLORS : theme?.previewColors
  const cardBgColor = previewColors?.dark?.background || '#1a1a1a'
  const cardTextColor = getContrastingTextColor(cardBgColor)
  const cardMutedColor = getMutedTextColor(cardBgColor)

  // Get font family from tokens if available
  const fontFamily = previewTokens?.typography?.fontSans || undefined

  // Generate font-face CSS for theme fonts
  const fontFaceCSS = useMemo(() => {
    if (!fonts || fonts.length === 0) return ''
    const fontDefinitions = fonts.map((font) => ({
      family: font.family,
      src: font.src,
      weight: font.weight,
      style: font.style,
      display: font.display,
    }))
    return generateFontFacesCSS(fontDefinitions)
  }, [fonts])

  // Handle preview button click
  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand?.()
  }

  // Collapsed view (default card)
  return (
    <>
      {/* Load theme fonts */}
      {fontFaceCSS && <style dangerouslySetInnerHTML={{ __html: fontFaceCSS }} />}

      <div
        className={`
          relative flex flex-col items-start p-4 rounded-lg border-2 transition-all
          text-left w-full overflow-hidden
          ${isActive ? 'qt-border-primary' : 'qt-border-default hover:border-input'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        style={{
          backgroundColor: cardBgColor,
          color: cardTextColor,
          fontFamily: fontFamily,
        }}
      >
        {/* Clickable area for selection */}
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="absolute inset-0 w-full h-full cursor-pointer"
        aria-label={`Select ${name} theme`}
      />

      {/* Theme Name */}
      <div className="font-semibold text-base" style={{ color: cardTextColor }}>
        {name}
      </div>

      {/* Theme Description */}
      {description && (
        <div className="text-sm mt-1 line-clamp-2" style={{ color: cardMutedColor }}>
          {description}
        </div>
      )}

      {/* Bottom row with source badge, mode badges and preview button */}
      <div className="flex items-center justify-between w-full mt-3">
        {/* Source + Mode Badges */}
        <div className="flex items-center gap-1">
          {/* Source badge */}
          {(() => {
            const badge = isDefault ? { label: 'Built-in', deprecated: false } : getSourceBadge(theme?.source, theme?.deprecated)
            return badge ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded qt-text-label-xs"
                style={{
                  backgroundColor: badge.deprecated ? 'rgba(234, 179, 8, 0.15)' : `${cardTextColor}15`,
                  color: badge.deprecated ? '#eab308' : cardTextColor,
                }}
              >
                {badge.label}
                {badge.deprecated && ' (deprecated)'}
              </span>
            ) : null
          })()}
          {/* Light mode badge - all themes support light */}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded qt-text-label-xs"
            style={{
              backgroundColor: `${cardTextColor}15`,
              color: cardTextColor,
            }}
          >
            <Icon name="sun" className="w-3 h-3 mr-1" />
            Light
          </span>
          {/* Dark mode badge - only if supported */}
          {supportsDarkMode && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded qt-text-label-xs"
              style={{
                backgroundColor: `${cardTextColor}15`,
                color: cardTextColor,
              }}
            >
              <Icon name="moon" className="w-3 h-3 mr-1" />
              Dark
            </span>
          )}
        </div>

        {/* Preview button */}
        {onToggleExpand && (
          <button
            type="button"
            onClick={handlePreviewClick}
            className="relative z-10 inline-flex items-center px-2 py-1 rounded qt-text-label-xs transition-colors"
            style={{
              backgroundColor: `${cardTextColor}10`,
              color: cardTextColor,
            }}
          >
            <Icon name="eye" className="w-3 h-3 mr-1" />
            Preview
          </button>
        )}
      </div>

        {/* Active Indicator */}
        {isActive && (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded qt-text-label-xs"
            style={{
              backgroundColor: previewColors?.dark?.primary || '#22c55e',
              color: '#ffffff',
            }}
          >
            <Icon name="check" className="w-3 h-3" />
            Active
          </div>
        )}
      </div>
    </>
  )
}
