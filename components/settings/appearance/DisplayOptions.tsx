'use client'

/**
 * Display Options Component
 *
 * Manages display-related settings including:
 * - Color mode (light/dark/system)
 *
 * @module components/settings/appearance/DisplayOptions
 */

import type { ColorMode } from '@/lib/themes/types'
import { SettingsCard } from '@/components/ui/SettingsCard'
import { ColorModeSelector } from './components/ColorModeSelector'
import { Icon } from '@/components/ui/icon'

interface DisplayOptionsProps {
  colorMode: ColorMode
  resolvedColorMode: 'light' | 'dark'
  isLoading?: boolean
  error?: string | null
  onColorModeChange: (mode: ColorMode) => void
}

/**
 * Renders display options section including color mode
 */
export function DisplayOptions({
  colorMode,
  resolvedColorMode,
  isLoading = false,
  error = null,
  onColorModeChange,
}: DisplayOptionsProps) {
  return (
    <>
      {/* Error Display */}
      {error && (
        <div className="qt-alert-error mb-4 flex items-center gap-2">
          <Icon name="alert-circle" className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Color Mode Section */}
      <SettingsCard
        title="Color Mode"
        subtitle="Choose how Quilltap should appear. You can select light mode, dark mode, or follow your system settings."
      >
        <ColorModeSelector
          value={colorMode}
          resolvedMode={resolvedColorMode}
          onChange={onColorModeChange}
          disabled={isLoading}
        />
      </SettingsCard>
    </>
  )
}
