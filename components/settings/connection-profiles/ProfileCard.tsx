import { ProfileCard as BaseProfileCard, ProfileCardBadge } from '@/components/ui/ProfileCard'
import { TagBadge } from '@/components/tags/tag-badge'
import { MissingApiKeyBadge } from '@/components/ui/MissingApiKeyBadge'
import { getAttachmentSupportDescription } from '@/lib/llm/attachment-support'
import { formatTokenCount } from '@/lib/utils/format-tokens'
import type { ConnectionProfile } from './types'

interface ProfileCardProps {
  profile: ConnectionProfile
  cheapDefaultProfileId: string | null
  /** Whether this profile's provider requires an API key */
  providerRequiresApiKey?: boolean
  onEdit: (profile: ConnectionProfile) => void
  onDelete: (profileId: string) => void
  deleteConfirming: string | null
  onDeleteConfirmChange: (profileId: string | null) => void
  isDeleting: boolean
}

/**
 * Individual profile card component
 * Displays profile information and action buttons
 */
export function ProfileCard({
  profile,
  cheapDefaultProfileId,
  providerRequiresApiKey = true,
  onEdit,
  onDelete,
  deleteConfirming,
  onDeleteConfirmChange,
  isDeleting,
}: ProfileCardProps) {
  // Check if API key is missing when provider requires one
  const isMissingApiKey = providerRequiresApiKey && !profile.apiKey

  // Build badges array
  const badges: ProfileCardBadge[] = []
  if (profile.isDefault) {
    badges.push({ text: 'Default', variant: 'default' })
  }
  if (profile.id === cheapDefaultProfileId) {
    badges.push({ text: 'Default Cheap', variant: 'cheapDefault' })
  } else if (profile.isCheap) {
    badges.push({ text: 'Cheap', variant: 'cheap' })
  }
  if (profile.isDangerousCompatible) {
    badges.push({ text: 'Uncensored', variant: 'destructive' })
  }

  return (
    <BaseProfileCard
      title={profile.name}
      subtitle={`${profile.provider} • ${profile.modelName}`}
      badges={badges}
      actions={[
        { label: 'Edit', onClick: () => onEdit(profile), variant: 'primary' },
      ]}
      deleteConfig={{
        isConfirming: deleteConfirming === profile.id,
        onConfirmChange: (confirming) => onDeleteConfirmChange(confirming ? profile.id : null),
        onConfirm: () => onDelete(profile.id),
        message: 'Delete this profile?',
        isDeleting: isDeleting,
      }}
    >
      {/* Missing API key warning */}
      {isMissingApiKey && (
        <div className="mt-1">
          <MissingApiKeyBadge />
        </div>
      )}

      {/* Attachment support description */}
      <p className="qt-text-xs mt-1">
        {getAttachmentSupportDescription(profile.provider as any, profile.baseUrl ?? undefined)}
      </p>

      {/* Usage stats */}
      {(profile.messageCount !== undefined || profile.totalTokens !== undefined) && (
        <div className="text-sm text-primary mt-1 font-medium">
          {profile.messageCount !== undefined && (
            <span>{profile.messageCount} message{profile.messageCount === 1 ? '' : 's'}</span>
          )}
          {profile.messageCount !== undefined && profile.totalTokens !== undefined && (
            <span className="text-muted-foreground"> • </span>
          )}
          {profile.totalTokens !== undefined && profile.totalTokens > 0 && (
            <span>{formatTokenCount(profile.totalTokens)} tokens</span>
          )}
        </div>
      )}

      {/* API Key info */}
      {profile.apiKey && (
        <p className="qt-text-small">
          API Key: {profile.apiKey.label}
        </p>
      )}

      {/* Base URL */}
      {profile.baseUrl && (
        <p className="qt-text-small">
          Base URL: {profile.baseUrl}
        </p>
      )}

      {/* Model parameters */}
      <div className="qt-text-xs mt-2">
        Temperature: {profile.parameters?.temperature ?? 0.7} •
        Max Tokens: {profile.parameters?.max_tokens ?? 1000} •
        Top P: {profile.parameters?.top_p ?? 1}
      </div>

      {/* Tags */}
      {profile.tags && profile.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {profile.tags.map((tag, index) => (
            <TagBadge key={tag.id || `tag-${index}`} tag={tag} size="sm" />
          ))}
        </div>
      )}
    </BaseProfileCard>
  )
}
