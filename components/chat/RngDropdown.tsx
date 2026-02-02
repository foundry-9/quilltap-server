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
  type: number | 'flip_coin' | 'spin_the_bottle'
  rolls: number
}

const QUICK_OPTIONS: RngOption[] = [
  { label: 'Roll d6', type: 6, rolls: 1 },
  { label: 'Roll d20', type: 20, rolls: 1 },
  { label: 'Roll 2d6', type: 6, rolls: 2 },
  { label: 'Flip Coin', type: 'flip_coin', rolls: 1 },
  { label: 'Spin the Bottle', type: 'spin_the_bottle', rolls: 1 },
]

interface RngDropdownProps {
  /** Chat ID for API call */
  chatId: string
  /** Called when RNG is successfully executed */
  onSuccess?: (result: { formattedText: string }) => void
  /** Whether the dropdown is disabled */
  disabled?: boolean
  /** Called to close the parent ToolPalette */
  onClose?: () => void
}

export function RngDropdown({
  chatId,
  onSuccess,
  disabled = false,
  onClose,
}: Readonly<RngDropdownProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCustomOpen, setIsCustomOpen] = useState(false)
  const [customSides, setCustomSides] = useState('20')
  const [customRolls, setCustomRolls] = useState('1')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useClickOutside(dropdownRef, () => {
    setIsOpen(false)
    setIsCustomOpen(false)
  }, {
    enabled: isOpen,
  })

  const executeRng = async (type: number | 'flip_coin' | 'spin_the_bottle', rolls: number) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/v1/chats/${chatId}?action=rng`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, rolls }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'RNG failed')
      }

      onSuccess?.(data.result)
      setIsOpen(false)
      setIsCustomOpen(false)
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleQuickOption = (option: RngOption) => {
    if (disabled || isLoading) return
    executeRng(option.type, option.rolls)
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
      {/* Main button */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled || isLoading}
        className="qt-tool-palette-button"
        title="Random number generator"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {isLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        )}
        <span>RNG</span>
        <svg
          className={`w-3 h-3 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute bottom-full left-0 mb-1 w-48 qt-card shadow-lg rounded-lg border z-50"
          role="menu"
        >
          <div className="py-1">
            {/* Quick options */}
            {QUICK_OPTIONS.map(option => (
              <button
                key={option.label}
                type="button"
                onClick={() => handleQuickOption(option)}
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
