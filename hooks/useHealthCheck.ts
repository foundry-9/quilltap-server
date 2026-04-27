'use client';

import { useSyncExternalStore } from 'react';

interface HealthState {
  lockConflict: LockConflict | null;
  versionBlock: VersionBlock | null;
}

interface LockConflict {
  pid: number;
  hostname: string;
  environment: string;
  startedAt: string;
  lockPath: string;
}

interface VersionBlock {
  currentVersion: string;
  highestVersion: string;
}

// Module-level singleton so every component shares one poller
let state: HealthState = { lockConflict: null, versionBlock: null };
let listeners = new Set<() => void>();
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let subscriberCount = 0;
let initialCheckDone = false;

function notify() {
  for (const listener of listeners) listener();
}

function setState(next: HealthState) {
  state = next;
  notify();
}

function getSnapshot(): HealthState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  subscriberCount++;

  // Start the health check on first subscriber
  if (subscriberCount === 1) {
    startChecking();
  }

  return () => {
    listeners.delete(listener);
    subscriberCount--;
    if (subscriberCount === 0) {
      stopPolling();
      initialCheckDone = false;
    }
  };
}

async function checkHealth() {
  try {
    const res = await fetch('/api/health');

    if (res.status === 409) {
      const data = await res.json();
      setState({
        lockConflict: data.lockConflict ?? null,
        versionBlock: data.versionBlock ?? null,
      });
      // Problem detected — ensure we're polling to detect resolution
      ensurePolling();
    } else {
      const hadProblem = state.lockConflict || state.versionBlock;
      setState({ lockConflict: null, versionBlock: null });
      // No problem — stop polling (the initial check is enough)
      if (!hadProblem) {
        stopPolling();
      }
      // If we just resolved a problem, keep polling one more cycle
      // to confirm, then the next clean check will stop it
    }
  } catch {
    // Server not responding — don't change state
  }
}

function startChecking() {
  if (!initialCheckDone) {
    initialCheckDone = true;
    checkHealth();
  }
}

function ensurePolling() {
  if (!pollingInterval) {
    pollingInterval = setInterval(checkHealth, 5000);
  }
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Shared health-check hook. Fetches /api/health once on mount.
 * Only starts 5-second polling if a 409 (lock conflict or version block)
 * is detected, and stops polling once the problem resolves.
 */
export function useHealthCheck(): HealthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
