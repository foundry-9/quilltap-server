'use client'

import { useState } from 'react'
import { fetchJson } from '@/lib/fetch-helpers'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { ProfileCard, ProfileCardBadge, ProfileCardMetadata } from '@/components/ui/ProfileCard'
import { ProviderBadge } from './ProviderBadge'
import { MissingApiKeyBadge } from '@/components/ui/MissingApiKeyBadge'
import type { EmbeddingProfile } from './types'

interface ProfileListProps {
  profiles: EmbeddingProfile[]
  onEdit: (profile: EmbeddingProfile) => void
  onProfilesChange: () => Promise<void>
}

/**
 * List component for displaying embedding profiles with edit/delete actions
 */
export function ProfileList({
  profiles,
  onEdit,
  onProfilesChange,
}: ProfileListProps) {
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null)

  const {
    loading: deleteLoading,
    error: deleteError,
    execute: executeDelete,
    clearError: clearDeleteError,
  } = useAsyncOperation<void>()

  const handleDelete = async (id: string) => {
    await executeDelete(async () => {
      const result = await fetchJson('/api/v1/embedding-profiles/' + id, { method: 'DELETE' })
      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete profile')
      }
      await onProfilesChange()
      setDeleteConfirming(null)
    })
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        title="No embedding profiles yet"
        description="Embedding profiles are used for semantic search in memories"
        action={{
          label: 'Create First Profile',
          onClick: () => {
            onEdit({} as EmbeddingProfile)
          },
        }}
      />
    )
  }

  return (
    <div className="qt-card-grid-auto">
      {deleteError && (
        <ErrorAlert
          message={deleteError}
          onRetry={clearDeleteError}
        />
      )}

      {profiles.slice().sort((a, b) => a.name.localeCompare(b.name)).map(profile => {
        // Build badges array
        const badges: ProfileCardBadge[] = []
        if (profile.isDefault) {
          badges.push({ text: 'Default', variant: 'default' })
        }

        // Build metadata array
        const metadata: ProfileCardMetadata[] = [
          { label: 'Model', value: <span className="font-mono text-sm text-foreground">{profile.modelName}</span> },
        ]
        if (profile.dimensions) {
          metadata.push({ label: 'Dimensions', value: profile.dimensions.toString() })
        }
        if (profile.apiKey) {
          metadata.push({ label: 'API Key', value: profile.apiKey.label })
        }
        if (profile.baseUrl) {
          metadata.push({ label: 'Base URL', value: profile.baseUrl })
        }

        return (
          <ProfileCard
            key={profile.id}
            title={profile.name}
            badges={badges}
            metadata={metadata}
            actions={[
              { label: 'Edit', onClick: () => onEdit(profile), variant: 'secondary' },
            ]}
            deleteConfig={{
              isConfirming: deleteConfirming === profile.id,
              onConfirmChange: (confirming) => setDeleteConfirming(confirming ? profile.id : null),
              onConfirm: () => handleDelete(profile.id),
              message: 'Delete this profile?',
              isDeleting: deleteLoading,
            }}
          >
            {/* Custom content: Provider badge and missing API key warning */}
            <div className="flex items-center gap-2 mt-1 mb-2">
              <ProviderBadge provider={profile.provider} />
              {profile.provider === 'OPENAI' && !profile.apiKey && (
                <MissingApiKeyBadge />
              )}
            </div>
          </ProfileCard>
        )
      })}
    </div>
  )
}
