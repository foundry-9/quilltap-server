'use client'

/**
 * App Layout
 *
 * Root layout wrapper with left sidebar and header.
 * Used for authenticated pages.
 *
 * @module components/layout/app-layout
 */

import { usePathname } from 'next/navigation'
import { useSession } from '@/components/providers/session-provider'
import { SidebarProvider } from '@/components/providers/sidebar-provider'
import { PageToolbarProvider } from '@/components/providers/page-toolbar-provider'
import { HelpChatProvider } from '@/components/providers/help-chat-provider'
import { HelpChatDialog } from '@/components/help-chat/HelpChatDialog'
import { LeftSidebar } from './left-sidebar'
import { PageToolbar } from './page-toolbar'
import FooterWrapper from '@/components/footer-wrapper'

interface AppLayoutProps {
  children: React.ReactNode
}

/**
 * Inner layout component that uses sidebar context
 */
function AppLayoutInner({ children }: AppLayoutProps) {
  const pathname = usePathname()
  const { data: session, status } = useSession()

  // Don't render layout on auth, setup, or unlock pages
  const isAuthPage = pathname?.startsWith('/auth')
  const isSetupPage = pathname?.startsWith('/setup')
  const isUnlockPage = pathname === '/unlock'

  // Setup and unlock pages bypass session check entirely (pepper may not be resolved yet)
  if (isSetupPage || isUnlockPage) {
    return (
      <div className="flex flex-col h-screen bg-background text-foreground">
        <main className="flex-1 min-h-0 overflow-auto">
          {children}
        </main>
      </div>
    )
  }

  // Show loading state while checking session
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse qt-text-secondary">Loading...</div>
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
    <HelpChatProvider>
      <div className="qt-app-layout">
        <LeftSidebar />
        <div className="qt-app-main">
          <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <PageToolbar />
            <div className="flex-1 min-h-0 overflow-y-auto">
              {children}
            </div>
          </main>
          <FooterWrapper />
        </div>
      </div>
      <HelpChatDialog />
    </HelpChatProvider>
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
