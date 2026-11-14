import {
  unlockRetryAfterSeconds,
  recordUnlockFailure,
  recordUnlockSuccess,
  resetUnlockThrottle,
  FREE_ATTEMPTS,
  MAX_LOCKOUT_SECONDS,
} from '@/lib/startup/unlock-throttle';

describe('unlock throttle', () => {
  beforeEach(() => resetUnlockThrottle());

  it('allows the first attempts freely', () => {
    const now = 1_000_000;
    for (let i = 0; i < FREE_ATTEMPTS - 1; i++) recordUnlockFailure(now);
    expect(unlockRetryAfterSeconds(now)).toBe(0);
  });

  it('locks out after repeated failures and backs off exponentially', () => {
    const now = 1_000_000;
    for (let i = 0; i < FREE_ATTEMPTS; i++) recordUnlockFailure(now);
    const first = unlockRetryAfterSeconds(now);
    expect(first).toBeGreaterThan(0);
    recordUnlockFailure(now);
    expect(unlockRetryAfterSeconds(now)).toBe(first * 2);
  });

  it('lets an attempt through once the window has passed', () => {
    const now = 1_000_000;
    for (let i = 0; i < FREE_ATTEMPTS; i++) recordUnlockFailure(now);
    expect(unlockRetryAfterSeconds(now + 60_000)).toBe(0);
  });

  it('caps the window', () => {
    const now = 1_000_000;
    for (let i = 0; i < 40; i++) recordUnlockFailure(now);
    expect(unlockRetryAfterSeconds(now)).toBe(MAX_LOCKOUT_SECONDS);
  });

  it('clears on success', () => {
    const now = 1_000_000;
    for (let i = 0; i < FREE_ATTEMPTS; i++) recordUnlockFailure(now);
    recordUnlockSuccess();
    expect(unlockRetryAfterSeconds(now)).toBe(0);
  });
});
