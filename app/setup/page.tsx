'use client';

import { useId, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import type { DbKeyState as ServerDbKeyState } from '@/lib/startup/dbkey';

type DbKeyState = ServerDbKeyState | 'loading';

/** The passphrase rule both forms enforce: optional, but confirmed and 8+ characters when given. */
function passphraseError(passphrase: string, confirmPassphrase: string): string | null {
  if (passphrase && passphrase !== confirmPassphrase) return 'Passphrases do not match';
  if (passphrase && passphrase.length < 8) return 'Passphrase must be at least 8 characters';
  return null;
}

interface PassphraseFieldsProps {
  fieldId: string;
  passphrase: string;
  confirmPassphrase: string;
  onPassphraseChange: (value: string) => void;
  onConfirmChange: (value: string) => void;
  disabled: boolean;
  /** The line under the passphrase field */
  hint: string;
}

/** The optional passphrase and, once one is typed, its confirmation. */
function PassphraseFields({
  fieldId,
  passphrase,
  confirmPassphrase,
  onPassphraseChange,
  onConfirmChange,
  disabled,
  hint,
}: PassphraseFieldsProps) {
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${fieldId}-f0`} className="qt-text-label block mb-1">Passphrase (optional)</label>
        <input
          id={`${fieldId}-f0`}
          type="password"
          value={passphrase}
          onChange={(e) => onPassphraseChange(e.target.value)}
          placeholder="Leave empty for no passphrase"
          className="qt-input w-full p-2"
          disabled={disabled}
        />
        <p className="qt-text-xs qt-text-muted mt-1">{hint}</p>
      </div>
      {passphrase && (
        <div>
          <label htmlFor={`${fieldId}-f1`} className="qt-text-label block mb-1">Confirm passphrase</label>
          <input
            id={`${fieldId}-f1`}
            type="password"
            value={confirmPassphrase}
            onChange={(e) => onConfirmChange(e.target.value)}
            placeholder="Confirm your passphrase"
            className="qt-input w-full p-2"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

export default function SetupPage() {
  const fieldId = useId();
  const router = useRouter();
  const [pepperState, setDbKeyState] = useState<DbKeyState>('loading');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [generatedPepper, setGeneratedPepper] = useState('');
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  /** Navigate to /setup/profile if no user character exists, then /setup/providers if no profiles, otherwise / */
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
      // Non-critical — fall through to profile check
    }

    // Check if connection profiles exist; if not, redirect to provider wizard
    try {
      const profilesRes = await fetch('/api/v1/connection-profiles');
      if (profilesRes.ok) {
        const profilesData = await profilesRes.json();
        const profiles = profilesData.profiles || [];
        if (profiles.length === 0) {
          // Full page load, not router.push: the database was just unlocked, so
          // the session provider and all client caches must be rebuilt from
          // scratch before the next setup step reads them.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full page load wanted: the just-unlocked database needs a fresh session provider and empty client caches
          window.location.href = '/setup/providers';
          return;
        }
      }
    } catch {
      // Non-critical — fall through to home
    }

    // Full page load to re-initialize session provider and all client state
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full page load wanted: the just-unlocked database needs a fresh session provider and empty client caches
    window.location.href = '/';
  }, [router]);

  const checkState = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/system/unlock');
      const data = await res.json();
      setDbKeyState(data.state);

      if (data.state === 'resolved') {
        navigateAfterSetup();
      } else if (data.state === 'needs-passphrase') {
        // Passphrase unlock is handled by /unlock, not /setup
        router.push('/unlock');
      }
    } catch {
      setError('Failed to check pepper vault status');
    }
  }, [navigateAfterSetup, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot unlock-state check on mount; checkState fetches and sets dbKeyState/error after the await, then may navigate
    checkState();
  }, [checkState]);

  const handleSetup = async () => {
    setError('');

    const invalid = passphraseError(passphrase, confirmPassphrase);
    if (invalid) {
      setError(invalid);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/system/unlock?action=setup', {
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
      setRequiresRestart(Boolean(data.requiresRestart));
      setDbKeyState('resolved');
    } catch {
      setError('Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  const handleStore = async () => {
    setError('');

    const invalid = passphraseError(passphrase, confirmPassphrase);
    if (invalid) {
      setError(invalid);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/system/unlock?action=store', {
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

  const handleCopy = () => copy(generatedPepper);

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
              className="qt-button qt-button-ghost absolute top-2 right-2 text-xs px-2 py-1"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {requiresRestart && (
            <div className="qt-alert qt-alert-warning">
              <p className="qt-text-small font-semibold">One last formality: please restart Quilltap.</p>
              <p className="qt-text-xs qt-text-muted mt-1">
                Your key is safely stored and your data is entirely intact — the strongroom door
                simply refused to swing back open on the first ask. Stop Quilltap and start it
                again, and the establishment will be in perfect working order.
              </p>
            </div>
          )}
          <button
            onClick={() => navigateAfterSetup()}
            className="qt-button qt-button-primary w-full py-2"
          >
            {requiresRestart ? 'Continue Anyway' : 'Continue to Quilltap'}
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
            <PassphraseFields
              fieldId={fieldId}
              passphrase={passphrase}
              confirmPassphrase={confirmPassphrase}
              onPassphraseChange={setPassphrase}
              onConfirmChange={setConfirmPassphrase}
              disabled={loading}
              hint="If set, you will need to enter this passphrase each time Quilltap starts."
            />
            {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}
            <button
              onClick={handleSetup}
              disabled={loading}
              className="qt-button qt-button-primary w-full py-2"
            >
              {loading ? 'Setting up...' : passphrase ? 'Set Up with Passphrase' : 'Set Up without Passphrase'}
            </button>
          </>
        )}

        {pepperState === 'needs-vault-storage' && (
          <>
            <h1 className="qt-heading-2">Secure Your Encryption Key</h1>
            <p className="qt-text-muted">
              Your encryption key is set via environment variable. Store it in an encrypted .dbkey file
              so Quilltap can start without the environment variable in the future.
            </p>
            <PassphraseFields
              fieldId={fieldId}
              passphrase={passphrase}
              confirmPassphrase={confirmPassphrase}
              onPassphraseChange={setPassphrase}
              onConfirmChange={setConfirmPassphrase}
              disabled={loading}
              hint="If set, you will need this passphrase when starting without the environment variable."
            />
            {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleStore}
                disabled={loading}
                className="qt-button qt-button-primary flex-1 py-2"
              >
                {loading ? 'Storing...' : 'Store Key File'}
              </button>
              <button
                onClick={() => navigateAfterSetup()}
                className="qt-button qt-button-secondary flex-1 py-2 opacity-60"
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
