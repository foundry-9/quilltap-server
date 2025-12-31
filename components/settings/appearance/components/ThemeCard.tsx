'use client'

/**
 * Theme Card Component
 *
 * Individual theme card with preview, name, description, and selection state.
 * Used in the ThemeSelector component.
 *
 * @module components/settings/appearance/components/ThemeCard
 */

import type { ThemeSummary } from '@/components/providers/theme-provider'
import { BrandName } from '@/components/ui/brand-name'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'
import type { ThemeCardProps, PreviewColors } from '../types'

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

/**
 * Individual theme card with preview and selection state
 */
export function ThemeCard({ theme, isActive, onSelect, disabled }: ThemeCardProps) {
  const isDefault = theme === null
  const name = isDefault ? 'Default' : theme.name
  const description = isDefault
    ? <>The default <BrandName /> theme with a clean, professional appearance</>
    : theme.description

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
      <div className="qt-text-primary">{name}</div>

      {/* Theme Description */}
      {description && (
        <div className="qt-text-small mt-1 line-clamp-2">
          {description}
        </div>
      )}

      {/* Dark Mode Support Badge */}
      {!isDefault && theme.supportsDarkMode && (
        <div className="mt-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded qt-text-xs font-medium bg-muted">
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
