'use client'

/**
 * RngDropdown Component
 *
 * Dropdown menu for manual RNG invocation from the ToolPalette.
 * Provides quick options for common dice rolls, coin flips, and spin the bottle.
 */

import { useState, useRef } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'

interface RngOption {
  label: string
  type: 'flip_coin' | 'spin_the_bottle'
}

const OTHER_OPTIONS: RngOption[] = [
  { label: 'Flip Coin', type: 'flip_coin' },
  { label: 'Spin the Bottle', type: 'spin_the_bottle' },
]

/** Dice types with adjustable roll counts */
const DICE_TYPES = [
  { sides: 6, label: 'd6' },
  { sides: 20, label: 'd20' },
] as const

/** Pending tool result data returned from preview mode */
export interface RngPendingResult {
  tool: 'rng'
  displayName: string
  icon: string
  summary: string
  formattedResult: string
  requestPrompt: string
  arguments: Record<string, unknown>
  success: boolean
}

interface RngDropdownProps {
  /** Chat ID for API call */
  chatId: string
  /** Called when RNG is successfully executed (legacy mode) */
  onSuccess?: (result: { formattedText: string }) => void
  /** Called when RNG preview result is ready to be added as pending */
  onPendingResult?: (result: RngPendingResult) => void
  /** Whether the dropdown is disabled */
  disabled?: boolean
  /** Called to close the parent ToolPalette */
  onClose?: () => void
  /** Button variant: 'palette' (default) for tool palette, 'gutter' for composer gutter */
  variant?: 'palette' | 'gutter'
}

