'use client'

import { useMemo } from 'react'
import type { ParsedSpeaker, SpeakerMapping } from '@/lib/sillytavern/multi-char-parser'

/**
 * Entity option for dropdowns
 */
interface EntityOption {
  id: string
  name: string
  title?: string | null
}

interface ProfileOption {
  id: string
  name: string
}

/**
 * Props for SpeakerMapper
 */
interface SpeakerMapperProps {
  speakers: ParsedSpeaker[]
  mappings: SpeakerMapping[]
  characters: EntityOption[]
  profiles: ProfileOption[]
  defaultProfileId: string
  onMappingChange: (index: number, updates: Partial<SpeakerMapping>) => void
  onDefaultProfileChange: (profileId: string) => void
}

/**
 * Component for mapping speakers to characters
 */
export function SpeakerMapper({
  speakers,
  mappings,
  characters,
  profiles,
  defaultProfileId,
  onMappingChange,
  onDefaultProfileChange,
}: SpeakerMapperProps) {
  // Group speakers by type (user vs AI)
  const { userSpeakers, aiSpeakers } = useMemo(() => {
    const userSpeakers: Array<{ speaker: ParsedSpeaker; mapping: SpeakerMapping; index: number }> = []
    const aiSpeakers: Array<{ speaker: ParsedSpeaker; mapping: SpeakerMapping; index: number }> = []

    speakers.forEach((speaker, index) => {
      const mapping = mappings[index]
      if (speaker.isUser) {
        userSpeakers.push({ speaker, mapping, index })
      } else {
        aiSpeakers.push({ speaker, mapping, index })
      }
    })

    return { userSpeakers, aiSpeakers }
  }, [speakers, mappings])

  /**
   * Render a single speaker mapping row
   */
  const renderSpeakerMapping = (
    speaker: ParsedSpeaker,
    mapping: SpeakerMapping,
    index: number
  ) => {
    const isUser = speaker.isUser

    return (
      <div
        key={speaker.name}
        className="border qt-border-default rounded-lg p-4 qt-bg-muted"
      >
        {/* Speaker info header */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
            isUser
              ? 'qt-bg-success/10 qt-text-success'
              : 'qt-bg-primary/10 text-primary'
          }`}>
            {isUser ? 'User' : 'AI'}
          </span>
          <span className="qt-text-primary">
            &ldquo;{speaker.name}&rdquo;
          </span>
          <span className="qt-text-small">
            ({speaker.messageCount} message{speaker.messageCount !== 1 ? 's' : ''})
          </span>
        </div>

        {/* Mapping options — all speakers map to characters */}
        <div className="space-y-3">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name={`mapping-${index}`}
              checked={mapping.mappingType === 'existing_character'}
              onChange={() => onMappingChange(index, {
                mappingType: 'existing_character',
                entityId: characters[0]?.id,
                entityName: characters[0]?.name,
                controlledBy: isUser ? 'user' : 'llm',
              })}
              className="mt-1"
            />
            <div className="flex-1">
              <span className="text-sm text-foreground">
                Map to existing character
              </span>
              {mapping.mappingType === 'existing_character' && (
                <>
                  <select
                    value={mapping.entityId || ''}
                    onChange={(e) => {
                      const character = characters.find(c => c.id === e.target.value)
                      onMappingChange(index, {
                        entityId: e.target.value,
                        entityName: character?.name,
                      })
                    }}
                    className="mt-1 qt-select"
                  >
                    <option value="">Select a character</option>
                    {characters.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.title ? `${c.name} (${c.title})` : c.name}
                      </option>
                    ))}
                  </select>
                  {!isUser && (
                    <div className="mt-2">
                      <span className="qt-text-xs">
                        Connection Profile (optional override):
                      </span>
                      <select
                        value={mapping.connectionProfileId || ''}
                        onChange={(e) => onMappingChange(index, {
                          connectionProfileId: e.target.value || undefined,
                        })}
                    className="mt-1 qt-select"
                      >
                        <option value="">Use default profile</option>
                        {profiles.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="radio"
              name={`mapping-${index}`}
              checked={mapping.mappingType === 'create_character'}
              onChange={() => onMappingChange(index, {
                mappingType: 'create_character',
                entityId: undefined,
                entityName: speaker.name,
                controlledBy: isUser ? 'user' : 'llm',
              })}
              className="mt-1"
            />
            <div className="flex-1">
              <span className="text-sm text-foreground">
                Create new character named &ldquo;{speaker.name}&rdquo;
              </span>
              {mapping.mappingType === 'create_character' && !isUser && (
                <div className="mt-2">
                  <span className="qt-text-xs">
                    Connection Profile:
                  </span>
                  <select
                    value={mapping.connectionProfileId || ''}
                    onChange={(e) => onMappingChange(index, {
                      connectionProfileId: e.target.value || undefined,
                    })}
                    className="mt-1 qt-select"
                  >
                    <option value="">Use default profile</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="radio"
              name={`mapping-${index}`}
              checked={mapping.mappingType === 'skip'}
              onChange={() => onMappingChange(index, {
                mappingType: 'skip',
                entityId: undefined,
                entityName: undefined,
                connectionProfileId: undefined,
              })}
              className="mt-1"
            />
            <span className="qt-text-small">
              Skip (messages from this speaker will be discarded)
            </span>
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Default connection profile */}
      <div className="bg-accent rounded-lg p-4">
        <label className="block text-sm qt-text-primary mb-2">
          Default Connection Profile
        </label>
        <p className="qt-text-xs mb-2">
          This profile will be used for any characters that don&apos;t have a specific profile assigned.
        </p>
        <select
          value={defaultProfileId}
          onChange={(e) => onDefaultProfileChange(e.target.value)}
          className="qt-select"
        >
          <option value="">Select a profile</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* User speakers */}
      {userSpeakers.length > 0 && (
        <div>
          <h4 className="text-sm qt-text-primary mb-3">
            User Speakers
          </h4>
          <div className="space-y-3">
            {userSpeakers.map(({ speaker, mapping, index }) =>
              renderSpeakerMapping(speaker, mapping, index)
            )}
          </div>
        </div>
      )}

      {/* AI speakers */}
      {aiSpeakers.length > 0 && (
        <div>
          <h4 className="text-sm qt-text-primary mb-3">
            AI Speakers
          </h4>
          <div className="space-y-3">
            {aiSpeakers.map(({ speaker, mapping, index }) =>
              renderSpeakerMapping(speaker, mapping, index)
            )}
          </div>
        </div>
      )}

      {speakers.length === 0 && (
        <div className="text-center py-8 qt-text-secondary">
          No speakers found in the file
        </div>
      )}
    </div>
  )
}
