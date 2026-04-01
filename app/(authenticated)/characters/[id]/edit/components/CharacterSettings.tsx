'use client'

import { CharacterFormData, ConnectionProfile, Persona } from '../types'
import { usePersonaDisplayName } from '@/hooks/usePersonaDisplayName'

interface CharacterSettingsProps {
  formData: CharacterFormData
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  profiles: ConnectionProfile[]
  personas: Persona[]
  defaultPersonaId: string
  onDefaultPersonaChange: (personaId: string) => void
  loadingPersonas: boolean
}

/**
 * Component for editing character advanced settings
 * Includes connection profiles and default persona selection
 */
export function CharacterSettings({
  formData,
  onChange,
  profiles,
  personas,
  defaultPersonaId,
  onDefaultPersonaChange,
  loadingPersonas,
}: CharacterSettingsProps) {
  const { formatPersonaName } = usePersonaDisplayName()

  return (
    <div className="space-y-6">
      {/* Default Connection Profile */}
      <div>
        <label htmlFor="defaultConnectionProfileId" className="block text-sm font-medium mb-2 text-foreground">
          Default Connection Profile (Optional)
        </label>
        <select
          id="defaultConnectionProfileId"
          name="defaultConnectionProfileId"
          value={formData.defaultConnectionProfileId}
          onChange={onChange}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">No default profile</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <p className="mt-1 qt-text-xs">Can be overridden for individual chats</p>
      </div>

      {/* Default Persona Selector */}
      <div>
        <label htmlFor="defaultPersona" className="block text-sm font-medium mb-2 text-foreground">
          Default Persona (Optional)
        </label>
        {loadingPersonas ? (
          <p className="qt-text-small">Loading personas...</p>
        ) : personas.length > 0 ? (
          <>
            <select
              id="defaultPersona"
              value={defaultPersonaId}
              onChange={(e) => onDefaultPersonaChange(e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">No default persona</option>
              {personas.map((persona) => {
                const displayName = formatPersonaName(persona)
                const tagCount = persona.matchingTagCount
                const plural = tagCount === 1 ? '' : 's'
                const tagSuffix = tagCount ? ` — ${tagCount} shared tag${plural}` : ''
                return (
                  <option key={persona.id} value={persona.id}>
                    {displayName}
                    {tagSuffix}
                  </option>
                )
              })}
            </select>
            <p className="mt-1 qt-text-xs">Personas are sorted by number of tags shared with this character</p>
          </>
        ) : (
          <p className="qt-text-small">No personas available. Create a persona first.</p>
        )}
      </div>
    </div>
  )
}
