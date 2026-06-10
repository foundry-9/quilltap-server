'use client'

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { formatDateTime } from '@/lib/format-time'
import { Icon } from '@/components/ui/icon'
import { UserProfile } from './types'

export interface ProfileInfoSectionProps {
  profile: UserProfile
}

function formatDate(dateStr: string | null): string {
  return formatDateTime(dateStr, { monthStyle: 'long' }) || 'Never'
}

/**
 * Single info field with optional copy button
 */
function InfoField({
  label,
  value,
  copyable = false,
}: {
  label: string
  value: string
  copyable?: boolean
}) {
  const { copied, copy } = useCopyToClipboard()
  const handleCopy = () => copy(value)

  return (
    <div className="flex items-center justify-between py-3 border-b qt-border-default last:border-b-0">
      <div>
        <dt className="qt-text-label text-sm">{label}</dt>
        <dd className="qt-text-primary font-mono text-sm mt-1">{value}</dd>
      </div>
      {copyable && (
        <button
          onClick={handleCopy}
          className={`qt-copy-button qt-copy-button-icon ml-2 ${copied ? 'qt-copy-button-success' : ''}`}
          title="Copy to clipboard"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Icon name="check" className="w-4 h-4" />
          ) : (
            <Icon name="copy" className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  )
}

/**
 * ProfileInfoSection Component
 *
 * Displays read-only user profile information:
 * - User ID (copyable)
 * - Username
 * - Email Verified date
 * - Created At
 * - Updated At
 */
export function ProfileInfoSection({ profile }: ProfileInfoSectionProps) {
  return (
    <div className="qt-card">
      <div className="qt-card-header">
        <h2 className="text-xl font-semibold">Account Information</h2>
        <p className="qt-text-muted text-sm mt-1">
          System information about your account
        </p>
      </div>
      <div className="qt-card-content">
        <dl>
          <InfoField label="User ID" value={profile.id} copyable />
          <InfoField label="Username" value={profile.username} />
          <InfoField label="Account Created" value={formatDate(profile.createdAt)} />
          <InfoField label="Last Updated" value={formatDate(profile.updatedAt)} />
        </dl>
      </div>
    </div>
  )
}
