/**
 * Appearance Settings Types
 *
 * TypeScript interfaces and types for the appearance settings tab.
 *
 * @module components/settings/appearance/types
 */

import type { ColorMode, ThemeTokens } from '@/lib/themes/types'
import type { ThemeSummary, ThemeFont } from '@/components/providers/theme-provider'

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
  /** Whether the preview is expanded */
  isExpanded?: boolean
  /** Callback to toggle preview expansion */
  onToggleExpand?: () => void
  /** Callback to uninstall (only for bundle themes) */
  onUninstall?: () => void
  /** Callback to export theme as .qtap-theme */
  onExport?: () => void
}

/**
 * Theme Preview Panel props
 */
export interface ThemePreviewPanelProps {
  /** Theme tokens to apply */
  tokens: ThemeTokens
  /** Theme ID (used for generating unique scope class) */
  themeId: string
  /** Color mode to preview */
  mode: 'light' | 'dark'
  /** Custom fonts to load */
  fonts?: ThemeFont[]
  /** Additional CSS overrides from the theme */
  cssOverrides?: string | null
  /** Optional label to display above the preview */
  label?: string
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
