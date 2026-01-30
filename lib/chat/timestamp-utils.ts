/**
 * Timestamp Utilities for Chat System
 *
 * Provides functions for calculating and formatting timestamps for system prompts.
 * Supports both real-time and fictional timestamps with auto-increment capabilities.
 */

import { logger } from '@/lib/logger'
import type { TimestampConfig, TimestampFormat } from '@/lib/schemas/types'

export interface CalculatedTimestamp {
  /** Formatted timestamp string for display/prompt injection */
  formatted: string
  /** ISO-8601 timestamp value */
  isoValue: string
  /** Whether this is a fictional timestamp */
  isFictional: boolean
}

/**
 * Format patterns for different timestamp formats
 */
const FORMAT_OPTIONS: Record<
  Exclude<TimestampFormat, 'CUSTOM'>,
  { format: (date: Date) => string }
> = {
  ISO8601: {
    format: (date: Date) => date.toISOString(),
  },
  FRIENDLY: {
    format: (date: Date) =>
      new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date),
  },
  DATE_ONLY: {
    format: (date: Date) =>
      new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date),
  },
  TIME_ONLY: {
    format: (date: Date) =>
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date),
  },
}

/**
 * Parse a custom format string and format the date.
 * Supports common tokens:
 * - YYYY: 4-digit year
 * - YY: 2-digit year
 * - MMMM: Full month name
 * - MMM: Abbreviated month name
 * - MM: 2-digit month (01-12)
 * - M: 1-2 digit month (1-12)
 * - DD: 2-digit day (01-31)
 * - D: 1-2 digit day (1-31)
 * - dddd: Full day name
 * - ddd: Abbreviated day name
 * - HH: 24-hour hour (00-23)
 * - H: 24-hour hour (0-23)
 * - hh: 12-hour hour (01-12)
 * - h: 12-hour hour (1-12)
 * - mm: Minutes (00-59)
 * - ss: Seconds (00-59)
 * - a: am/pm
 * - A: AM/PM
 */
function formatCustom(date: Date, formatString: string): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const daysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  const dayOfWeek = date.getDay()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = date.getSeconds()
  const hours12 = hours % 12 || 12

  // Order matters: longer patterns must be replaced first
  const replacements: [RegExp, string][] = [
    [/YYYY/g, String(year)],
    [/YY/g, String(year).slice(-2)],
    [/MMMM/g, months[month]],
    [/MMM/g, monthsShort[month]],
    [/MM/g, String(month + 1).padStart(2, '0')],
    [/M/g, String(month + 1)],
    [/dddd/g, days[dayOfWeek]],
    [/ddd/g, daysShort[dayOfWeek]],
    [/DD/g, String(day).padStart(2, '0')],
    [/D/g, String(day)],
    [/HH/g, String(hours).padStart(2, '0')],
    [/H/g, String(hours)],
    [/hh/g, String(hours12).padStart(2, '0')],
    [/h/g, String(hours12)],
    [/mm/g, String(minutes).padStart(2, '0')],
    [/ss/g, String(seconds).padStart(2, '0')],
    [/A/g, hours < 12 ? 'AM' : 'PM'],
    [/a/g, hours < 12 ? 'am' : 'pm'],
  ]

  let result = formatString
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement)
  }

  return result
}

/**
 * Calculate the current timestamp based on configuration.
 * For fictional timestamps, calculates the elapsed time since the base was set
 * and adds it to the fictional base timestamp.
 *
 * @param config - Timestamp configuration
 * @returns Calculated and formatted timestamp
 */
export function calculateCurrentTimestamp(config: TimestampConfig): CalculatedTimestamp {
  let timestamp: Date
  let isFictional = false

  if (config.useFictionalTime && config.fictionalBaseTimestamp) {
    // Calculate fictional time based on elapsed real time
    const fictionalBase = new Date(config.fictionalBaseTimestamp)
    const realBase = config.fictionalBaseRealTime
      ? new Date(config.fictionalBaseRealTime)
      : new Date()

    const elapsedMs = Date.now() - realBase.getTime()
    timestamp = new Date(fictionalBase.getTime() + elapsedMs)
    isFictional = true

  } else {
    timestamp = new Date()
  }

  // Format the timestamp
  let formatted: string
  if (config.format === 'CUSTOM' && config.customFormat) {
    formatted = formatCustom(timestamp, config.customFormat)
  } else if (config.format === 'CUSTOM') {
    // Fall back to FRIENDLY if CUSTOM but no format string
    formatted = FORMAT_OPTIONS.FRIENDLY.format(timestamp)
  } else {
    formatted = FORMAT_OPTIONS[config.format].format(timestamp)
  }

  return {
    formatted,
    isoValue: timestamp.toISOString(),
    isFictional,
  }
}

/**
 * Determine if a timestamp should be injected based on configuration and context.
 *
 * @param config - Timestamp configuration
 * @param isInitialMessage - Whether this is the first message in the conversation
 * @returns Whether timestamp should be injected
 */
export function shouldInjectTimestamp(
  config: TimestampConfig | null | undefined,
  isInitialMessage: boolean
): boolean {
  if (!config || config.mode === 'NONE') return false
  if (config.mode === 'START_ONLY') return isInitialMessage
  if (config.mode === 'EVERY_MESSAGE') return true
  return false
}

/**
 * Format a timestamp for injection into a system prompt.
 *
 * @param timestamp - Calculated timestamp
 * @param autoPrepend - Whether to format for auto-prepending
 * @returns Formatted string for prompt injection
 */
export function formatTimestampForSystemPrompt(
  timestamp: CalculatedTimestamp,
  autoPrepend: boolean
): string {
  if (autoPrepend) {
    return `Current time: ${timestamp.formatted}`
  }
  // If not auto-prepend, just return the formatted timestamp
  // (for use with {{timestamp}} template variable)
  return timestamp.formatted
}

/**
 * Create a new timestamp configuration with fictional time set to now.
 * Sets the fictional base timestamp and records when it was set.
 *
 * @param baseConfig - Base configuration to extend
 * @param fictionalTimestamp - The fictional timestamp to use
 * @returns New configuration with fictional time initialized
 */
export function initializeFictionalTime(
  baseConfig: TimestampConfig,
  fictionalTimestamp: string
): TimestampConfig {
  return {
    ...baseConfig,
    useFictionalTime: true,
    fictionalBaseTimestamp: fictionalTimestamp,
    fictionalBaseRealTime: new Date().toISOString(),
  }
}
