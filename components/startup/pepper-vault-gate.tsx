'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

type DbKeyState = 'resolved' | 'needs-setup' | 'needs-passphrase' | 'needs-vault-storage';

/** Track whether the gate check has succeeded (not just attempted) */
let gateResolved = false;

/**
 * PepperVaultGate
 *
 * Client component that checks pepper vault status on mount.
 * Redirects to /setup if the pepper needs setup or unlock.
 * Shows a dismissible banner if the env var pepper is not yet stored in the vault.
 */
export function PepperVaultGate() {
  const router = useRouter();
  const pathname = usePathname();
  const [showBanner, setShowBanner] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Don't check if we're already on a setup page or unlock page
    if (pathname === '/setup' || pathname?.startsWith('/setup/') || pathname === '/unlock') {
      // Reset the flag so we re-check when navigating away from setup
      gateResolved = false;
      return;
    }

    // Only fetch once per app lifecycle (after a successful check)
    if (gateResolved) return;

    let cancelled = false;

    async function checkDbKeyState() {
      try {
        const res = await fetch('/api/v1/system/unlock');
        if (cancelled) return;

        if (!res.ok) {
          // Server not ready yet — retry
          scheduleRetry();
          return;
        }

        const data = await res.json();
        const state: DbKeyState = data.state;

        // Mark as resolved so we don't re-check
        gateResolved = true;

        if (state === 'needs-setup') {
          router.push('/setup');
          return;
        }

        if (state === 'needs-passphrase') {
          // Always go to /unlock for passphrase entry — whether cold start or auto-lock
          router.push('/unlock');
          return;
        }

        if (state === 'needs-vault-storage') {
          setShowBanner(true);
        }

        // If pepper is resolved, check for user character existence
        if (state === 'resolved' || state === 'needs-vault-storage') {
          try {
            const charRes = await fetch('/api/v1/characters?controlledBy=user&limit=1');
            if (cancelled) return;
            if (charRes.ok) {
              const charData = await charRes.json();
              const characters = charData.characters || [];
              if (characters.length === 0) {
                router.push('/setup/profile');
              }
            }
          } catch {
            // Non-critical — don't block the app if this check fails
          }
        }
      } catch {
        if (cancelled) return;
        // If we can't reach the API, retry — the server may still be starting
        scheduleRetry();
      }
    }

    function scheduleRetry() {
      if (cancelled) return;
      retryTimerRef.current = setTimeout(() => {
        if (!cancelled) {
          checkDbKeyState();
        }
      }, 2000);
    }

    checkDbKeyState();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [pathname, router]);

  if (!showBanner) return null;

  return (
    <div className="qt-alert qt-alert-info mx-4 mt-2 flex items-center justify-between text-sm">
      <span>
        Your encryption key is not yet stored in a .dbkey file.{' '}
        <a href="/setup" className="underline font-medium">
          Set it up now
        </a>{' '}
        for easier restarts.
      </span>
      <button
        onClick={() => setShowBanner(false)}
        className="qt-button qt-button-ghost text-xs px-2 py-1 ml-4"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
