'use client'

/**
 * Card bodies for the Composer & Display group.
 *
 * @module components/settings/cards/composer-display-cards
 */

import { CompositionModeDefaultSettings } from '@/components/settings/chat-settings/CompositionModeDefaultSettings'
import { ComposerSpellcheckSettings } from '@/components/settings/chat-settings/ComposerSpellcheckSettings'
import { ComposerEmojiSettings } from '@/components/settings/chat-settings/ComposerEmojiSettings'
import { ComposerUnicodeSettings } from '@/components/settings/chat-settings/ComposerUnicodeSettings'
import { ComposerSlashCommandsSettings } from '@/components/settings/chat-settings/ComposerSlashCommandsSettings'
import { ImpersonationVoiceSettings } from '@/components/settings/chat-settings/ImpersonationVoiceSettings'
import { AutoScrollSettings } from '@/components/settings/chat-settings/AutoScrollSettings'
import { TextReplacementSettings } from '@/components/settings/chat-settings/TextReplacementSettings'
import { TokenDisplaySettingsComponent } from '@/components/settings/chat-settings/TokenDisplaySettings'
import { ThinkingDisplaySettings } from '@/components/settings/chat-settings/ThinkingDisplaySettings'
import { SmartTypographySettings } from '@/components/settings/chat-settings/SmartTypographySettings'
import { WithChatSettings } from './with-chat-settings'

export function CompositionModeCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleCompositionModeDefaultChange }) => (
        <CompositionModeDefaultSettings settings={settings} saving={saving} onChange={handleCompositionModeDefaultChange} />
      )}
    </WithChatSettings>
  )
}

export function ComposerCard() {
  return (
    <WithChatSettings>
      {({
        settings,
        saving,
        handleComposerSpellcheckChange,
        handleComposerEmojiChange,
        handleComposerUnicodeChange,
        handleImpersonationVoiceModeChange,
      }) => (
        <>
          <ComposerSpellcheckSettings settings={settings} saving={saving} onChange={handleComposerSpellcheckChange} />
          <ComposerEmojiSettings settings={settings} saving={saving} onChange={handleComposerEmojiChange} />
          <ComposerUnicodeSettings settings={settings} saving={saving} onChange={handleComposerUnicodeChange} />
          <ImpersonationVoiceSettings settings={settings} saving={saving} onChange={handleImpersonationVoiceModeChange} />
        </>
      )}
    </WithChatSettings>
  )
}

export function SlashCommandsCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleComposerSlashCommandsChange }) => (
        <ComposerSlashCommandsSettings settings={settings} saving={saving} onChange={handleComposerSlashCommandsChange} />
      )}
    </WithChatSettings>
  )
}

export function AutoScrollCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleAutoScrollOnResponseCompleteChange }) => (
        <AutoScrollSettings settings={settings} saving={saving} onChange={handleAutoScrollOnResponseCompleteChange} />
      )}
    </WithChatSettings>
  )
}

export function TextReplacementCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleTextReplacementsEnabledChange }) => (
        <TextReplacementSettings settings={settings} saving={saving} onMasterToggleChange={handleTextReplacementsEnabledChange} />
      )}
    </WithChatSettings>
  )
}

export function SmartTypographyCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleSmartTypographyUpdate }) => (
        <SmartTypographySettings settings={settings} saving={saving} onUpdate={handleSmartTypographyUpdate} />
      )}
    </WithChatSettings>
  )
}

export function TokenDisplayCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleTokenDisplayChange }) => (
        <TokenDisplaySettingsComponent settings={settings} saving={saving} onTokenDisplayChange={handleTokenDisplayChange} />
      )}
    </WithChatSettings>
  )
}

export function ThinkingDisplayCard() {
  return (
    <WithChatSettings>
      {({ settings, saving, handleThinkingDisplayUpdate }) => (
        <ThinkingDisplaySettings settings={settings} saving={saving} onUpdate={handleThinkingDisplayUpdate} />
      )}
    </WithChatSettings>
  )
}