export function RngDropdown({
  chatId,
  onSuccess,
  onPendingResult,
  disabled = false,
  onClose,
  variant = 'palette',
}: Readonly<RngDropdownProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCustomOpen, setIsCustomOpen] = useState(false)
  const [customSides, setCustomSides] = useState('20')
  const [customRolls, setCustomRolls] = useState('1')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Track number of dice for each die type
  const [diceRolls, setDiceRolls] = useState<Record<number, number>>({
    6: 1,
    20: 1,
  })

  useClickOutside(dropdownRef, () => {
    setIsOpen(false)
    setIsCustomOpen(false)
  }, {
    enabled: isOpen,
  })

  const executeRng = async (type: number | 'flip_coin' | 'spin_the_bottle', rolls: number) => {
    setIsLoading(true)
    setError(null)

    // Use preview mode if onPendingResult callback is provided
    const usePreview = !!onPendingResult

    try {
      const response = await fetch(`/api/v1/chats/${chatId}?action=rng`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, rolls, preview: usePreview }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'RNG failed')
      }

      if (usePreview && data.preview) {
        // Return pending result for display in composer
        onPendingResult({
          tool: 'rng',
          displayName: 'Random Number Generator',
          icon: '🎲',
          summary: data.result.summary,
          formattedResult: data.result.formattedText,
          requestPrompt: data.result.requestPrompt,
          arguments: data.result.arguments,
          success: true,
        })
      } else {
        // Legacy mode: message was created directly
        onSuccess?.(data.result)
      }

      setIsOpen(false)
      setIsCustomOpen(false)
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDiceRoll = (sides: number) => {
    if (disabled || isLoading) return
    executeRng(sides, diceRolls[sides] || 1)
  }

  const handleOtherOption = (option: RngOption) => {
    if (disabled || isLoading) return
    executeRng(option.type, 1)
  }

  const adjustDiceCount = (sides: number, delta: number) => {
    setDiceRolls(prev => {
      const current = prev[sides] || 1
      const newValue = Math.max(1, Math.min(100, current + delta))
      return { ...prev, [sides]: newValue }
    })
  }

  const handleCustomRoll = () => {
    if (disabled || isLoading) return

    const sides = parseInt(customSides, 10)
    const rolls = parseInt(customRolls, 10)

    if (isNaN(sides) || sides < 2 || sides > 1000) {
      setError('Sides must be between 2 and 1000')
      return
    }

    if (isNaN(rolls) || rolls < 1 || rolls > 100) {
      setError('Rolls must be between 1 and 100')
      return
    }

    executeRng(sides, rolls)
  }

  const handleToggle = () => {
    if (disabled) return
    setIsOpen(!isOpen)
    setIsCustomOpen(false)
    setError(null)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Main button - different styling for gutter vs palette */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled || isLoading}
        className={variant === 'gutter' ? 'qt-composer-gutter-button' : 'qt-tool-palette-button'}
        title="Random number generator"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Random number generator"
      >
        {isLoading ? (
          <svg className={variant === 'gutter' ? 'w-5 h-5 animate-spin' : 'w-4 h-4 animate-spin'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : (
          // Dice icon - a die showing 5 pips
          <svg className={variant === 'gutter' ? 'w-5 h-5' : 'w-4 h-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8" cy="8" r="1" fill="currentColor" />
            <circle cx="16" cy="8" r="1" fill="currentColor" />
            <circle cx="12" cy="12" r="1" fill="currentColor" />
            <circle cx="8" cy="16" r="1" fill="currentColor" />
            <circle cx="16" cy="16" r="1" fill="currentColor" />
          </svg>
        )}
        {variant === 'palette' && (
          <>
            <span>RNG</span>
            <svg
              className={`w-3 h-3 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </>
        )}
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute bottom-full left-0 mb-1 w-48 qt-card shadow-lg rounded-lg border z-50"
          role="menu"
        >
          <div className="py-1">
            {/* Dice roll options with spinners */}
            {DICE_TYPES.map(dice => (
              <div
                key={dice.sides}
                className="flex items-center px-3 py-1.5 gap-2"
              >
                <button
                  type="button"
                  onClick={() => handleDiceRoll(dice.sides)}
                  disabled={isLoading}
                  className="flex-1 px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors disabled:opacity-50 rounded"
                  role="menuitem"
                >
                  Roll {diceRolls[dice.sides] || 1}{dice.label}
                </button>
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => adjustDiceCount(dice.sides, 1)}
                    disabled={isLoading || (diceRolls[dice.sides] || 1) >= 100}
                    className="px-1.5 py-0.5 text-xs hover:bg-muted transition-colors disabled:opacity-30 rounded-t border border-b-0"
                    title="Increase dice count"
                    aria-label={`Increase ${dice.label} count`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustDiceCount(dice.sides, -1)}
                    disabled={isLoading || (diceRolls[dice.sides] || 1) <= 1}
                    className="px-1.5 py-0.5 text-xs hover:bg-muted transition-colors disabled:opacity-30 rounded-b border"
                    title="Decrease dice count"
                    aria-label={`Decrease ${dice.label} count`}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            {/* Other options */}
            {OTHER_OPTIONS.map(option => (
              <button
                key={option.label}
                type="button"
                onClick={() => handleOtherOption(option)}
                disabled={isLoading}
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors disabled:opacity-50"
                role="menuitem"
              >
                {option.label}
              </button>
            ))}

            {/* Divider */}
            <div className="border-t my-1" />

            {/* Custom roll toggle */}
            <button
              type="button"
              onClick={() => setIsCustomOpen(!isCustomOpen)}
              disabled={isLoading}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors disabled:opacity-50 flex items-center justify-between"
              role="menuitem"
            >
              <span>Custom Roll</span>
              <svg
                className={`w-3 h-3 transition-transform ${isCustomOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Custom roll form */}
            {isCustomOpen && (
              <div className="px-3 py-2 space-y-2 border-t">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={customRolls}
                    onChange={e => setCustomRolls(e.target.value)}
                    min={1}
                    max={100}
                    className="w-14 px-2 py-1 text-sm rounded border qt-input"
                    placeholder="Rolls"
                  />
                  <span className="text-sm">d</span>
                  <input
                    type="number"
                    value={customSides}
                    onChange={e => setCustomSides(e.target.value)}
                    min={2}
                    max={1000}
                    className="w-16 px-2 py-1 text-sm rounded border qt-input"
                    placeholder="Sides"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCustomRoll}
                  disabled={isLoading}
                  className="w-full px-2 py-1 text-sm qt-button qt-button-primary rounded"
                >
                  Roll {customRolls}d{customSides}
                </button>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="px-3 py-2 text-xs text-red-500 border-t">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default RngDropdown
