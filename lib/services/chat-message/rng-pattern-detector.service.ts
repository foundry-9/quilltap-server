/**
 * RNG Pattern Detector Service
 *
 * Detects RNG patterns (dice rolls, coin flips, spin the bottle) in user messages
 * and returns the detected patterns for automatic execution.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { RngType } from '@/lib/tools/rng-tool'

const logger = createServiceLogger('RngPatternDetector')

/**
 * Detected RNG pattern from user message
 */
export interface DetectedRngPattern {
  /** Type of RNG operation */
  type: 'dice' | 'flip_coin' | 'spin_the_bottle'
  /** For dice rolls: number of sides */
  sides?: number
  /** Number of rolls/flips/spins */
  count: number
  /** The matched text from the message */
  matchText: string
}

/**
 * RNG tool input derived from a detected pattern
 */
export interface RngToolCall {
  type: RngType
  rolls: number
  matchText: string
}

/**
 * Regex patterns for RNG detection
 *
 * Dice: /\b(\d+)?d(\d+)\b/gi - matches "d6", "2d20", "3d10", etc.
 * Coin: /\bflip.{1,3}coin\b/gi - matches "flip a coin", "flip the coin", etc.
 * Bottle: /\bspin\b.{0,50}\bbottle\b/gi - matches "spin the bottle", "spin a bottle", etc. (bounded to prevent ReDoS)
 */
const DICE_PATTERN = /\b(\d+)?d(\d+)\b/gi
const COIN_FLIP_PATTERN = /\bflip.{1,3}coin\b/gi
const SPIN_BOTTLE_PATTERN = /\bspin\b.{0,50}\bbottle\b/gi

/**
 * Detect RNG patterns in a user message
 *
 * @param content - The user message content to scan
 * @returns Array of detected RNG patterns
 */
export function detectRngPatterns(content: string): DetectedRngPattern[] {
  const patterns: DetectedRngPattern[] = []

  // Reset regex lastIndex (important since we're using global flag)
  DICE_PATTERN.lastIndex = 0
  COIN_FLIP_PATTERN.lastIndex = 0
  SPIN_BOTTLE_PATTERN.lastIndex = 0

  // Detect dice rolls (e.g., "2d6", "d20", "3d10")
  let diceMatch: RegExpExecArray | null
  while ((diceMatch = DICE_PATTERN.exec(content)) !== null) {
    const count = diceMatch[1] ? parseInt(diceMatch[1], 10) : 1
    const sides = parseInt(diceMatch[2], 10)

    // Validate dice parameters (2-1000 sides, 1-100 rolls)
    if (sides >= 2 && sides <= 1000 && count >= 1 && count <= 100) {
      patterns.push({
        type: 'dice',
        sides,
        count,
        matchText: diceMatch[0],
      })
    }
  }

  // Detect coin flips (e.g., "flip a coin", "flip the coin")
  let coinMatch: RegExpExecArray | null
  while ((coinMatch = COIN_FLIP_PATTERN.exec(content)) !== null) {
    patterns.push({
      type: 'flip_coin',
      count: 1,
      matchText: coinMatch[0],
    })
  }

  // Detect spin the bottle (e.g., "spin the bottle", "spin a bottle")
  let bottleMatch: RegExpExecArray | null
  while ((bottleMatch = SPIN_BOTTLE_PATTERN.exec(content)) !== null) {
    patterns.push({
      type: 'spin_the_bottle',
      count: 1,
      matchText: bottleMatch[0],
    })
  }

  if (patterns.length > 0) {
    logger.info('RNG patterns detected in message', {
      patternCount: patterns.length,
      patterns: patterns.map(p => ({ type: p.type, matchText: p.matchText })),
    })
  }

  return patterns
}

/**
 * Convert detected patterns to RNG tool calls
 *
 * @param patterns - Array of detected RNG patterns
 * @returns Array of RNG tool call specifications
 */
export function convertPatternsToToolCalls(patterns: DetectedRngPattern[]): RngToolCall[] {
  return patterns.map(pattern => {
    if (pattern.type === 'dice' && pattern.sides) {
      return {
        type: pattern.sides,
        rolls: pattern.count,
        matchText: pattern.matchText,
      }
    } else if (pattern.type === 'flip_coin') {
      return {
        type: 'flip_coin' as const,
        rolls: pattern.count,
        matchText: pattern.matchText,
      }
    } else {
      // spin_the_bottle
      return {
        type: 'spin_the_bottle' as const,
        rolls: pattern.count,
        matchText: pattern.matchText,
      }
    }
  })
}

/**
 * Detect and convert RNG patterns in a single call
 *
 * @param content - The user message content to scan
 * @returns Array of RNG tool call specifications ready for execution
 */
export function detectAndConvertRngPatterns(content: string): RngToolCall[] {
  const patterns = detectRngPatterns(content)
  return convertPatternsToToolCalls(patterns)
}
