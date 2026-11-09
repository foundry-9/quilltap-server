'use client'

/**
 * Card bodies for the Games & Tools group.
 *
 * @module components/settings/cards/games-tools-cards
 */

import { AutomationSettings } from '@/components/settings/chat-settings/AutomationSettings'
import { CustomToolsSettings } from '@/components/settings/chat-settings/CustomToolsSettings'
import { AgentModeSettings } from '@/components/settings/chat-settings/AgentModeSettings'
import { AnswerConfirmationSettings } from '@/components/settings/chat-settings/AnswerConfirmationSettings'
import { AutonomousRoomSettingsComponent } from '@/components/settings/chat-settings/AutonomousRoomSettings'
import { WithChatSettings } from './with-chat-settings'

export { GeneralStateSettings as GeneralStateCard } from '@/components/settings/chat-settings/GeneralStateSettings'
export { BrahmaConsoleSettings as BrahmaConsoleCard } from '@/components/settings/chat-settings/BrahmaConsoleSettings'
export { AutonomousRoomsCard as AutonomousRoomSchedulesCard } from '@/components/tools/autonomous-rooms-card'

export function AutomationCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleAutoDetectRngChange, handleCustomToolTriggersChange, handleCustomToolInterventionChange }) => (
        <AutomationSettings
          settings={settings}
          saving={saving}
          onAutoDetectRngChange={handleAutoDetectRngChange}
          onCustomToolTriggersChange={handleCustomToolTriggersChange}
          onCustomToolInterventionChange={handleCustomToolInterventionChange}
        />
      )}
    </WithChatSettings>
  )
}

export function CustomToolsCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleCustomToolsChange }) => (
        <CustomToolsSettings settings={settings} saving={saving} onChange={handleCustomToolsChange} />
      )}
    </WithChatSettings>
  )
}

export function AgentModeCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleAgentModeDefaultEnabledChange, handleAgentModeMaxTurnsChange }) => (
        <AgentModeSettings
          settings={settings}
          saving={saving}
          onDefaultEnabledChange={handleAgentModeDefaultEnabledChange}
          onMaxTurnsChange={handleAgentModeMaxTurnsChange}
        />
      )}
    </WithChatSettings>
  )
}

export function AnswerConfirmationCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleAnswerConfirmationUpdate }) => (
        <AnswerConfirmationSettings settings={settings} saving={saving} onUpdate={handleAnswerConfirmationUpdate} />
      )}
    </WithChatSettings>
  )
}

export function AutonomousRoomsCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleAutonomousRoomSettingsUpdate }) => (
        <AutonomousRoomSettingsComponent settings={settings} saving={saving} onUpdate={handleAutonomousRoomSettingsUpdate} />
      )}
    </WithChatSettings>
  )
}
