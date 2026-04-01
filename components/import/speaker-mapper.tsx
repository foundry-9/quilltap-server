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
  personas: EntityOption[]
  profiles: ProfileOption[]
  defaultProfileId: string
  onMappingChange: (index: number, updates: Partial<SpeakerMapping>) => void
  onDefaultProfileChange: (profileId: string) => void
}

/**
 * Component for mapping speakers to characters/personas
 */
export function SpeakerMapper({
  speakers,
  mappings,
  characters,
  personas,
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
        className="border border-border rounded-lg p-4 bg-muted"
      >
        {/* Speaker info header */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
            isUser
              ? 'bg-green-100 text-green-800'
              : 'bg-purple-100 text-purple-800'
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

        {/* Mapping options */}
        <div className="space-y-3">
          {isUser ? (
            // Persona mapping options
            <>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`mapping-${index}`}
                  checked={mapping.mappingType === 'existing_persona'}
                  onChange={() => onMappingChange(index, {
                    mappingType: 'existing_persona',
                    entityId: personas[0]?.id,
                    entityName: personas[0]?.name,
                  })}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="text-sm text-foreground">
                    Map to existing persona
                  </span>
                  {mapping.mappingType === 'existing_persona' && (
                    <select
                      value={mapping.entityId || ''}
                      onChange={(e) => {
                        const persona = personas.find(p => p.id === e.target.value)
                        onMappingChange(index, {
                          entityId: e.target.value,
                          entityName: persona?.name,
                        })
                      }}
                      className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-ring focus:ring-ring text-sm px-2 py-1"
                    >
                      <option value="">Select a persona</option>
                      {personas.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title ? `${p.name} (${p.title})` : p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`mapping-${index}`}
                  checked={mapping.mappingType === 'create_persona'}
                  onChange={() => onMappingChange(index, {
                    mappingType: 'create_persona',
                    entityId: undefined,
                    entityName: speaker.name,
                  })}
                  className="mt-1"
                />
                <span className="text-sm text-foreground">
                  Create new persona named &ldquo;{speaker.name}&rdquo;
                </span>
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
                  })}
                  className="mt-1"
                />
                <span className="qt-text-small">
                  Skip (messages will be imported without persona)
                </span>
              </label>
            </>
          ) : (
            // Character mapping options
            <>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name={`mapping-${index}`}
                  checked={mapping.mappingType === 'existing_character'}
                  onChange={() => onMappingChange(index, {
                    mappingType: 'existing_character',
                    entityId: characters[0]?.id,
                    entityName: characters[0]?.name,
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
                        className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-ring focus:ring-ring text-sm px-2 py-1"
                      >
                        <option value="">Select a character</option>
                        {characters.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.title ? `${c.name} (${c.title})` : c.name}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2">
                        <span className="qt-text-xs">
                          Connection Profile (optional override):
                        </span>
                        <select
                          value={mapping.connectionProfileId || ''}
                          onChange={(e) => onMappingChange(index, {
                            connectionProfileId: e.target.value || undefined,
                          })}
                          className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-ring focus:ring-ring text-sm px-2 py-1"
                        >
                          <option value="">Use default profile</option>
                          {profiles.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
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
                  })}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="text-sm text-foreground">
                    Create new character named &ldquo;{speaker.name}&rdquo;
                  </span>
                  {mapping.mappingType === 'create_character' && (
                    <div className="mt-2">
                      <span className="qt-text-xs">
                        Connection Profile:
                      </span>
                      <select
                        value={mapping.connectionProfileId || ''}
                        onChange={(e) => onMappingChange(index, {
                          connectionProfileId: e.target.value || undefined,
                        })}
                        className="mt-1 block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-ring focus:ring-ring text-sm px-2 py-1"
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
            </>
          )}
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
          className="block w-full rounded-md border border-input bg-background text-foreground shadow-sm focus:border-ring focus:ring-ring text-sm px-3 py-2"
        >
          <option value="">Select a profile</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* User/Persona speakers */}
      {userSpeakers.length > 0 && (
        <div>
          <h4 className="text-sm qt-text-primary mb-3">
            User Speakers (map to Personas)
          </h4>
          <div className="space-y-3">
            {userSpeakers.map(({ speaker, mapping, index }) =>
              renderSpeakerMapping(speaker, mapping, index)
            )}
          </div>
        </div>
      )}

      {/* AI/Character speakers */}
      {aiSpeakers.length > 0 && (
        <div>
          <h4 className="text-sm qt-text-primary mb-3">
            AI Speakers (map to Characters)
          </h4>
          <div className="space-y-3">
            {aiSpeakers.map(({ speaker, mapping, index }) =>
              renderSpeakerMapping(speaker, mapping, index)
            )}
          </div>
        </div>
      )}

      {speakers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No speakers found in the file
        </div>
      )}
    </div>
  )
}
