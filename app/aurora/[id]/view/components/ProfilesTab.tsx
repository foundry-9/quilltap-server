'use client'

import Link from 'next/link'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { Character, ConnectionProfile, UserControlledCharacter } from '../types'
import { USER_CONTROLLED_PROFILE_ID } from '@/lib/constants/character'
import type { TimestampConfig } from '@/lib/schemas/types'

interface ProfilesTabProps {
  characterId: string
  character: Character | null
  profiles: ConnectionProfile[]
  userControlledCharacters: UserControlledCharacter[]
  defaultPartnerId: string
  defaultImageProfileId: string
  savingConnectionProfile: boolean
  savingPartner: boolean
  savingImageProfile?: boolean
  savingAgentMode?: boolean
  savingHelpTools?: boolean
  savingCanDressThemselves?: boolean
  savingCanCreateOutfits?: boolean
  savingTimestampConfig?: boolean
  savingDefaultScenario?: boolean
  savingDefaultSystemPrompt?: boolean
  onConnectionProfileChange: (profileId: string) => void
  onPartnerChange: (partnerId: string) => void
  onImageProfileChange: (profileId: string | null) => void
  onAgentModeChange: (enabled: boolean | null) => void
  onHelpToolsChange: (enabled: boolean | null) => void
  onCanDressThemselvesChange: (enabled: boolean | null) => void
  onCanCreateOutfitsChange: (enabled: boolean | null) => void
  onTimestampConfigChange: (config: TimestampConfig | null) => void
  onDefaultScenarioChange: (scenarioId: string | null) => void
  onDefaultSystemPromptChange: (promptId: string | null) => void
}

