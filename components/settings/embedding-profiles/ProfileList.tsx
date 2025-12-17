'use client'

import { useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { fetchJson } from '@/lib/fetch-helpers'
import { useAsyncOperation } from '@/hooks/useAsyncOperation'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'
import { ProviderBadge } from './ProviderBadge'
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
    clientLogger.debug('Deleting embedding profile', { profileId: id })
    await executeDelete(async () => {
      const result = await fetchJson('/api/embedding-profiles/' + id, { method: 'DELETE' })
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
            clientLogger.debug('Creating first profile')
            onEdit({} as EmbeddingProfile)
          },
        }}
      />
    )
  }

  return (
    <div className="space-y-3">
      {deleteError && (
        <ErrorAlert
          message={deleteError}
          onRetry={clearDeleteError}
        />
      )}

      {profiles.toSorted((a, b) => a.name.localeCompare(b.name)).map(profile => (
        <div
          key={profile.id}
          className="border border-border rounded-lg p-4 hover:border-border/70 transition bg-card"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="qt-text-primary">{profile.name}</h3>
                <ProviderBadge provider={profile.provider} />
                {profile.isDefault && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100/50 text-green-700">
                    Default
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 qt-text-small">
                <div>
                  <p className="qt-text-xs uppercase">Model</p>
                  <p className="font-mono text-sm text-foreground">{profile.modelName}</p>
                </div>
                {profile.dimensions && (
                  <div>
                    <p className="qt-text-xs uppercase">Dimensions</p>
                    <p className="text-sm text-foreground">{profile.dimensions}</p>
                  </div>
                )}
                {profile.apiKey && (
                  <div>
                    <p className="qt-text-xs uppercase">API Key</p>
                    <p className="text-sm text-foreground">{profile.apiKey.label}</p>
                  </div>
                )}
                {profile.baseUrl && (
                  <div>
                    <p className="qt-text-xs uppercase">Base URL</p>
                    <p className="text-sm text-foreground">{profile.baseUrl}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 ml-4">
              <button
                onClick={() => onEdit(profile)}
                className="px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded border border-primary/50 hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Edit
              </button>
              <div className="relative">
                <button
                  onClick={() => setDeleteConfirming(deleteConfirming === profile.id ? null : profile.id)}
                  className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded border border-destructive/50 hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive"
                >
                  Delete
                </button>

                {/* Delete Confirmation Popover */}
                <DeleteConfirmPopover
                  isOpen={deleteConfirming === profile.id}
                  onCancel={() => setDeleteConfirming(null)}
                  onConfirm={() => handleDelete(profile.id)}
                  message="Delete this profile?"
                  isDeleting={deleteLoading}
                />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
