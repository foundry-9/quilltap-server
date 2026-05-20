'use client';

/**
 * Startup Progress Loading Screen
 *
 * Polls `/api/v1/system/startup-status` every second and renders what the
 * server is currently working on — pretty phase, current label, recent
 * events, and any sub-progress tiers (e.g. "3/4 projects, 224/459 files").
 *
 * When the server transitions to `complete` / `ready`, this component
 * fires a global SWR revalidation so the rest of the app refreshes any
 * data it cached during the startup window, and stops polling.
 */

import { useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';

type ProgressTier = { current: number; total: number; unit: string };

interface StartupEvent {
  ts: number;
  phase: string;
  rawLabel: string;
  prettyLabel: string;
  detail?: string;
  level: 'info' | 'warn' | 'error';
  progress?: ProgressTier[];
}

interface StartupStatus {
  phase: string;
  isReady: boolean;
  isLockedMode: boolean;
  startedAt: number;
  readyAt: number | null;
  errorMessage: string | null;
  currentLabel: string | null;
  currentRawLabel: string | null;
  currentSubProgress: ProgressTier[] | null;
  recentEvents: StartupEvent[];
}

const POLL_INTERVAL_MS = 1000;

/**
 * Hook: returns the server's current startup phase, or null while we haven't
 * polled yet. Polling stops once a terminal phase (`complete` or `failed`) is
 * observed.
 *
 * Used by the app layout to decide whether to show the StartupProgress screen
 * or the real app — independently of whatever session.status says, since the
 * session endpoint can return 200 well before the server's subsystem work
 * (reconcile, vault backfill, mount-index rescan) actually finishes.
 */
export function useStartupPhase(): string | null {
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const response = await fetch('/api/v1/system/startup-status', {
          cache: 'no-store',
        });
        if (response.ok) {
          const data: StartupStatus = await response.json();
          setPhase(data.phase);
          if (data.phase === 'complete' || data.phase === 'failed') {
            return;
          }
        }
      } catch {
        // best-effort — keep polling
      }
      if (stopped) return;
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      stopped = true;
    };
  }, []);

  return phase;
}

const PHASE_HEADLINE: Record<string, string> = {
  pending: 'Just getting our bearings',
  locked: 'Awaiting your passphrase',
  migrations: 'Bringing the records up to date',
  seeding: 'Setting out the initial furnishings',
  'plugin-updates': 'Polishing the plugin brass',
  plugins: 'Mustering the plugins',
  'file-storage': 'Reconciling the file ledger',
  complete: 'At your service',
  failed: 'Something has gone amiss',
};

function phaseHeadline(phase: string): string {
  return PHASE_HEADLINE[phase] ?? 'Working on something';
}

function formatTier(t: ProgressTier): string {
  return t.total > 0 ? `${t.current}/${t.total} ${t.unit}` : `${t.current} ${t.unit}`;
}

function formatRelativeAge(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export function StartupProgress() {
  const { mutate } = useSWRConfig();
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const stoppedRef = useRef(false);
  const revalidatedRef = useRef(false);

  useEffect(() => {
    stoppedRef.current = false;

    async function poll() {
      if (stoppedRef.current) return;
      try {
        const response = await fetch('/api/v1/system/startup-status', {
          cache: 'no-store',
        });
        if (!response.ok) {
          setFetchError(`status endpoint returned ${response.status}`);
        } else {
          const data: StartupStatus = await response.json();
          setStatus(data);
          setFetchError(null);

          // Once the server reports ready, revalidate all SWR caches one time
          // so any data fetched during the startup window (and likely empty
          // or errored) gets refreshed.
          if ((data.phase === 'complete' || data.isReady) && !revalidatedRef.current) {
            revalidatedRef.current = true;
            mutate(() => true, undefined, { revalidate: true });
          }
        }
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : String(err));
      }

      if (stoppedRef.current) return;
      setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      stoppedRef.current = true;
    };
  }, [mutate]);

  const phase = status?.phase ?? 'pending';
  const isErrored = phase === 'failed';
  const headline = isErrored ? phaseHeadline('failed') : phaseHeadline(phase);
  const currentLabel = status?.currentLabel ?? null;
  const subProgress = status?.currentSubProgress;
  const events = status?.recentEvents ?? [];

  return (
    <div className="flex h-screen items-center justify-center p-6">
      <div className="qt-card flex w-full max-w-xl flex-col gap-4 p-8">
        <div className="flex flex-col gap-1">
          <div className="qt-text-tertiary text-xs uppercase tracking-wide">
            Quilltap is starting up
          </div>
          <h1 className={`text-2xl ${isErrored ? 'qt-text-danger' : 'qt-text-primary'}`}>
            {headline}
          </h1>
          {currentLabel && !isErrored && (
            <div className="qt-text-secondary text-base">
              {currentLabel}
            </div>
          )}
          {status?.errorMessage && (
            <div className="qt-text-danger mt-2 text-sm">
              {status.errorMessage}
            </div>
          )}
        </div>

        {subProgress && subProgress.length > 0 && (
          <div className="flex flex-col gap-1 text-sm qt-text-secondary">
            {subProgress.map((tier, i) => (
              <div key={i} className={i === 0 ? '' : 'pl-4'}>
                {formatTier(tier)}
              </div>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <div className="qt-divider mt-2 border-t pt-3">
            <div className="qt-text-tertiary mb-2 text-xs uppercase tracking-wide">
              Recently
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {events.slice(-5).reverse().map((event, i) => (
                <li
                  key={`${event.ts}-${i}`}
                  className={
                    event.level === 'error'
                      ? 'qt-text-danger'
                      : event.level === 'warn'
                        ? 'qt-text-warning'
                        : 'qt-text-secondary'
                  }
                >
                  <span className="qt-text-tertiary mr-2 tabular-nums">
                    {formatRelativeAge(event.ts)}
                  </span>
                  {event.prettyLabel}
                  {event.detail && (
                    <span className="qt-text-tertiary"> — {event.detail}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {fetchError && !status && (
          <div className="qt-text-tertiary animate-pulse text-sm">
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
