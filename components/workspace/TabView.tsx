'use client'

/**
 * TabView — renders the surface for a workspace tab by its `kind`.
 *
 * Lazy-mount, then keep alive: a tab's view does not mount until the tab is
 * first activated; once mounted it is never unmounted by a tab switch (the host
 * hides inactive tabs with CSS). This is what lets a streaming Salon survive
 * tab switches without touching its SSE hooks. See
 * `docs/developer/features/tabbed-workspace.md`.
 *
 * @module components/workspace/TabView
 */

import { useState } from 'react'
import type {
  WorkspaceTab,
  SalonTabPayload,
  SettingsTabPayload,
} from '@/lib/workspace/types'
import { HomeViewContainer } from '@/components/homepage/HomeViewContainer'
import { SalonView } from '@/app/salon/[id]/SalonView'
import { AuroraView } from '@/app/aurora/AuroraView'
import { ProsperoView } from '@/app/prospero/ProsperoView'
import { ScriptoriumView } from '@/app/scriptorium/ScriptoriumView'
import { SettingsView } from '@/app/settings/SettingsView'
import { FilesView } from '@/app/files/FilesView'
import { PhotosView } from '@/app/photos/PhotosView'
import { ScenariosView } from '@/app/scenarios/ScenariosView'
import { TerminalView, DocumentView } from '@/components/workspace/TerminalDocumentViews'
import { WorkspaceTabProvider } from '@/components/workspace/workspace-tab-context'
import { BrahmaConsoleView } from '@/components/brahma-console/BrahmaConsoleView'
import { WardrobeView } from '@/components/wardrobe/wardrobe-control-dialog'
import { ProfileView } from '@/app/profile/ProfileView'
import { AboutView } from '@/app/about/AboutView'
import { GenerateImageView } from '@/app/generate-image/GenerateImageView'
import { NewCharacterView } from '@/app/aurora/new/NewCharacterView'
import { CharacterEditView } from '@/app/aurora/[id]/edit/CharacterEditView'
import { SettingsWizardView } from '@/app/settings/wizard/SettingsWizardView'
import type {
  TerminalTabPayload,
  DocumentTabPayload,
  WardrobeTabPayload,
  CharacterEditTabPayload,
} from '@/lib/workspace/types'

function renderView(tab: WorkspaceTab) {
  switch (tab.kind) {
    case 'home':
      return <HomeViewContainer />
    case 'salon':
      return <SalonView chatId={(tab.payload as SalonTabPayload).chatId} />
    case 'aurora':
      return <AuroraView />
    case 'prospero':
      return <ProsperoView />
    case 'scriptorium':
      return <ScriptoriumView />
    case 'settings': {
      const payload = (tab.payload as SettingsTabPayload | undefined) ?? {}
      return <SettingsView tab={payload.tab} section={payload.section} />
    }
    case 'files':
      return <FilesView />
    case 'photos':
      return <PhotosView />
    case 'scenarios':
      return <ScenariosView />
    case 'terminal':
      return <TerminalView chatId={(tab.payload as TerminalTabPayload).chatId} />
    case 'document':
      return <DocumentView chatId={(tab.payload as DocumentTabPayload).chatId} />
    case 'brahma':
      return <BrahmaConsoleView />
    case 'wardrobe':
      return <WardrobeView characterId={(tab.payload as WardrobeTabPayload | undefined)?.characterId} />
    case 'profile':
      return <ProfileView />
    case 'about':
      return <AboutView />
    case 'generate-image':
      return <GenerateImageView />
    case 'character-new':
      return <NewCharacterView />
    case 'character-edit': {
      const payload = tab.payload as CharacterEditTabPayload
      return <CharacterEditView characterId={payload.characterId} initialTab={payload.tab} />
    }
    case 'settings-wizard':
      return <SettingsWizardView />
    default:
      return null
  }
}

export function TabView({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  // Latch: mount on first activation, never unmount thereafter. Adjusting state
  // during render is React's sanctioned pattern for deriving from a prop
  // without an effect (re-renders immediately, nothing is committed in between).
  const [everActive, setEverActive] = useState(active)
  if (active && !everActive) {
    setEverActive(true)
  }

  if (!everActive) return null
  return <WorkspaceTabProvider tabId={tab.id}>{renderView(tab)}</WorkspaceTabProvider>
}
