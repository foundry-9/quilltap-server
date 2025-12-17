/**
 * Appearance Settings Types
 *
 * TypeScript interfaces and types for the appearance settings tab.
 *
 * @module components/settings/appearance/types
 */

import type { ColorMode } from '@/lib/themes/types'
import type { ThemeSummary } from '@/components/providers/theme-provider'

/**
 * Preview colors for theme display - both light and dark mode colors
 */
export interface PreviewColors {
  light: {
    background: string
    primary: string
    secondary: string
    accent: string
  }
  dark: {
    background: string
    primary: string
    secondary: string
    accent: string
  }
}

/**
 * Single color mode option with label, description, and icon
 */
export interface ColorModeOption {
  value: ColorMode
  label: string
  description: string
  icon: React.ReactNode
}

/**
 * Theme Card component props
 */
export interface ThemeCardProps {
  theme: ThemeSummary | null // null = default theme
  isActive: boolean
  onSelect: () => void
  disabled?: boolean
}

/**
 * Color Mode Selector component props
 */
export interface ColorModeSelectorProps {
  value: ColorMode
  resolvedMode: 'light' | 'dark'
  onChange: (mode: ColorMode) => void
  disabled?: boolean
}

/**
 * Theme Preview Swatches component props
 */
export interface ThemePreviewSwatchesProps {
  previewColors?: PreviewColors
}
