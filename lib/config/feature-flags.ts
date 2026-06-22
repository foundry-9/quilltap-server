/**
 * Lightweight feature flags.
 *
 * The codebase had no general flag system; this is a single, dependency-light
 * place to gate in-progress features. Flags are evaluated at module load and
 * are safe to read on the client.
 *
 * @module lib/config/feature-flags
 */

/**
 * The tabbed workspace (`/workspace`). While `false`, the workspace route still
 * renders for development, but the old per-surface routes keep working and the
 * post-login landing stays the legacy home dashboard. Phase 6 flips this on to
 * wire redirects + landing into the workspace.
 *
 * Override at build/run time with `NEXT_PUBLIC_WORKSPACE_TABS=1`.
 */
export const WORKSPACE_TABS_ENABLED: boolean =
  process.env.NEXT_PUBLIC_WORKSPACE_TABS === '1'

export function isWorkspaceTabsEnabled(): boolean {
  return WORKSPACE_TABS_ENABLED
}
