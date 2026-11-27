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
 * Theme Card component props
 */
export interface ThemeCardProps {
  theme: ThemeSummary | null // null = default theme
  isActive: boolean
  onSelect: () => void
  disabled?: boolean
  /** Callback to open the full-page preview modal for this theme */
  onToggleExpand?: () => void
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

