import { ProfileCard } from './ProfileCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader } from '@/components/ui/SectionHeader'
import type { ConnectionProfile, ProviderConfig } from './types'

interface ProfileListProps {
  profiles: ConnectionProfile[]
  cheapDefaultProfileId: string | null
  /** List of provider configurations to check API key requirements */
  providers?: ProviderConfig[]
  showForm: boolean
  deleteConfirming: string | null
  isDeleting: boolean
  onEdit: (profile: ConnectionProfile) => void
  onDelete: (profileId: string) => void
  onDeleteConfirmChange: (profileId: string | null) => void
  onAddClick: () => void
}

/**
 * List of connection profile cards
 * Displays all profiles with sorting and empty state
 */
export function ProfileList({
  profiles,
  cheapDefaultProfileId,
  providers = [],
  showForm,
  deleteConfirming,
  isDeleting,
  onEdit,
  onDelete,
  onDeleteConfirmChange,
  onAddClick,
}: ProfileListProps) {
  // Helper to check if a provider requires an API key
  const providerRequiresApiKey = (providerName: string): boolean => {
    const provider = providers.find((p) => p.name === providerName)
    // Default to true (safer) if provider not found
    return provider?.configRequirements?.requiresApiKey ?? true
  }
  return (
    <div className="mb-8">
      <SectionHeader
        title="Connection Profiles"
        count={profiles.length}
        level="h2"
        action={{
          label: '+ Add Profile',
          onClick: onAddClick,
          show: !showForm,
        }}
      />

      {profiles.length === 0 ? (
        <EmptyState
          title="No connection profiles yet"
          description="Create one to start chatting."
          action={{
            label: 'Create Profile',
            onClick: onAddClick,
          }}
        />
      ) : (
        <div className="qt-card-grid-auto">
          {profiles
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                cheapDefaultProfileId={cheapDefaultProfileId}
                providerRequiresApiKey={providerRequiresApiKey(profile.provider)}
                onEdit={onEdit}
                onDelete={onDelete}
                deleteConfirming={deleteConfirming}
                onDeleteConfirmChange={onDeleteConfirmChange}
                isDeleting={isDeleting}
              />
            ))}
        </div>
      )}
    </div>
  )
}
