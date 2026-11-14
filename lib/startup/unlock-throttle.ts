/**
 * Attempt throttle for passphrase unlock.
 *
 * Counts consecutive failed unlock attempts for the whole process (an
 * instance has one key, so the counter is not per-client). After
 * {@link FREE_ATTEMPTS} failures each further failure doubles a lockout
 * window, capped at {@link MAX_LOCKOUT_SECONDS}. A success clears it. State
 * lives in a process singleton so every bundle copy shares one counter.
 *
 * @module lib/startup/unlock-throttle
 */

import { processSingleton } from '@/lib/utils/process-singleton';

export const FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_SECONDS = 2;
export const MAX_LOCKOUT_SECONDS = 900;

interface ThrottleState {
  failures: number;
  lockedUntil: number;
}

const state = (): ThrottleState =>
  processSingleton<ThrottleState>('startup.unlockThrottle', () => ({ failures: 0, lockedUntil: 0 }));

/** Seconds until another attempt is allowed, or 0 when one is allowed now. */
export function unlockRetryAfterSeconds(now: number = Date.now()): number {
  const remaining = state().lockedUntil - now;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Record a failed attempt and start the next lockout window if due. */
export function recordUnlockFailure(now: number = Date.now()): void {
  const s = state();
  s.failures += 1;
  if (s.failures >= FREE_ATTEMPTS) {
    const seconds = Math.min(
      MAX_LOCKOUT_SECONDS,
      BASE_LOCKOUT_SECONDS * 2 ** (s.failures - FREE_ATTEMPTS)
    );
    s.lockedUntil = now + seconds * 1000;
  }
}

/** Clear the counter after a successful unlock. */
export function recordUnlockSuccess(): void {
  const s = state();
  s.failures = 0;
  s.lockedUntil = 0;
}

/** Test hook: reset all throttle state. */
export function resetUnlockThrottle(): void {
  recordUnlockSuccess();
}