export function ProfilesTab({
  characterId,
  character,
  profiles,
  userControlledCharacters,
  defaultPartnerId,
  defaultImageProfileId,
  savingConnectionProfile,
  savingPartner,
  savingImageProfile,
  savingAgentMode,
  savingHelpTools,
  savingCanDressThemselves,
  savingCanCreateOutfits,
  savingTimestampConfig,
  savingDefaultScenario,
  savingDefaultSystemPrompt,
  onConnectionProfileChange,
  onPartnerChange,
  onImageProfileChange,
  onAgentModeChange,
  onHelpToolsChange,
  onCanDressThemselvesChange,
  onCanCreateOutfitsChange,
  onTimestampConfigChange,
  onDefaultScenarioChange,
  onDefaultSystemPromptChange,
}: ProfilesTabProps) {
  // Check if this character is user-controlled (disable partner selection if so)
  const isUserControlled = character?.controlledBy === 'user'

  if (!character) return null

  return (
    <div className="space-y-8">
      {/* Connection Profile Section */}
      <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
        <h2 className="qt-heading-4 text-foreground mb-2">
          Default Connection Profile
        </h2>
        <p className="qt-text-small mb-4">
          The default AI provider and model to use when chatting with this character. Can be overridden per chat.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={
              character?.controlledBy === 'user'
                ? USER_CONTROLLED_PROFILE_ID
                : character?.defaultConnectionProfileId || ''
            }
            onChange={(e) => onConnectionProfileChange(e.target.value)}
            disabled={savingConnectionProfile}
            className="flex-1 rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">No default profile</option>
            <option value={USER_CONTROLLED_PROFILE_ID}>User Acts As Character</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          {savingConnectionProfile && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
              Saving...
            </div>
          )}
        </div>
        {profiles.length === 0 && (
          <p className="mt-2 text-sm qt-text-warning">
            No connection profiles available. <Link href="/settings?tab=providers" className="underline hover:no-underline">Create one in AI Providers</Link>.
          </p>
        )}
      </div>

      {/* Default Partner Section */}
      <div className={`character-section-card rounded-lg border qt-border-default qt-bg-card p-6 ${isUserControlled ? 'opacity-50' : ''}`}>
        <h2 className="qt-heading-4 text-foreground mb-2">
          Default Conversation Partner
        </h2>
        <p className="qt-text-small mb-4">
          {isUserControlled
            ? 'Not applicable when this character is user-controlled.'
            : 'The default user-controlled character to represent you when chatting with this character.'}
        </p>
        <div className="flex items-center gap-3">
          <select
            value={defaultPartnerId}
            onChange={(e) => onPartnerChange(e.target.value)}
            disabled={savingPartner || isUserControlled}
            className="flex-1 rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="">No default partner</option>
            {userControlledCharacters
              .filter(c => c.id !== characterId) // Exclude current character
              .map((char) => (
                <option key={char.id} value={char.id}>
                  {char.name}{char.title ? ` - ${char.title}` : ''}
                </option>
              ))}
          </select>
          {savingPartner && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
              Saving...
            </div>
          )}
        </div>
        {!isUserControlled && userControlledCharacters.filter(c => c.id !== characterId).length === 0 && (
          <p className="mt-2 text-sm qt-text-warning">
            No user-controlled characters available. <Link href="/aurora/new" className="underline hover:no-underline">Create one</Link> or set an existing character to &quot;User Acts As Character&quot;.
          </p>
        )}
      </div>

      {/* Image Profile Section */}
      <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
        <h2 className="qt-heading-4 text-foreground mb-2">
          Image Generation Profile
        </h2>
        <p className="qt-text-small mb-4">
          The default image generation profile for creating images during chats. Optional.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ImageProfilePicker
              value={defaultImageProfileId || null}
              onChange={(profileId) => onImageProfileChange(profileId || null)}
              characterId={characterId}
              disabled={savingImageProfile}
            />
          </div>
          {savingImageProfile && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
              Saving...
            </div>
          )}
        </div>
      </div>

      {/* Default System Prompt Section - only show if more than one prompt */}
      {character.systemPrompts && character.systemPrompts.length > 1 && (
        <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
          <h2 className="qt-heading-4 text-foreground mb-2">
            Default System Prompt
          </h2>
          <p className="qt-text-small mb-4">
            The system prompt to use by default when starting new chats with this character. Can be overridden per chat.
          </p>
          <div className="flex items-center gap-3">
            <select
              value={character.defaultSystemPromptId || ''}
              onChange={(e) => onDefaultSystemPromptChange(e.target.value || null)}
              disabled={savingDefaultSystemPrompt}
              className="flex-1 rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">Use first prompt marked as default</option>
              {character.systemPrompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}{prompt.isDefault ? ' (current default)' : ''}
                </option>
              ))}
            </select>
            {savingDefaultSystemPrompt && (
              <div className="flex items-center gap-2 qt-text-small">
                <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
                Saving...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Default Scenario Section - only show if more than one scenario */}
      {character.scenarios && character.scenarios.length > 1 && (
        <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
          <h2 className="qt-heading-4 text-foreground mb-2">
            Default Scenario
          </h2>
          <p className="qt-text-small mb-4">
            The scenario to pre-select by default when starting new chats with this character. Can be overridden per chat.
          </p>
          <div className="flex items-center gap-3">
            <select
              value={character.defaultScenarioId || ''}
              onChange={(e) => onDefaultScenarioChange(e.target.value || null)}
              disabled={savingDefaultScenario}
              className="flex-1 rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="">No default scenario</option>
              {character.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </select>
            {savingDefaultScenario && (
              <div className="flex items-center gap-2 qt-text-small">
                <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
                Saving...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Mode Section */}
      <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
        <h2 className="qt-heading-4 text-foreground mb-2">
          Agent Mode
        </h2>
        <p className="qt-text-small mb-4">
          Control whether agent mode is enabled by default for chats with this character.
          Agent mode allows the AI to iteratively use tools, verify results, and self-correct before delivering a final response.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={character?.defaultAgentModeEnabled === null || character?.defaultAgentModeEnabled === undefined ? 'inherit' : character.defaultAgentModeEnabled ? 'enabled' : 'disabled'}
            onChange={(e) => {
              const value = e.target.value
              onAgentModeChange(value === 'inherit' ? null : value === 'enabled')
            }}
            disabled={savingAgentMode}
            className="flex-1 max-w-xs rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="inherit">Inherit from global settings</option>
            <option value="enabled">Enabled by default</option>
            <option value="disabled">Disabled by default</option>
          </select>
          {savingAgentMode && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
              Saving...
            </div>
          )}
        </div>
      </div>

      {/* Help Tools Section */}
      <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
        <h2 className="qt-heading-4 text-foreground mb-2">
          Help Tools
        </h2>
        <p className="qt-text-small mb-4">
          Control whether help tools are available for this character.
          When enabled, the character can search Quilltap documentation and read instance settings to assist users with configuration.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={character?.defaultHelpToolsEnabled === null || character?.defaultHelpToolsEnabled === undefined ? 'inherit' : character.defaultHelpToolsEnabled ? 'enabled' : 'disabled'}
            onChange={(e) => {
              const value = e.target.value
              onHelpToolsChange(value === 'inherit' ? null : value === 'enabled')
            }}
            disabled={savingHelpTools}
            className="flex-1 max-w-xs rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="inherit">Inherit from global settings (disabled)</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          {savingHelpTools && (
            <div className="flex items-center gap-2 qt-text-small">
              <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
              Saving...
            </div>
          )}
        </div>
      </div>

      {/* Wardrobe Section */}
      <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
        <h2 className="qt-heading-4 text-foreground mb-2">
          Wardrobe
        </h2>

        {/* Self-Dressing */}
        <div className="mb-6">
          <h3 className="qt-text-label mb-1">Self-Dressing</h3>
          <p className="qt-text-small mb-3">
            Control whether this character can change their own outfit during conversations using wardrobe tools.
          </p>
          <div className="flex items-center gap-3">
            <select
              value={character?.canDressThemselves === null || character?.canDressThemselves === undefined ? 'inherit' : character.canDressThemselves ? 'enabled' : 'disabled'}
              onChange={(e) => {
                const value = e.target.value
                onCanDressThemselvesChange(value === 'inherit' ? null : value === 'enabled')
              }}
              disabled={savingCanDressThemselves}
              className="flex-1 max-w-xs rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="inherit">Inherit from global settings (enabled)</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            {savingCanDressThemselves && (
              <div className="flex items-center gap-2 qt-text-small">
                <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
                Saving...
              </div>
            )}
          </div>
        </div>

        {/* Outfit Creation */}
        <div>
          <h3 className="qt-text-label mb-1">Outfit Creation</h3>
          <p className="qt-text-small mb-3">
            Control whether this character can create new wardrobe items mid-conversation. Requires tool use.
          </p>
          <div className="flex items-center gap-3">
            <select
              value={character?.canCreateOutfits === null || character?.canCreateOutfits === undefined ? 'inherit' : character.canCreateOutfits ? 'enabled' : 'disabled'}
              onChange={(e) => {
                const value = e.target.value
                onCanCreateOutfitsChange(value === 'inherit' ? null : value === 'enabled')
              }}
              disabled={savingCanCreateOutfits}
              className="flex-1 max-w-xs rounded-lg border qt-border-default qt-bg-card px-3 py-2 text-foreground qt-shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              <option value="inherit">Inherit from global settings (enabled)</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            {savingCanCreateOutfits && (
              <div className="flex items-center gap-2 qt-text-small">
                <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
                Saving...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Default Timestamp Settings Section */}
      <div className="character-section-card rounded-lg border qt-border-default qt-bg-card p-6">
        <h2 className="qt-heading-4 text-foreground mb-2">
          Default Timestamp Settings
        </h2>
        <p className="qt-text-small mb-4">
          Default timestamp injection settings for new chats with this character.
          When this character is the only participant in a new chat, these settings will be pre-filled in the chat creation dialog.
        </p>
        <TimestampConfigCard
          config={character?.defaultTimestampConfig}
          onChange={(config) => {
            // If mode is NONE, save as null to indicate "use global default"
            onTimestampConfigChange(config.mode === 'NONE' ? null : config)
          }}
          compact={true}
          disabled={savingTimestampConfig}
        />
        {savingTimestampConfig && (
          <div className="mt-2 flex items-center gap-2 qt-text-small">
            <div className="h-4 w-4 animate-spin rounded-full qt-spinner"></div>
            Saving...
          </div>
        )}
      </div>
    </div>
  )
}
