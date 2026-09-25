'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { DEFAULT_CONCIERGE_SETTINGS, type ConciergeSettings } from '@/components/settings/chat-settings/types'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { OnDutyCard } from '@/components/settings/concierge-settings/OnDutyCard'
import { UncensoredDeskCard } from '@/components/settings/concierge-settings/UncensoredDeskCard'
import { RefusalsCard } from '@/components/settings/concierge-settings/RefusalsCard'
import { DisplayCard } from '@/components/settings/concierge-settings/DisplayCard'
import { PreScreeningCard } from '@/components/settings/concierge-settings/PreScreeningCard'
import { useSettingsSection } from './useSettingsSection'

/**
 * The Concierge's own tab (`/settings?tab=concierge`): the on-duty switch,
 * the uncensored desk, the refusal rule, display, and the optional
 * pre-screen. Every control saves through `handleConciergeUpdate`.
 */
export function ConciergeTabContent() {
  const info = useSubsystemInfo('concierge')
  const activeSection = useSettingsSection()
  const {
    settings,
    loading,
    saving,
    connectionProfiles,
    imageProfiles,
    loadingProfiles,
    handleConciergeUpdate,
  } = useChatSettingsContext()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="qt-text-secondary">Loading settings...</div>
      </div>
    )
  }

  if (!settings) {
    return <div className="qt-alert-error">Failed to load the Concierge&apos;s settings</div>
  }

  const stored = settings.conciergeSettings
  const concierge: ConciergeSettings = {
    ...DEFAULT_CONCIERGE_SETTINGS,
    ...stored,
    display: { ...DEFAULT_CONCIERGE_SETTINGS.display, ...stored?.display },
    preScreen: { ...DEFAULT_CONCIERGE_SETTINGS.preScreen, ...stored?.preScreen },
  }

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      {!concierge.enabled && (
        <div className="qt-alert-warning mb-4">
          <p className="qt-text-small">
            The Concierge is off duty. Nothing is rerouted, announced, switched or screened until he is back at his post.
          </p>
        </div>
      )}

      <div className="space-y-4">
        <CollapsibleCard
          title="On Duty"
          description="Whether the Concierge is at his post at all, or has gone off to see a man about a dog."
          sectionId="on-duty"
          defaultOpen
          forceOpen={activeSection === 'on-duty'}
        >
          <OnDutyCard settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
        </CollapsibleCard>

        <CollapsibleCard
          title="The Uncensored Desk"
          description="The less squeamish parties the Concierge sends for when the usual providers clutch their pearls."
          sectionId="uncensored-desk"
          defaultOpen
          forceOpen={activeSection === 'uncensored-desk'}
        >
          <UncensoredDeskCard
            settings={concierge}
            saving={saving}
            connectionProfiles={connectionProfiles}
            imageProfiles={imageProfiles}
            loadingProfiles={loadingProfiles}
            onUpdate={handleConciergeUpdate}
          />
        </CollapsibleCard>

        <CollapsibleCard
          title="When a Provider Refuses"
          description="How many polite refusals the Concierge endures before he moves a chat along, and how new chats begin."
          sectionId="refusals"
          defaultOpen
          forceOpen={activeSection === 'refusals'}
        >
          <RefusalsCard settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
        </CollapsibleCard>

        <CollapsibleCard
          title="Display"
          description="Whether flagged content is laid out on the table, draped in gauze, or tucked discreetly behind a curtain."
          sectionId="display"
          defaultOpen
          forceOpen={activeSection === 'display'}
        >
          <DisplayCard settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
        </CollapsibleCard>

        <CollapsibleCard
          title="Pre-Screening (Advanced)"
          description="An optional doorman who reads every message before it goes in, at the price of a call apiece."
          sectionId="pre-screening"
          forceOpen={activeSection === 'pre-screening'}
        >
          <PreScreeningCard settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
        </CollapsibleCard>
      </div>
    </div>
  )
}
