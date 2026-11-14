'use client'

/**
 * Card bodies for the Connections group (the Providers card lives in
 * `providers-card.tsx`; the four kind cards it hosts are re-exported here).
 *
 * @module components/settings/cards/connections-cards
 */

import Link from 'next/link'
import { CheapLLMSettings } from '@/components/settings/chat-settings/CheapLLMSettings'
import { Icon } from '@/components/ui/icon'
import { WithChatSettings } from './with-chat-settings'

export { default as ApiKeysCard } from '@/components/settings/api-keys-tab'
export { default as ConnectionProfilesCard } from '@/components/settings/connection-profiles-tab'
export { default as ImageProfilesCard } from '@/components/settings/image-profiles-tab'
export { default as EmbeddingProfilesCard } from '@/components/settings/embedding-profiles-tab'

export function SetupWizardCard() {
  return (
    <Link href="/settings/wizard" className="qt-card block p-4 hover:qt-bg-surface-alt transition-colors">
      <div className="flex items-center justify-between gap-4">
        <p className="qt-text-small">
          Walk through providers, keys, models and profiles in one guided pass.
        </p>
        <Icon name="chevron-right" className="w-5 h-5 qt-text-muted flex-shrink-0" />
      </div>
    </Link>
  )
}

export function CheapLLMCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, loadingProfiles, connectionProfiles, handleCheapLLMUpdate }) => (
        <CheapLLMSettings
          settings={settings}
          saving={saving}
          loadingProfiles={loadingProfiles}
          connectionProfiles={connectionProfiles}
          onUpdate={handleCheapLLMUpdate}
        />
      )}
    </WithChatSettings>
  )
}
