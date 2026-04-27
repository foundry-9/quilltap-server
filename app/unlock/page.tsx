'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type DbKeyState = 'resolved' | 'needs-setup' | 'needs-passphrase' | 'needs-vault-storage' | 'loading';

export default function UnlockPage() {
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

  const checkState = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/unlock');
      const data = await res.json();
      setState(data.state);

      if (data.state === 'resolved') {
        returnToApp();
      } else if (data.state === 'needs-setup') {
        // This is a cold start, not an auto-lock — go to setup
        router.push('/setup');
      }
    } catch {
      setError('Unable to reach the server. Please try again in a moment.');
    }
  }, [returnToApp, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch triggered on mount; return signature contract predates useSWR migration
    checkState();
  }, [checkState]);

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

  if (state === 'loading') {
    return (
      <div className="qt-auth-page flex items-center justify-center min-h-screen">
        <div className="qt-spinner" />
      </div>
    );
  }

  if (state !== 'needs-passphrase') {
    return (
      <div className="qt-auth-page flex items-center justify-center min-h-screen">
        <div className="qt-spinner" />
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
          <label className="qt-text-label block mb-1">Passphrase</label>
          <input
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
