'use client'

/**
 * WorkspaceProviders — the workspace store + registries, mounted once.
 *
 * When the tabbed workspace is enabled these live in `AppLayout` (the root
 * layout, which never unmounts across navigation), so the shared left rail and
 * the page content both read the same store and in-app navigation is pure
 * `openTab` with full keep-alive — no route change, no remount.
 *
 * {@link EnsureWorkspaceProviders} is idempotent: if a WorkspaceProvider is
 * already above it (the enabled, app-level case) it renders children as-is;
 * otherwise it provides its own (so the dev-only `/workspace` route works even
 * when the flag is off). This prevents two nested stores with divergent state.
 *
 * @module components/workspace/WorkspaceProviders
 */

import type { ReactNode } from 'react'
import {
  WorkspaceProvider,
  useWorkspaceOptional,
} from '@/components/providers/workspace-provider'
import { TabToolbarRegistryProvider } from '@/components/workspace/tab-toolbar'
import { WorkspacePortalRegistryProvider } from '@/components/workspace/workspace-tab-context'
import { WorkspaceBackdropProvider } from '@/components/workspace/workspace-backdrop'
import { WorkspaceLinkInterceptor } from '@/components/workspace/WorkspaceLinkInterceptor'

export function WorkspaceProviders({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <TabToolbarRegistryProvider>
        <WorkspacePortalRegistryProvider>
          <WorkspaceBackdropProvider>
            {/* Keep every in-app link keep-alive-safe while in the workspace. */}
            <WorkspaceLinkInterceptor />
            {children}
          </WorkspaceBackdropProvider>
        </WorkspacePortalRegistryProvider>
      </TabToolbarRegistryProvider>
    </WorkspaceProvider>
  )
}

export function EnsureWorkspaceProviders({ children }: { children: ReactNode }) {
  const existing = useWorkspaceOptional()
  if (existing) return <>{children}</>
  return <WorkspaceProviders>{children}</WorkspaceProviders>
}
