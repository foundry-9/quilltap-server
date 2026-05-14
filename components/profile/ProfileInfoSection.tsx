'use client'

import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { UserProfile } from './types'

export interface ProfileInfoSectionProps {
  profile: UserProfile
}

/**
 * Format a date string for display
 */
function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Copy icon SVG
 */
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

/**
 * Check icon SVG
 */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
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
            <CheckIcon className="w-4 h-4" />
          ) : (
            <CopyIcon className="w-4 h-4" />
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
