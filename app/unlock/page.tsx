'use client';

import { useId, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type DbKeyState = 'resolved' | 'needs-setup' | 'needs-passphrase' | 'needs-vault-storage' | 'loading';

export default function UnlockPage() {
  const fieldId = useId();
  const router = useRouter();
  const [state, setState] = useState<DbKeyState>('loading');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isAutoLockReturn, setIsAutoLockReturn] = useState(false);

  // sessionStorage read must happen after hydration; a lazy useState initializer
  // would cause an SSR mismatch (server renders with false, client with
  // sessionStorage value).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
    setIsAutoLockReturn(!!sessionStorage.getItem('quilltap-autolock-return'));
  }, []);

  const returnToApp = useCallback(() => {
    const returnUrl = typeof window !== 'undefined'
      ? sessionStorage.getItem('quilltap-autolock-return') || '/'
      : '/';
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('quilltap-autolock-return');
    }
    // Full page reload to re-initialize all client state
    window.location.href = returnUrl;
  }, []);

  // The state check retries until it gets a usable answer. A cold dev server
  // can fail or answer non-JSON while the route compiles, and a one-shot check
  // left the page on a bare spinner with nothing to say for itself.
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function checkState() {
      try {
        const res = await fetch('/api/v1/system/unlock', { cache: 'no-store' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (typeof data?.state !== 'string') throw new Error('no state in response');

        setRetrying(false);
        setState(data.state);

        if (data.state === 'resolved' || data.state === 'needs-vault-storage') {
          // Both are operational: the key is in hand.
          returnToApp();
        } else if (data.state === 'needs-setup') {
          // This is a cold start, not an auto-lock — go to setup
          router.push('/setup');
        }
      } catch {
        if (cancelled) return;
        setRetrying(true);
        timer = setTimeout(checkState, 2000);
      }
    }

    checkState();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [returnToApp, router]);

  const handleUnlock = async () => {
    setError('');

    if (!passphrase) {
      setError('A passphrase is required to unlock.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/system/unlock?action=unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });

      const data = await res.json();

      if (!res.ok) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= 3) {
          setError('Three attempts exhausted. You may set ENCRYPTION_MASTER_PEPPER as an environment variable and restart.');
        } else {
          setError(data.error || 'That passphrase did not work. Do try again.');
        }
        return;
      }

      returnToApp();
    } catch {
      setError('Failed to unlock. The server may have gone on holiday.');
    } finally {
      setLoading(false);
    }
  };

  if (state !== 'needs-passphrase') {
    return (
      <div className="qt-auth-page flex flex-col items-center justify-center gap-3 min-h-screen">
        <div className="qt-spinner" />
        {retrying && (
          <p className="qt-text-small qt-text-muted" role="status">
            The front desk is not answering just yet. Ringing again presently&hellip;
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="qt-auth-page flex items-center justify-center min-h-screen p-4">
      <div className="qt-card max-w-lg w-full p-6 space-y-4">
        <h1 className="qt-heading-2">
          {isAutoLockReturn ? 'The Establishment Has Been Secured' : 'Quilltap Awaits Your Credentials'}
        </h1>
        <p className="qt-text-muted">
          {isAutoLockReturn
            ? 'Quilltap has locked itself after a period of inactivity, much as a conscientious butler secures the silver when the household retires for the evening. Kindly supply your passphrase to resume where you left off.'
            : 'Your encryption key is protected by a passphrase, rather like a safe-deposit box that requires both key and signature. Kindly supply it so the establishment may open for the day.'}
        </p>
        <div>
          <label htmlFor={`${fieldId}-f0`} className="qt-text-label block mb-1">Passphrase</label>
          <input
            id={`${fieldId}-f0`}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Enter your passphrase"
            className="qt-input w-full p-2"
            disabled={loading || attempts >= 3}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            autoFocus
          />
        </div>
        {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}
        <button
          onClick={handleUnlock}
          disabled={loading || attempts >= 3}
          className="qt-button qt-button-primary w-full py-2"
        >
          {loading ? 'Unlocking...' : 'Unlock'}
        </button>
        {isAutoLockReturn && (
          <p className="qt-text-xs qt-text-muted text-center">
            This lock was triggered by the auto-lock idle timer. Your work remains exactly as you left it.
          </p>
        )}
      </div>
    </div>
  );
}
