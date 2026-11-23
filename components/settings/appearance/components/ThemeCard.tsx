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

import { useTheme } from '@/components/providers/theme-provider'
import { useThemeHeadingFonts } from '@/components/providers/theme/use-theme-heading-fonts'
import { BrandName } from '@/components/ui/brand-name'
import type { ThemeCardProps } from '../types'
import { Icon } from '@/components/ui/icon'
import { getContrastingTextColor, getMutedTextColor, getSourceBadge } from '../utils/contrast'

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

  // Swatches and heading font come with the theme list; the default's are the
  // registry defaults, which the server resolves for its list entry.
  const { defaultTheme } = useTheme()
  const summary = isDefault ? defaultTheme : theme
  useThemeHeadingFonts([summary])

  // Preview colors for card styling (dark mode for more visual distinction)
  const previewColors = summary?.previewColors
  const cardBgColor = previewColors?.dark?.background || '#1a1a1a'
  const cardTextColor = getContrastingTextColor(cardBgColor)
  const cardMutedColor = getMutedTextColor(cardBgColor)

  // The card is set in the theme's heading font
  const fontFamily = summary?.headingFont?.family || undefined

  // Handle preview button click
  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand?.()
  }

  // Collapsed view (default card)
  return (
    <>
      <div
        className={`
          relative flex flex-col items-start p-4 rounded-lg border-2 transition-all
          text-left w-full overflow-hidden
          ${isActive ? 'qt-border-primary' : 'qt-border-default hover:qt-border-input'}
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
        <div
          className="text-sm mt-1 line-clamp-2"
          style={{ color: cardMutedColor, '--qt-brand-fg': cardTextColor } as React.CSSProperties}
        >
          {description}
        </div>
      )}

      {/* Bottom row with source badge, mode badges and preview button */}
      <div className="flex flex-wrap items-center justify-between gap-2 w-full mt-3">
        {/* Source + Mode Badges */}
        <div className="flex flex-wrap items-center gap-1">
          {/* Source badge */}
          {(() => {
            const badge = isDefault ? { label: 'Built-in' } : getSourceBadge(theme?.source)
            return badge ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded qt-text-label-xs"
                style={{ backgroundColor: `${cardTextColor}15`, color: cardTextColor }}
              >
                {badge.label}
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
              color: getContrastingTextColor(previewColors?.dark?.primary || '#22c55e'),
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
