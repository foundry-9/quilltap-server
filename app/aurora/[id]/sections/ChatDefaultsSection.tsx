'use client'

/**
 * Chat Defaults — *How does a new chat with them begin?* Exactly what the New
 * Chat dialog pre-fills from the character: connection profile, partner, image
 * profile, timestamps, agent mode and help tools. Each saves on change. The
 * default system prompt and scenario are the stars on their own lists
 * (Prompts), not pickers here.
 *
 * @module app/aurora/[id]/sections/ChatDefaultsSection
 */

import { useId } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { TimestampConfigCard } from '@/components/settings/chat-settings/components/TimestampConfigCard'
import { USER_CONTROLLED_PROFILE_ID } from '@/lib/constants/character'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { queryKeys } from '@/lib/query/keys'
import { SectionCard } from '../components/SectionCard'
import { TriStateSelect } from '../components/TriStateSelect'
import { useCharacterPage } from '../CharacterPageContext'

export function ChatDefaultsSection() {
  const {
    characterId,
    character,
    autosave,
    readOnly,
    profiles,
    userControlledCharacters,
    defaultPartnerId,
  } = useCharacterPage()
  const queryClient = useQueryClient()
  const fieldId = useId()
  const { data: agentModeDefault } = useChatSettingsQuery((s) => s.agentModeSettings?.defaultEnabled ?? false)
  const isUserControlled = character.controlledBy === 'user'
  const partners = userControlledCharacters.filter((c) => c.id !== characterId)

  const setConnectionProfile = (profileId: string) => {
    // "User acts as character" is a sentinel, not a profile: it flips control.
    const patch =
      profileId === USER_CONTROLLED_PROFILE_ID
        ? { controlledBy: 'user' as const, defaultConnectionProfileId: undefined }
        : { controlledBy: 'llm' as const, defaultConnectionProfileId: profileId || undefined }
    void autosave.saveNow(patch, 'The connection profile could not be saved.')
  }

  const setPartner = async (partnerId: string) => {
    autosave.patchCache({ defaultPartnerId: partnerId || null })
    const ok = await autosave.run(async () => {
      const res = await fetch(`/api/v1/characters/${characterId}?action=set-default-partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: partnerId || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error || 'The default partner could not be saved.')
      }
      return true
    }, 'The default partner could not be saved.')
    if (!ok) void queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) })
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Connection profile"
        description="The AI provider and model a new chat with them starts on. A chat may choose another."
      >
        <select
          aria-label="Default connection profile"
          value={isUserControlled ? USER_CONTROLLED_PROFILE_ID : character.defaultConnectionProfileId || ''}
          disabled={readOnly}
          onChange={(e) => setConnectionProfile(e.target.value)}
          className="qt-select max-w-md"
        >
          <option value="">No default profile</option>
          <option value={USER_CONTROLLED_PROFILE_ID}>User Acts As Character</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        {profiles.length === 0 && (
          <p className="text-sm qt-text-warning">
            No connection profiles yet.{' '}
            <Link href="/settings?tab=providers" className="underline hover:no-underline">
              Create one in AI Providers
            </Link>
            .
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Conversation partner"
        description={
          isUserControlled
            ? 'Not applicable: you play this character, so there is no partner to stand in for you.'
            : 'The user-controlled character who represents you in a new chat with them.'
        }
      >
        <label htmlFor={`${fieldId}-partner`} className="sr-only">
          Default conversation partner
        </label>
        <select
          id={`${fieldId}-partner`}
          value={defaultPartnerId ?? ''}
          disabled={readOnly || isUserControlled}
          onChange={(e) => void setPartner(e.target.value)}
          className="qt-select max-w-md"
        >
          <option value="">No default partner</option>
          {partners.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.title ? ` - ${c.title}` : ''}
            </option>
          ))}
        </select>
        {!isUserControlled && partners.length === 0 && (
          <p className="text-sm qt-text-warning">
            No user-controlled characters yet.{' '}
            <Link href="/aurora/new" className="underline hover:no-underline">
              Create one
            </Link>{' '}
            or tick <em>You play this character</em> on another character&rsquo;s Abilities.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Image generation profile" description="The image profile chats with them use. Optional.">
        <ImageProfilePicker
          value={character.defaultImageProfileId || null}
          onChange={(profileId) =>
            void autosave.saveNow(
              { defaultImageProfileId: profileId || null },
              'The image profile could not be saved.',
            )
          }
          characterId={characterId}
          disabled={readOnly}
        />
      </SectionCard>

      <SectionCard
        title="Timestamps"
        description="Timestamp injection for a new chat in which they are the only character."
      >
        <TimestampConfigCard
          config={character.defaultTimestampConfig}
          onChange={(config) =>
            // NONE is stored as null: "use the global default".
            void autosave.saveNow(
              { defaultTimestampConfig: config.mode === 'NONE' ? null : config },
              'The timestamp settings could not be saved.',
            )
          }
          compact
          disabled={readOnly}
        />
      </SectionCard>

      <SectionCard title="Tools in a new chat">
        <TriStateSelect
          label="Agent mode"
          description="Lets the model use tools in several passes, checking and correcting itself, before it answers."
          value={character.defaultAgentModeEnabled}
          inherited={agentModeDefault ?? null}
          inheritedFrom="the Chat settings"
          disabled={readOnly}
          onChange={(defaultAgentModeEnabled) =>
            void autosave.saveNow({ defaultAgentModeEnabled }, 'The agent mode default could not be saved.')
          }
        />
        <TriStateSelect
          label="Help tools"
          description="Lets them search Quilltap's own documentation and read instance settings, to help you configure things."
          value={character.defaultHelpToolsEnabled}
          inherited={false}
          inheritedFrom="the house default"
          disabled={readOnly}
          onChange={(defaultHelpToolsEnabled) =>
            void autosave.saveNow({ defaultHelpToolsEnabled }, 'The help tools default could not be saved.')
          }
        />
      </SectionCard>
    </div>
  )
}
