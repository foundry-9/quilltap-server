'use client'

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { ProviderIcon } from './ProviderIcon'

interface ApiKey {
  id: string
  label: string
  provider: string
  isActive: boolean
}

interface ImageProfile {
  id: string
  name: string
  provider: string
  modelName: string
  isDefault: boolean
  apiKey?: ApiKey | null
  tags?: any[]
}

interface ImageProfilePickerProps {
  value?: string | null
  onChange?: (profileId: string | null) => void
  characterId?: string
  userCharacterId?: string
  disabled?: boolean
  /**
   * When nothing is selected yet, select the instance's default profile once
   * the list loads (a one-off image generator). Leave off where an empty
   * value means something — "use the fallback chain" or "none".
   */
  preselectDefault?: boolean
}

export function ImageProfilePicker({
  value,
  onChange,
  characterId,
  userCharacterId,
  disabled,
  preselectDefault,
}: ImageProfilePickerProps) {
  // The server orders the list by tag match for the given characters, so the
  // fetch is keyed on them; the key sits under `imageProfiles.all`, so a profile
  // created or deleted anywhere refreshes this picker.
  const {
    data: profiles = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: queryKeys.imageProfiles.sorted(characterId, userCharacterId),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams()
      if (characterId) params.set('sortByCharacter', characterId)
      if (userCharacterId) params.set('sortByUserCharacter', userCharacterId)
      const query = params.toString()
      return apiFetch<{ profiles?: ImageProfile[] }>(
        `/api/v1/image-profiles${query ? `?${query}` : ''}`,
        { signal },
      )
    },
    select: (data) => data.profiles ?? [],
  })
  const error = queryError ? queryError.message || 'Failed to fetch profiles' : null

  const preselected = useRef(false)
  useEffect(() => {
    if (!preselectDefault || preselected.current || loading || value) return
    const fallback = profiles.find(p => p.isDefault && p.apiKey)
    if (!fallback) return
    preselected.current = true
    onChange?.(fallback.id)
  }, [preselectDefault, loading, value, profiles, onChange])

  if (loading) {
    return (
      <div className="flex items-center gap-2 qt-text-secondary">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-ring border-r-transparent"></div>
        Loading profiles...
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <select
        aria-label="Image profile"
        value={value || ''}
        onChange={e => onChange?.(e.target.value || null)}
        disabled={disabled}
        className="w-full px-3 py-2 border qt-border-default qt-bg-card text-foreground rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        <option value="">No image generation</option>
        {profiles.map(profile => {
          const hasApiKey = Boolean(profile.apiKey)
          return (
            <option key={profile.id} value={profile.id}>
              {profile.name} ({profile.modelName})
              {profile.isDefault ? ' [Default]' : ''}
              {!hasApiKey ? ' ⚠️ No API Key' : ''}
            </option>
          )
        })}
      </select>

      {error && <p className="qt-text-destructive text-sm">{error}</p>}

      {profiles.length === 0 && !loading && !error && (
        <p className="text-sm qt-text-secondary">
          No image profiles available. Create one in Settings first.
        </p>
      )}

      {/* Show selected profile details */}
      {value && profiles.length > 0 && (
        <div className="mt-3 p-3 rounded-md border qt-bg-info/10 qt-border-info">
          {(() => {
            const selected = profiles.find(p => p.id === value)
            if (!selected) return null

            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ProviderIcon provider={selected.provider} />
                  <div>
                    <p className="font-medium text-sm text-foreground">{selected.name}</p>
                    <p className="text-xs qt-text-secondary">{selected.modelName}</p>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
