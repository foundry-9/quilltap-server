'use client'

/**
 * Color Mode Selector Component
 *
 * Displays compact button options for selecting color mode:
 * - Light mode
 * - Dark mode
 * - System (follows OS settings)
 *
 * @module components/settings/appearance/components/ColorModeSelector
 */

import type { ColorMode } from '@/lib/themes/types'
import type { ColorModeSelectorProps } from '../types'
import { Icon } from '@/components/ui/icon'

interface ColorModeOptionInternal {
  value: ColorMode
  label: string
  description: string
  iconName: 'sun' | 'moon' | 'monitor'
}

const COLOR_MODE_OPTIONS: ColorModeOptionInternal[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Always use light mode',
    iconName: 'sun',
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use dark mode',
    iconName: 'moon',
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow your system settings',
    iconName: 'monitor',
  },
]

/**
 * Renders color mode selector as a compact horizontal button group
 */
export function ColorModeSelector({
  value,
  resolvedMode,
  onChange,
  disabled,
}: ColorModeSelectorProps) {
  return (
    <div className="flex gap-2">
      {COLOR_MODE_OPTIONS.map((option) => {
        const isSelected = value === option.value
        const displayLabel = option.value === 'system'
          ? `System (${resolvedMode})`
          : option.label

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => !disabled && onChange(option.value as ColorMode)}
            disabled={disabled}
            className={`
              flex-1 flex items-center justify-center gap-2 px-3 py-2 qt-label
              border rounded-lg transition-colors
              ${isSelected
                ? 'qt-border-primary bg-primary text-primary-foreground'
                : 'qt-border-default qt-bg-card qt-hover-accent text-foreground'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            aria-pressed={isSelected}
          >
            <Icon name={option.iconName} className="w-4 h-4" />
            <span>{displayLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
