'use client'

/**
 * App Layout
 *
 * Root layout wrapper with left sidebar and header.
 * Used for authenticated pages.
 *
 * @module components/layout/app-layout
 */

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from '@/components/providers/session-provider'
import { SidebarProvider } from '@/components/providers/sidebar-provider'
import { PageToolbarProvider } from '@/components/providers/page-toolbar-provider'
import { LeftSidebar } from './left-sidebar'
import { PageToolbar } from './page-toolbar'
import FooterWrapper from '@/components/footer-wrapper'
import { DevConsoleLayout } from '@/components/debug/DevConsole'
import { clientLogger } from '@/lib/client-logger'

interface AppLayoutProps {
  children: React.ReactNode
}

/**
 * Inner layout component that uses sidebar context
 */
function AppLayoutInner({ children }: AppLayoutProps) {
  const pathname = usePathname()
  const { data: session, status } = useSession()

  useEffect(() => {
    clientLogger.debug('AppLayout mounted', { pathname, authenticated: !!session })
  }, [pathname, session])

  // Don't render layout on auth pages
  const isAuthPage = pathname?.startsWith('/auth')

  // Show loading state while checking session
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Don't show sidebar/header for auth pages or unauthenticated users
  if (isAuthPage || !session) {
    return (
      <div className="flex flex-col h-screen bg-background text-foreground">
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    )
  }

  return (
    <div className="qt-app-layout">
      <LeftSidebar />
      <div className="qt-app-main">
        <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <PageToolbar />
          <DevConsoleLayout>
            {children}
          </DevConsoleLayout>
        </main>
        <FooterWrapper />
      </div>
    </div>
  )
}

/**
 * App Layout component with providers
 */
export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <PageToolbarProvider>
        <AppLayoutInner>{children}</AppLayoutInner>
      </PageToolbarProvider>
    </SidebarProvider>
  )
}
