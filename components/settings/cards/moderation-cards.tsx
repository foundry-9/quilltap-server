'use client'

/**
 * Card bodies for the Moderation group — the Concierge's five cards. Every
 * control saves through `handleConciergeUpdate`; the settings are read with
 * their defaults merged in by `mergeConciergeSettings`.
 *
 * @module components/settings/cards/moderation-cards
 */

import type { ReactNode } from 'react'
import type { ConciergeSettings } from '@/components/settings/chat-settings/types'
import { mergeConciergeSettings } from '@/components/settings/concierge-settings/merge'
import { OnDutyCard as OnDutyBody } from '@/components/settings/concierge-settings/OnDutyCard'
import { UncensoredDeskCard as UncensoredDeskBody } from '@/components/settings/concierge-settings/UncensoredDeskCard'
import { RefusalsCard as RefusalsBody } from '@/components/settings/concierge-settings/RefusalsCard'
import { DisplayCard as DisplayBody } from '@/components/settings/concierge-settings/DisplayCard'
import { PreScreeningCard as PreScreeningBody } from '@/components/settings/concierge-settings/PreScreeningCard'
import { WithChatSettings, type LoadedChatSettings } from './with-chat-settings'

function WithConcierge({ children }: { children: (concierge: ConciergeSettings, ctx: LoadedChatSettings) => ReactNode }) {
  return (
    <WithChatSettings failure="Failed to load the Concierge's settings">
      {(ctx) => children(mergeConciergeSettings(ctx.settings.conciergeSettings), ctx)}
    </WithChatSettings>
  )
}

export function OnDutyCard() {
  return (
    <WithConcierge>
      {(concierge, { saving, handleConciergeUpdate }) => (
        <OnDutyBody settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
      )}
    </WithConcierge>
  )
}

export function UncensoredDeskCard() {
  return (
    <WithConcierge>
      {(concierge, { saving, connectionProfiles, imageProfiles, loadingProfiles, handleConciergeUpdate }) => (
        <UncensoredDeskBody
          settings={concierge}
          saving={saving}
          connectionProfiles={connectionProfiles}
          imageProfiles={imageProfiles}
          loadingProfiles={loadingProfiles}
          onUpdate={handleConciergeUpdate}
        />
      )}
    </WithConcierge>
  )
}

export function RefusalsCard() {
  return (
    <WithConcierge>
      {(concierge, { saving, handleConciergeUpdate }) => (
        <RefusalsBody settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
      )}
    </WithConcierge>
  )
}

export function DisplayCard() {
  return (
    <WithConcierge>
      {(concierge, { saving, handleConciergeUpdate }) => (
        <DisplayBody settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
      )}
    </WithConcierge>
  )
}

export function PreScreeningCard() {
  return (
    <WithConcierge>
      {(concierge, { saving, handleConciergeUpdate }) => (
        <PreScreeningBody settings={concierge} saving={saving} onUpdate={handleConciergeUpdate} />
      )}
    </WithConcierge>
  )
}
