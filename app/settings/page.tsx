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
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'
import { Icon } from '@/components/ui/icon'
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

const SETTINGS_TABS: Tab[] = [
  { id: 'providers', label: 'AI Providers', icon: <Icon name="wrench" className="w-4 h-4" /> },
  { id: 'chat', label: 'Chat', icon: <Icon name="chat" className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Icon name="themes" className="w-4 h-4" /> },
  { id: 'memory', label: 'Commonplace Book', icon: <Icon name="book" className="w-4 h-4" /> },
  { id: 'images', label: 'Images', icon: <Icon name="image" className="w-4 h-4" /> },
  { id: 'templates', label: 'Templates & Prompts', icon: <Icon name="user" className="w-4 h-4" /> },
  { id: 'system', label: 'Data & System', icon: <Icon name="database" className="w-4 h-4" /> },
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

/** Resolves the --story-background-url style for the active settings tab */
function useSettingsBackgroundStyle() {
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('tab') || 'providers'
  const subsystemId = TAB_SUBSYSTEM_MAP[activeTab] || 'forge'
  return useSubsystemBackgroundStyle(subsystemId)
}

export default function SettingsPage() {
  const containerStyle = useSettingsBackgroundStyle()

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
