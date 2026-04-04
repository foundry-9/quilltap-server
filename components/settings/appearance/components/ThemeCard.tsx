'use client'

/**
 * Theme Card Component
 *
 * Individual theme card with preview, name, description, and selection state.
 * Supports expandable rich previews showing actual UI elements.
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
import { ThemePreviewPanel } from './ThemePreviewPanel'

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
 * Calculate relative luminance of a color
 * Based on WCAG 2.0 formula
 */
function getLuminance(hexColor: string): number {
  // Handle hsl() colors
  if (hexColor.startsWith('hsl')) {
    // For HSL, extract lightness value as approximation
    const match = hexColor.match(/hsl\(\s*\d+\s*,?\s*[\d.]+%?\s*,?\s*([\d.]+)%?\s*\)/)
    if (match) {
      return parseFloat(match[1]) / 100
    }
    return 0.5 // fallback
  }

  // Remove # if present
  const hex = hexColor.replace('#', '')

  // Parse RGB values
  let r: number, g: number, b: number
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16) / 255
    g = parseInt(hex[1] + hex[1], 16) / 255
    b = parseInt(hex[2] + hex[2], 16) / 255
  } else {
    r = parseInt(hex.slice(0, 2), 16) / 255
    g = parseInt(hex.slice(2, 4), 16) / 255
    b = parseInt(hex.slice(4, 6), 16) / 255
  }

  // Apply gamma correction
  r = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
  g = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
  b = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Get contrasting text color (white or dark) based on background
 */
function getContrastingTextColor(bgColor: string): string {
  const luminance = getLuminance(bgColor)
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff'
}

/**
 * Get muted text color based on background
 */
function getMutedTextColor(bgColor: string): string {
  const luminance = getLuminance(bgColor)
  return luminance > 0.5 ? '#666666' : '#a0a0a0'
}

/**
 * Individual theme card with preview and selection state
 */
/**
 * Get source badge label
 */
function getSourceBadge(source?: string, deprecated?: boolean): { label: string; deprecated: boolean } | null {
  switch (source) {
    case 'bundle': return { label: 'Bundle', deprecated: false };
    case 'plugin': return { label: 'Plugin', deprecated: deprecated ?? true };
    default: return null;
  }
}

export function ThemeCard({
  theme,
  isActive,
  onSelect,
  disabled,
  isExpanded = false,
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

  // Use the preview hook to lazy load tokens
  const { tokens, fonts, cssOverrides, isLoading, error, fetchTokens } = useThemePreview(
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

  // Handle apply button click when expanded
  const handleApplyClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
  }

  // Handle close button click
  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand?.()
  }

  if (isExpanded) {
    // Expanded view with rich preview panels
    return (
      <div
        className={`
          relative flex flex-col p-4 rounded-lg border-2 transition-all
          w-full col-span-full
          ${isActive ? 'qt-border-primary bg-accent' : 'qt-border-default'}
        `}
      >
        {/* Header with theme name, apply, and close buttons */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="qt-text-primary text-lg font-semibold">{name}</div>
            {description && (
              <div className="qt-text-small mt-0.5 max-w-2xl">
                {description}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Source badge */}
            {(() => {
              const badge = isDefault ? { label: 'Built-in', deprecated: false } : getSourceBadge(theme?.source, theme?.deprecated)
              return badge ? (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.deprecated ? 'qt-bg-warning/15 qt-text-warning' : 'qt-bg-muted qt-text-secondary'}`}>
                  {badge.label}
                  {badge.deprecated && ' (deprecated)'}
                </span>
              ) : null
            })()}
            {/* Export button */}
            {onExport && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onExport(); }}
                className="qt-button-ghost qt-button-sm text-xs"
                title="Export as .qtap-theme"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
            )}
            {/* Uninstall button (bundle themes only) */}
            {onUninstall && !isActive && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onUninstall(); }}
                className="qt-button-ghost qt-button-sm text-xs qt-text-destructive hover:qt-text-destructive"
                title="Uninstall theme"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            {!isActive && (
              <button
                type="button"
                onClick={handleApplyClick}
                disabled={disabled}
                className="qt-button-primary qt-button-sm"
              >
                Apply
              </button>
            )}
            {isActive && (
              <span className="qt-badge-success flex items-center gap-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                Active
              </span>
            )}
            <button
              type="button"
              onClick={handleCloseClick}
              className="qt-button-ghost p-1 qt-text-secondary hover:text-foreground"
              aria-label="Close preview"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Preview content */}
        {isLoading && !previewTokens && (
          <div className="flex items-center justify-center py-12">
            <div className="qt-spinner" />
            <span className="ml-2 qt-text-small">Loading theme preview...</span>
          </div>
        )}

        {error && !previewTokens && (
          <div className="qt-alert-error p-4 rounded-lg">
            <p className="font-medium">Failed to load theme preview</p>
            <p className="qt-text-small mt-1">{error}</p>
          </div>
        )}

        {previewTokens && (
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Light mode preview */}
            <ThemePreviewPanel
              tokens={previewTokens}
              themeId={themeId}
              mode="light"
              fonts={fonts}
              cssOverrides={cssOverrides}
              label="Light Mode"
            />

            {/* Dark mode preview (only if theme supports it) */}
            {supportsDarkMode && (
              <ThemePreviewPanel
                tokens={previewTokens}
                themeId={themeId}
                mode="dark"
                fonts={fonts}
                cssOverrides={cssOverrides}
                label="Dark Mode"
              />
            )}
          </div>
        )}
      </div>
    )
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
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
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
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: `${cardTextColor}15`,
              color: cardTextColor,
            }}
          >
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
            Light
          </span>
          {/* Dark mode badge - only if supported */}
          {supportsDarkMode && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: `${cardTextColor}15`,
                color: cardTextColor,
              }}
            >
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
              Dark
            </span>
          )}
        </div>

        {/* Preview button */}
        {onToggleExpand && (
          <button
            type="button"
            onClick={handlePreviewClick}
            className="relative z-10 inline-flex items-center px-2 py-1 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: `${cardTextColor}10`,
              color: cardTextColor,
            }}
          >
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            Preview
          </button>
        )}
      </div>

        {/* Active Indicator */}
        {isActive && (
          <div
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: previewColors?.dark?.primary || '#22c55e',
              color: '#ffffff',
            }}
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Active
          </div>
        )}
      </div>
    </>
  )
}
