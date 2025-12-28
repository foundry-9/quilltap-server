'use client'

/**
 * Timestamp Configuration Card Component
 *
 * Provides a UI for configuring timestamp injection in chats.
 * Allows users to:
 * - Select timestamp injection mode (disabled, at start, every message)
 * - Choose timestamp format (friendly, ISO8601, date-only, time-only, custom)
 * - Configure fictional time simulation
 * - Choose between auto-prepend vs template variable injection
 *
 * @module components/settings/chat-settings/components/TimestampConfigCard
 */

import { useEffect, useMemo } from 'react'
import { clientLogger } from '@/lib/client-logger'
import type {
  TimestampConfig,
  TimestampMode,
  TimestampFormat,
} from '../types'
import {
  TIMESTAMP_MODES,
  TIMESTAMP_FORMATS,
  DEFAULT_TIMESTAMP_CONFIG,
} from '../types'

export interface TimestampConfigCardProps {
  config?: TimestampConfig | null | undefined
  value?: TimestampConfig | null | undefined
  onChange: (config: TimestampConfig) => void
  compact?: boolean
  disabled?: boolean
}

/**
 * Renders timestamp configuration UI with mode, format, and options
 */
export function TimestampConfigCard({
  config,
  value,
  onChange,
  compact = false,
  disabled = false,
}: TimestampConfigCardProps) {
  // Use the provided config/value or default - fully controlled component
  const currentConfig = useMemo(
    () => config ?? value ?? DEFAULT_TIMESTAMP_CONFIG,
    [config, value]
  )

  // Log render in useEffect to avoid state updates during render
  useEffect(() => {
    clientLogger.debug('TimestampConfigCard: rendered', {
      config: currentConfig,
      compact,
      disabled,
    })
  }, [currentConfig, compact, disabled])

  const handleModeChange = (mode: TimestampMode) => {
    if (disabled) return
    const updated = { ...currentConfig, mode }
    onChange(updated)
    clientLogger.debug('TimestampConfigCard: mode changed', { mode })
  }

  const handleFormatChange = (format: TimestampFormat) => {
    if (disabled) return
    const updated = { ...currentConfig, format }
    onChange(updated)
    clientLogger.debug('TimestampConfigCard: format changed', { format })
  }

  const handleCustomFormatChange = (customFormat: string) => {
    if (disabled) return
    const updated = { ...currentConfig, customFormat: customFormat || null }
    onChange(updated)
    clientLogger.debug('TimestampConfigCard: custom format changed', {
      customFormat,
    })
  }

  const handleAutoPrependChange = (autoPrepend: boolean) => {
    if (disabled) return
    const updated = { ...currentConfig, autoPrepend }
    onChange(updated)
    clientLogger.debug('TimestampConfigCard: autoPrepend changed', {
      autoPrepend,
    })
  }

  const handleUseFictionalTimeChange = (useFictionalTime: boolean) => {
    if (disabled) return
    const updated = { ...currentConfig, useFictionalTime }
    onChange(updated)
    clientLogger.debug('TimestampConfigCard: useFictionalTime changed', {
      useFictionalTime,
    })
  }

  const handleFictionalBaseTimestampChange = (timestamp: string) => {
    if (disabled) return
    const updated = {
      ...currentConfig,
      fictionalBaseTimestamp: timestamp || null,
    }
    onChange(updated)
    clientLogger.debug('TimestampConfigCard: fictionalBaseTimestamp changed', {
      timestamp,
    })
  }

  const isDisabled = disabled || currentConfig.mode === 'NONE'

  return (
    <div
      className={`space-y-4 ${
        compact ? 'qt-text-small' : ''
      } ${disabled ? 'opacity-60 pointer-events-none' : ''}`}
    >
      {/* Mode Selection */}
      <div>
        <label className="block qt-text-label mb-2">
          Timestamp Injection Mode
        </label>
        <div className={`space-y-2 ${compact ? '' : 'space-y-3'}`}>
          {TIMESTAMP_MODES.map((mode) => (
            <label
              key={mode.value}
              className={`flex items-start gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors ${
                disabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <input
                type="radio"
                name="timestampMode"
                value={mode.value}
                checked={currentConfig.mode === mode.value}
                onChange={() => handleModeChange(mode.value)}
                disabled={disabled}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium qt-text-primary">
                  {mode.label}
                </div>
                <div className="qt-text-secondary">
                  {mode.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Format and Options (only when mode is not NONE) */}
      {currentConfig.mode !== 'NONE' && (
        <>
          {/* Format Selection */}
          <div>
            <label className="block qt-text-label mb-2">
              Timestamp Format
            </label>
            <select
              value={currentConfig.format}
              onChange={(e) =>
                handleFormatChange(e.target.value as TimestampFormat)
              }
              disabled={isDisabled}
              className="w-full qt-select"
            >
              {TIMESTAMP_FORMATS.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                  {format.example ? ` - ${format.example}` : ''}
                </option>
              ))}
            </select>
            <p className="qt-text-secondary mt-1 text-xs">
              {
                TIMESTAMP_FORMATS.find((f) => f.value === currentConfig.format)
                  ?.description
              }
            </p>
          </div>

          {/* Custom Format Input (only when format is CUSTOM) */}
          {currentConfig.format === 'CUSTOM' && (
            <div>
              <label className="block qt-text-label mb-2">
                Custom Format String
              </label>
              <input
                type="text"
                value={currentConfig.customFormat || ''}
                onChange={(e) => handleCustomFormatChange(e.target.value)}
                placeholder="e.g., 'PPpp' or 'yyyy-MM-dd HH:mm:ss'"
                disabled={isDisabled}
                className="w-full px-3 py-2 border border-border rounded bg-background qt-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="qt-text-secondary mt-1 text-xs">
                Uses date-fns format tokens. See{' '}
                <a
                  href="https://date-fns.org/docs/format"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  date-fns documentation
                </a>{' '}
                for available tokens.
              </p>
            </div>
          )}

          {/* Auto-Prepend vs Template Variable */}
          <div>
            <label className="block qt-text-label mb-2">
              Injection Method
            </label>
            <label className="flex items-start gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={currentConfig.autoPrepend}
                onChange={(e) => handleAutoPrependChange(e.target.checked)}
                disabled={isDisabled}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium qt-text-primary">
                  Auto-prepend to system prompt
                </div>
                <div className="qt-text-secondary text-xs">
                  {currentConfig.autoPrepend
                    ? 'Timestamp will be automatically prepended to system prompt'
                    : 'Use {{timestamp}} template variable in system prompt instead'}
                </div>
              </div>
            </label>
          </div>

          {/* Fictional Time Option */}
          <div>
            <label className="block qt-text-label mb-2">
              Fictional Time
            </label>
            <label className="flex items-start gap-3 p-3 border border-border rounded hover:bg-accent cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={currentConfig.useFictionalTime}
                onChange={(e) =>
                  handleUseFictionalTimeChange(e.target.checked)
                }
                disabled={isDisabled}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium qt-text-primary">
                  Use fictional time
                </div>
                <div className="qt-text-secondary text-xs">
                  Instead of real-time, use a fictional base timestamp that
                  advances with each message
                </div>
              </div>
            </label>
          </div>

          {/* Fictional Base Timestamp (only when useFictionalTime is true) */}
          {currentConfig.useFictionalTime && (
            <div>
              <label className="block qt-text-label mb-2">
                Fictional Base Timestamp
              </label>
              <input
                type="datetime-local"
                value={currentConfig.fictionalBaseTimestamp || ''}
                onChange={(e) =>
                  handleFictionalBaseTimestampChange(e.target.value)
                }
                disabled={isDisabled}
                className="w-full px-3 py-2 border border-border rounded bg-background qt-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="qt-text-secondary mt-1 text-xs">
                Set the initial timestamp for fictional time. It will advance
                based on message activity.
              </p>
            </div>
          )}
        </>
      )}

      {/* Info Section */}
      {compact && (
        <div className="mt-4 p-2 bg-accent rounded text-xs qt-text-secondary">
          {currentConfig.mode === 'NONE'
            ? 'Timestamp injection is disabled'
            : `Timestamps will be injected ${
                currentConfig.mode === 'START_ONLY'
                  ? 'at conversation start'
                  : 'with every message'
              } in ${currentConfig.format} format${
                currentConfig.useFictionalTime ? ' (fictional time)' : ''
              }`}
        </div>
      )}
    </div>
  )
}
