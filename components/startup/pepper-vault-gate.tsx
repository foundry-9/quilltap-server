'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

type PepperState = 'resolved' | 'needs-setup' | 'needs-unlock' | 'needs-vault-storage';

let gateFetched = false;

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

  useEffect(() => {
    // Don't check if we're already on a setup page
    if (pathname === '/setup' || pathname?.startsWith('/setup/')) {
      // Reset the flag so we re-check when navigating away from setup
      gateFetched = false;
      return;
    }

    // Only fetch once per app lifecycle
    if (gateFetched) return;
    gateFetched = true;

    async function checkPepperState() {
      try {
        const res = await fetch('/api/v1/system/pepper-vault');
        if (!res.ok) return;

        const data = await res.json();
        const state: PepperState = data.state;

        if (state === 'needs-setup' || state === 'needs-unlock') {
          router.push('/setup');
        } else if (state === 'needs-vault-storage') {
          setShowBanner(true);
        }

        // If pepper is resolved, check for user character existence
        if (state === 'resolved' || state === 'needs-vault-storage') {
          try {
            const charRes = await fetch('/api/v1/characters?controlledBy=user&limit=1');
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
        // If we can't reach the API, don't block — the server middleware
        // will return 503 for protected routes anyway.
      }
    }

    checkPepperState();
  }, [pathname, router]);

  if (!showBanner) return null;

  return (
    <div className="qt-alert qt-alert-info mx-4 mt-2 flex items-center justify-between text-sm">
      <span>
        Your encryption key is not yet stored in the vault.{' '}
        <a href="/setup" className="underline font-medium">
          Set it up now
        </a>{' '}
        for easier restarts.
      </span>
      <button
        onClick={() => setShowBanner(false)}
        className="qt-btn text-xs px-2 py-1 ml-4"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}
