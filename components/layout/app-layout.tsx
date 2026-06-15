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
import { BrahmaConsoleProvider } from '@/components/providers/brahma-console-provider'
import { BrahmaConsoleDialog } from '@/components/brahma-console/BrahmaConsoleDialog'
import { WardrobeDialogProvider } from '@/components/providers/wardrobe-dialog-provider'
import { WardrobeControlDialog } from '@/components/wardrobe/wardrobe-control-dialog'
import { LeftSidebar } from './left-sidebar'
import { PageToolbar } from './page-toolbar'
import FooterWrapper from '@/components/footer-wrapper'
import { StartupProgress, useStartupPhase } from '@/components/loading/StartupProgress'
import { useDictionaryFeed } from '@/lib/spellcheck/useDictionaryFeed'

interface AppLayoutProps {
  children: React.ReactNode
}

/**
 * Inner layout component that uses sidebar context
 */
function AppLayoutInner({ children }: AppLayoutProps) {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const startupPhase = useStartupPhase()

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

  // Show the startup-progress screen while session resolves OR the server
  // hasn't reached the `complete` phase yet. The startup-status poll covers
  // the gap where session.status flips to authenticated but reconciliation /
  // vault backfill / mount rescan are still running and their endpoints
  // would 500 if the app tried to fetch from them.
  const startupNotComplete =
    startupPhase != null && startupPhase !== 'complete'
  if (status === 'loading' || startupNotComplete) {
    return <StartupProgress />
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
      <BrahmaConsoleProvider>
        <WardrobeDialogProvider>
          <DictionaryFeedMount />
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
          <BrahmaConsoleDialog />
          <WardrobeControlDialog />
        </WardrobeDialogProvider>
      </BrahmaConsoleProvider>
    </HelpChatProvider>
  )
}

/**
 * Renderless component that feeds Aurora character names into the Electron
 * shell's custom spellchecker dictionary. Mounts only inside the authenticated
 * branch so the `/api/v1/characters` SWR call doesn't fire on auth pages.
 */
function DictionaryFeedMount() {
  useDictionaryFeed()
  return null
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
