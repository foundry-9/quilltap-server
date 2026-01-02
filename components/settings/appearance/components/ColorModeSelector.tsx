'use client'

/**
 * Color Mode Selector Component
 *
 * Displays radio button options for selecting color mode:
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
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
 * Renders color mode selector with radio button options
 */
export function ColorModeSelector({
  value,
  resolvedMode,
  onChange,
  disabled,
}: ColorModeSelectorProps) {
  return (
    <div className="space-y-3">
      {COLOR_MODE_OPTIONS.map((option) => (
        <label
          key={option.value}
          className={`
            flex items-center gap-4 p-4 border rounded-lg transition-colors
            ${
              value === option.value
                ? 'border-primary bg-accent'
                : 'border-border hover:bg-accent'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <input
            type="radio"
            name="colorMode"
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              if (!disabled) {
                onChange(option.value as ColorMode)
              }
            }}
            disabled={disabled}
            className="sr-only"
          />

          {/* Icon */}
          <div
            className={`
            flex-shrink-0 p-2 rounded-full
            ${
              value === option.value
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }
          `}
          >
            {option.icon}
          </div>

          {/* Label and Description */}
          <div className="flex-1">
            <div className="qt-text-primary">{option.label}</div>
            <div className="qt-text-small">
              {option.description}
              {option.value === 'system' && (
                <span className="ml-1 text-xs">
                  (currently {resolvedMode})
                </span>
              )}
            </div>
          </div>

          {/* Selected Indicator */}
          {value === option.value && (
            <div className="flex-shrink-0">
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
        </label>
      ))}
    </div>
  )
}
