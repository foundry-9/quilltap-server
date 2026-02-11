'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type PepperState = 'resolved' | 'needs-setup' | 'needs-unlock' | 'needs-vault-storage' | 'loading';

export default function SetupPage() {
  const router = useRouter();
  const [pepperState, setPepperState] = useState<PepperState>('loading');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [generatedPepper, setGeneratedPepper] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [copied, setCopied] = useState(false);

  /** Navigate to /setup/profile if no user character exists, otherwise / */
  const navigateAfterSetup = useCallback(async () => {
    try {
      const charRes = await fetch('/api/v1/characters?controlledBy=user&limit=1');
      if (charRes.ok) {
        const charData = await charRes.json();
        const characters = charData.characters || [];
        if (characters.length === 0) {
          router.push('/setup/profile');
          return;
        }
      }
    } catch {
      // Non-critical — fall through to home
    }
    router.push('/');
  }, [router]);

  const checkState = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/pepper-vault');
      const data = await res.json();
      setPepperState(data.state);

      if (data.state === 'resolved') {
        navigateAfterSetup();
      }
    } catch {
      setError('Failed to check pepper vault status');
    }
  }, [navigateAfterSetup]);

  useEffect(() => {
    checkState();
  }, [checkState]);

  const handleSetup = async () => {
    setError('');

    if (passphrase && passphrase !== confirmPassphrase) {
      setError('Passphrases do not match');
      return;
    }

    if (passphrase && passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/system/pepper-vault?action=setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Setup failed');
        return;
      }

      setGeneratedPepper(data.pepper);
      setPepperState('resolved');
    } catch {
      setError('Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    setError('');

    if (!passphrase) {
      setError('Passphrase is required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/system/pepper-vault?action=unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });

      const data = await res.json();

      if (!res.ok) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= 3) {
          setError('Too many failed attempts. You can set ENCRYPTION_MASTER_PEPPER as an environment variable instead.');
        } else {
          setError(data.error || 'Unlock failed');
        }
        return;
      }

      await navigateAfterSetup();
    } catch {
      setError('Failed to unlock');
    } finally {
      setLoading(false);
    }
  };

  const handleStore = async () => {
    setError('');

    if (passphrase && passphrase !== confirmPassphrase) {
      setError('Passphrases do not match');
      return;
    }

    if (passphrase && passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/system/pepper-vault?action=store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to store pepper');
        return;
      }

      await navigateAfterSetup();
    } catch {
      setError('Failed to store pepper');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedPepper);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text
    }
  };

  if (pepperState === 'loading') {
    return (
      <div className="qt-auth-page flex items-center justify-center min-h-screen">
        <div className="qt-spinner" />
      </div>
    );
  }

  // After setup, show the generated pepper
  if (generatedPepper) {
    return (
      <div className="qt-auth-page flex items-center justify-center min-h-screen p-4">
        <div className="qt-card max-w-lg w-full p-6 space-y-4">
          <h1 className="qt-heading-2">Setup Complete</h1>
          <div className="qt-alert qt-alert-warning">
            <p className="qt-text-small font-semibold">Save this encryption pepper now. It will not be shown again.</p>
            <p className="qt-text-xs qt-text-muted mt-1">
              If you ever need to recover your data without a passphrase, you will need this value
              set as the <code className="qt-code-inline">ENCRYPTION_MASTER_PEPPER</code> environment variable.
            </p>
          </div>
          <div className="relative">
            <pre className="qt-code-block p-3 text-sm break-all whitespace-pre-wrap select-all">{generatedPepper}</pre>
            <button
              onClick={handleCopy}
              className="qt-btn absolute top-2 right-2 text-xs px-2 py-1"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => navigateAfterSetup()}
            className="qt-btn w-full py-2"
          >
            Continue to Quilltap
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="qt-auth-page flex items-center justify-center min-h-screen p-4">
      <div className="qt-card max-w-lg w-full p-6 space-y-4">
        {pepperState === 'needs-setup' && (
          <>
            <h1 className="qt-heading-2">Welcome to Quilltap</h1>
            <p className="qt-text-muted">
              Quilltap needs an encryption key to protect your API keys and sensitive data.
              One will be generated automatically. You can optionally protect it with a passphrase.
            </p>
            <div className="space-y-3">
              <div>
                <label className="qt-text-label block mb-1">Passphrase (optional)</label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Leave empty for no passphrase"
                  className="qt-input w-full p-2"
                  disabled={loading}
                />
                <p className="qt-text-xs qt-text-muted mt-1">
                  If set, you will need to enter this passphrase each time Quilltap starts.
                </p>
              </div>
              {passphrase && (
                <div>
                  <label className="qt-text-label block mb-1">Confirm passphrase</label>
                  <input
                    type="password"
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    placeholder="Confirm your passphrase"
                    className="qt-input w-full p-2"
                    disabled={loading}
                  />
                </div>
              )}
            </div>
            {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}
            <button
              onClick={handleSetup}
              disabled={loading}
              className="qt-btn w-full py-2"
            >
              {loading ? 'Setting up...' : passphrase ? 'Set Up with Passphrase' : 'Set Up without Passphrase'}
            </button>
          </>
        )}

        {pepperState === 'needs-unlock' && (
          <>
            <h1 className="qt-heading-2">Quilltap is Locked</h1>
            <p className="qt-text-muted">
              Enter the passphrase you set during setup to unlock Quilltap.
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
              />
            </div>
            {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}
            <button
              onClick={handleUnlock}
              disabled={loading || attempts >= 3}
              className="qt-btn w-full py-2"
            >
              {loading ? 'Unlocking...' : 'Unlock'}
            </button>
          </>
        )}

        {pepperState === 'needs-vault-storage' && (
          <>
            <h1 className="qt-heading-2">Secure Your Encryption Key</h1>
            <p className="qt-text-muted">
              Your encryption key is set via environment variable. Store it in the encrypted vault
              so Quilltap can start without the environment variable in the future.
            </p>
            <div className="space-y-3">
              <div>
                <label className="qt-text-label block mb-1">Passphrase (optional)</label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Leave empty for no passphrase"
                  className="qt-input w-full p-2"
                  disabled={loading}
                />
                <p className="qt-text-xs qt-text-muted mt-1">
                  If set, you will need this passphrase when starting without the environment variable.
                </p>
              </div>
              {passphrase && (
                <div>
                  <label className="qt-text-label block mb-1">Confirm passphrase</label>
                  <input
                    type="password"
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    placeholder="Confirm your passphrase"
                    className="qt-input w-full p-2"
                    disabled={loading}
                  />
                </div>
              )}
            </div>
            {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleStore}
                disabled={loading}
                className="qt-btn flex-1 py-2"
              >
                {loading ? 'Storing...' : 'Store in Vault'}
              </button>
              <button
                onClick={() => navigateAfterSetup()}
                className="qt-btn flex-1 py-2 opacity-60"
              >
                Skip for Now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
