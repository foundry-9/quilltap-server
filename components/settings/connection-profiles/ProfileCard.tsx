import { DeleteConfirmPopover } from '@/components/ui/DeleteConfirmPopover'
import { TagBadge } from '@/components/tags/tag-badge'
import { MissingApiKeyBadge } from '@/components/ui/MissingApiKeyBadge'
import { getAttachmentSupportDescription } from '@/lib/llm/attachment-support'
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
  // Show warning if: (provider requires key AND no apiKey object) OR (apiKeyId was set but key was deleted)
  const isMissingApiKey = providerRequiresApiKey && !profile.apiKey
  return (
    <div className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="qt-text-primary">{profile.name}</p>
            {profile.isDefault && (
              <span className="px-2 py-1 bg-green-100/50 text-green-700 text-xs rounded-full">
                Default
              </span>
            )}
            {profile.id === cheapDefaultProfileId && (
              <span className="px-2 py-1 bg-indigo-100/50 text-indigo-700 text-xs rounded-full">
                Default Cheap
              </span>
            )}
            {profile.isCheap && profile.id !== cheapDefaultProfileId && (
              <span className="px-2 py-1 bg-amber-100/50 text-amber-700 text-xs rounded-full">
                Cheap
              </span>
            )}
            {isMissingApiKey && <MissingApiKeyBadge />}
          </div>
          <p className="qt-text-small mt-1">
            {profile.provider} • {profile.modelName}
          </p>
          <p className="qt-text-xs mt-1">
            {getAttachmentSupportDescription(profile.provider as any, profile.baseUrl ?? undefined)}
          </p>
          {profile.messageCount !== undefined && (
            <p className="text-sm text-primary mt-1 font-medium">
              {profile.messageCount} message{profile.messageCount === 1 ? '' : 's'} used
            </p>
          )}
          {profile.apiKey && (
            <p className="qt-text-small">
              API Key: {profile.apiKey.label}
            </p>
          )}
          {profile.baseUrl && (
            <p className="qt-text-small">
              Base URL: {profile.baseUrl}
            </p>
          )}
          <div className="qt-text-xs mt-2">
            Temperature: {profile.parameters?.temperature ?? 0.7} •
            Max Tokens: {profile.parameters?.max_tokens ?? 1000} •
            Top P: {profile.parameters?.top_p ?? 1}
          </div>
          {profile.tags && profile.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {profile.tags.map((tag, index) => (
                <TagBadge key={tag.id || `tag-${index}`} tag={tag} size="sm" />
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(profile)}
            className="px-3 py-1 text-sm bg-primary/10 text-primary rounded hover:bg-primary/20"
          >
            Edit
          </button>
          <div className="relative">
            <button
              onClick={() => onDeleteConfirmChange(deleteConfirming === profile.id ? null : profile.id)}
              className="px-3 py-1 text-sm text-destructive hover:bg-destructive/10 rounded border border-destructive/50 hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive"
            >
              Delete
            </button>

            {/* Delete Confirmation Popover */}
            <DeleteConfirmPopover
              isOpen={deleteConfirming === profile.id}
              onCancel={() => onDeleteConfirmChange(null)}
              onConfirm={() => onDelete(profile.id)}
              message="Delete this profile?"
              isDeleting={isDeleting}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
