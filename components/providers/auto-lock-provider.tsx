'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query/fetcher';
import { queryKeys } from '@/lib/query/keys';
import { showWarningToast } from '@/lib/toast';

interface LockConfig {
  hasUserPassphrase: boolean;
  autoLockMinutes: number | null;
}

/** How long the idle warning stays up. */
const WARNING_TOAST_MS = 30000;

/**
 * AutoLockProvider
 *
 * Headless provider that monitors user activity and triggers an auto-lock
 * after a configurable idle period. Only active when the user has set a
 * passphrase and enabled auto-lock in settings.
 *
 * The provider:
 * 1. Reads lock config from GET /api/v1/system/unlock (`queryKeys.system.unlock`,
 *    the same entry the Auto-Lock settings card reads and refreshes on save)
 * 2. Tracks DOM activity events (throttled to once per 30s)
 * 3. Checks idle time every 60s
 * 4. Shows a warning toast 1 minute before locking
 * 5. Locks by calling POST /api/v1/system/unlock?action=lock and redirecting to /unlock
 */
export function AutoLockProvider() {
  const lastActivityRef = useRef<number>(0);
  const configRef = useRef<LockConfig | null>(null);
  const warningShownRef = useRef(false);
  const lockingRef = useRef(false);
  const throttleTimerRef = useRef<number | null>(null);
  // Inactive on the setup and unlock pages, as decided when the app mounts.
  const [active] = useState(() => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname;
    return !(path.startsWith('/setup') || path === '/unlock');
  });

  const { data: unlockData } = useQuery({
    queryKey: queryKeys.system.unlock,
    queryFn: ({ signal }) =>
      apiFetch<{ hasUserPassphrase?: boolean; autoLockMinutes?: number | null }>('/api/v1/system/unlock', { signal }),
    enabled: active,
  });

  useEffect(() => {
    if (!unlockData) return;
    configRef.current = {
      hasUserPassphrase: unlockData.hasUserPassphrase ?? false,
      autoLockMinutes: unlockData.autoLockMinutes ?? null,
    };
    // Reset warning state when config changes
    warningShownRef.current = false;
  }, [unlockData]);

  const handleActivity = useCallback(() => {
    // Throttle: only update lastActivity at most once per 30s
    if (throttleTimerRef.current !== null) return;
    lastActivityRef.current = Date.now();
    warningShownRef.current = false;
    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = null;
    }, 30000);
  }, []);

  const triggerLock = useCallback(async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;

    // Save current location for return after unlock
    const returnPath = window.location.pathname + window.location.search;
    sessionStorage.setItem('quilltap-autolock-return', returnPath);

    try {
      await fetch('/api/v1/system/unlock?action=lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      console.error('[AutoLock] Failed to call lock endpoint');
    }

    // Full page reload to /unlock to reset all client state. This is the point
    // of the auto-lock: router.push() would leave decrypted data alive in
    // memory and in client caches, which is exactly what locking must discard.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full page load wanted: locking must discard decrypted data held in memory and client caches
    window.location.href = '/unlock';
  }, []);

  const showIdleWarning = useCallback(() => {
    if (warningShownRef.current) return;
    warningShownRef.current = true;
    showWarningToast(
      'Auto-Lock Warning: Quilltap will lock in approximately one minute due to inactivity. Move the mouse or press a key to remain.',
      WARNING_TOAST_MS,
    );
  }, []);

  useEffect(() => {
    // Initialize lastActivity on mount
    lastActivityRef.current = Date.now();

    // Skip on setup and unlock pages
    if (!active) return;

    // Activity event listeners
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const event of events) {
      document.addEventListener(event, handleActivity, { passive: true, capture: true });
    }

    // Idle check interval (every 60 seconds)
    const intervalId = window.setInterval(() => {
      const config = configRef.current;
      if (!config || !config.hasUserPassphrase || config.autoLockMinutes === null) {
        return;
      }

      const idleMs = Date.now() - lastActivityRef.current;
      const lockThresholdMs = config.autoLockMinutes * 60000;
      const warningThresholdMs = Math.max(0, (config.autoLockMinutes - 1) * 60000);

      if (idleMs >= lockThresholdMs) {
        triggerLock();
      } else if (idleMs >= warningThresholdMs && !warningShownRef.current) {
        showIdleWarning();
      }
    }, 60000);

    return () => {
      for (const event of events) {
        document.removeEventListener(event, handleActivity, { capture: true });
      }
      window.clearInterval(intervalId);
      if (throttleTimerRef.current !== null) {
        window.clearTimeout(throttleTimerRef.current);
      }
    };
  }, [active, handleActivity, triggerLock, showIdleWarning]);

  // Headless — renders nothing
  return null;
}
