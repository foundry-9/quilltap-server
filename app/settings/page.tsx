'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { BrandName } from '@/components/ui/brand-name'
import { EntityTabs } from '@/components/tabs/entity-tabs'
import { ChatSettingsProvider } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { ProvidersTabContent } from '@/components/settings/tabs/ProvidersTabContent'
import { ChatTabContent } from '@/components/settings/tabs/ChatTabContent'
import { AppearanceTabContent } from '@/components/settings/tabs/AppearanceTabContent'
import { MemorySearchTabContent } from '@/components/settings/tabs/MemorySearchTabContent'
import { ImagesTabContent } from '@/components/settings/tabs/ImagesTabContent'
import { TemplatesPromptsTabContent } from '@/components/settings/tabs/TemplatesPromptsTabContent'
import { DataSystemTabContent } from '@/components/settings/tabs/DataSystemTabContent'
import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { ChatIcon } from '@/components/ui/icons'
import type { Tab } from '@/components/tabs/entity-tabs'
import type { SubsystemId } from '@/lib/foundry/subsystem-defaults'

/** Map settings tab IDs to their corresponding subsystem IDs for background images */
const TAB_SUBSYSTEM_MAP: Record<string, SubsystemId> = {
  providers: 'forge',
  chat: 'salon',
  appearance: 'calliope',
  memory: 'commonplace-book',
  images: 'lantern',
  templates: 'aurora',
  system: 'prospero',
}

/** Tab icon: wrench (AI Providers) */
function ProvidersIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}

/** Tab icon: palette (Appearance) */
function AppearanceIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z" />
    </svg>
  )
}

/** Tab icon: book (Memory & Search) */
function MemoryIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

/** Tab icon: sun (Images) */
function ImagesIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}

/** Tab icon: person (Templates & Prompts) */
function TemplatesIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

/** Tab icon: clipboard (Data & System) */
function SystemIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  )
}

const SETTINGS_TABS: Tab[] = [
  { id: 'providers', label: 'AI Providers', icon: <ProvidersIcon /> },
  { id: 'chat', label: 'Chat', icon: <ChatIcon className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <AppearanceIcon /> },
  { id: 'memory', label: 'Commonplace Book', icon: <MemoryIcon /> },
  { id: 'images', label: 'Images', icon: <ImagesIcon /> },
  { id: 'templates', label: 'Templates & Prompts', icon: <TemplatesIcon /> },
  { id: 'system', label: 'Data & System', icon: <SystemIcon /> },
]

function SettingsTabContent({ activeTab }: { activeTab: string }) {
  switch (activeTab) {
    case 'providers':
      return <ProvidersTabContent />
    case 'chat':
      return <ChatTabContent />
    case 'appearance':
      return <AppearanceTabContent />
    case 'memory':
      return <MemorySearchTabContent />
    case 'images':
      return <ImagesTabContent />
    case 'templates':
      return <TemplatesPromptsTabContent />
    case 'system':
      return <DataSystemTabContent />
    default:
      return <ProvidersTabContent />
  }
}

/** Resolves the background image for the active settings tab */
function useSettingsBackground() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'providers'
  const subsystemId = TAB_SUBSYSTEM_MAP[activeTab] || 'forge'
  const info = useSubsystemInfo(subsystemId)
  return info.backgroundImage
}

export default function SettingsPage() {
  const backgroundImage = useSettingsBackground()
  const containerStyle = backgroundImage
    ? { '--story-background-url': `url(${backgroundImage})` } as React.CSSProperties
    : undefined

  return (
    <div className="qt-page-container" style={containerStyle}>
      <div className="qt-settings-header mb-8">
        <h1 className="qt-heading-1">Settings</h1>
        <p className="qt-text-muted mt-2">
          Configure and manage every aspect of your <BrandName /> workspace
        </p>
      </div>

      <ChatSettingsProvider>
        <Suspense fallback={<div className="qt-text-secondary">Loading...</div>}>
          <EntityTabs tabs={SETTINGS_TABS} defaultTab="providers" contentClassName="qt-settings-panel">
            {(activeTab) => <SettingsTabContent activeTab={activeTab} />}
          </EntityTabs>
        </Suspense>
      </ChatSettingsProvider>
    </div>
  )
}
