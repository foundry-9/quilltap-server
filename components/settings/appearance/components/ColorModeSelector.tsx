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
import type { ColorModeSelectorProps, ColorModeOption } from '../types'

const COLOR_MODE_OPTIONS: ColorModeOption[] = [
  {
    value: 'light',
    label: 'Light',
    description: 'Always use light mode',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        />
      </svg>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use dark mode',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    ),
  },
  {
    value: 'system',
    label: 'System',
    description: 'Follow your system settings',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
        />
      </svg>
    ),
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
                : 'qt-border-default qt-bg-card hover:bg-accent text-foreground'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            aria-pressed={isSelected}
          >
            {option.icon}
            <span>{displayLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
