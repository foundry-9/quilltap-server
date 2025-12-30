/**
 * All-LLM Pause Logic
 * Characters Not Personas - Phase 4
 *
 * Implements automatic pause intervals for chats where all participants
 * are LLM-controlled (no user input). This prevents runaway API usage.
 *
 * Pause intervals: 3, 6, 12, 24, 48... (logarithmic doubling)
 */

import { turnManagerLogger as logger } from './logger';

/**
 * Initial pause interval (number of turns before first pause)
 */
export const INITIAL_PAUSE_INTERVAL = 3;

/**
 * Gets the next pause interval using logarithmic doubling.
 * Sequence: 3, 6, 12, 24, 48, 96...
 *
 * @param currentInterval - The current interval (0 for initial)
 * @returns The next pause interval
 */
export function getNextPauseInterval(currentInterval: number): number {
  if (currentInterval === 0) {
    return INITIAL_PAUSE_INTERVAL;
  }
  return currentInterval * 2;
}

/**
 * Checks if the chat should pause based on the turn count.
 * Returns true if the turn count matches a pause threshold.
 *
 * Pause thresholds: 3, 6, 12, 24, 48, 96, 192...
 *
 * @param turnCount - Number of turns since last user input or pause
 * @returns true if chat should pause
 */
export function shouldPauseForAllLLM(turnCount: number): boolean {
  if (turnCount <= 0) {
    return false;
  }

  // Check if turnCount matches any pause threshold
  // Thresholds are: 3, 6, 12, 24, 48, 96...
  let threshold = INITIAL_PAUSE_INTERVAL;

  while (threshold <= turnCount) {
    if (turnCount === threshold) {
      logger.debug('[All-LLM Pause] Pause threshold reached', {
        turnCount,
        threshold,
      });
      return true;
    }
    threshold *= 2;
  }

  return false;
}

/**
 * Gets the current pause threshold for a given turn count.
 * Returns the last threshold that was or should be reached.
 *
 * @param turnCount - Number of turns since last user input or pause
 * @returns The current/last pause threshold, or 0 if none
 */
export function getCurrentPauseThreshold(turnCount: number): number {
  if (turnCount < INITIAL_PAUSE_INTERVAL) {
    return 0;
  }

  let threshold = INITIAL_PAUSE_INTERVAL;
  let lastThreshold = 0;

  while (threshold <= turnCount) {
    lastThreshold = threshold;
    threshold *= 2;
  }

  return lastThreshold;
}

/**
 * Gets the next pause threshold for a given turn count.
 *
 * @param turnCount - Number of turns since last user input or pause
 * @returns The next pause threshold
 */
export function getNextPauseThreshold(turnCount: number): number {
  let threshold = INITIAL_PAUSE_INTERVAL;

  while (threshold <= turnCount) {
    threshold *= 2;
  }

  return threshold;
}

/**
 * Gets how many turns remain until the next pause.
 *
 * @param turnCount - Number of turns since last user input or pause
 * @returns Number of turns until next pause
 */
export function getTurnsUntilNextPause(turnCount: number): number {
  const nextThreshold = getNextPauseThreshold(turnCount);
  return nextThreshold - turnCount;
}
