'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { UserProfile } from './types'
import { AvatarSelector } from '@/components/images/avatar-selector'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'

export interface ProfileEditSectionProps {
  profile: UserProfile
  onProfileUpdate: (profile: UserProfile) => void
}

/**
 * Edit icon SVG
 */
function EditIcon({ className }: { className?: string }) {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

/**
 * User icon SVG (for placeholder avatar)
 */
function UserIcon({ className }: { className?: string }) {
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
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

/**
 * ProfileEditSection Component
 *
 * Allows editing user profile fields:
 * - Display Name
 * - Email
 * - Profile Image (via avatar selector)
 */
export function ProfileEditSection({
  profile,
  onProfileUpdate,
}: ProfileEditSectionProps) {
  const [name, setName] = useState(profile.name || '')
  const [email, setEmail] = useState(profile.email || '')
  const [saving, setSaving] = useState(false)
  const [showAvatarSelector, setShowAvatarSelector] = useState(false)
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0)

  useEffect(() => {
    clientLogger.debug('ProfileEditSection mounted', { userId: profile.id })
  }, [profile.id])

  const handleSave = async () => {
    setSaving(true)
    clientLogger.debug('Saving profile', { name, email })

    try {
      const res = await fetch('/api/v1/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || null,
          email: email || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      const data = await res.json()
      const updatedProfile = data.profile || data
      clientLogger.info('Profile updated successfully', { userId: profile.id })
      onProfileUpdate(updatedProfile)
      showSuccessToast('Profile updated successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update profile'
      clientLogger.error('Failed to update profile', { error: message })
      showErrorToast(message)
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarSelect = async (imageId: string) => {
    clientLogger.debug('Updating profile avatar', { imageId })

    try {
      const res = await fetch('/api/v1/user/profile?action=set-avatar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: imageId || null }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update avatar')
      }

      const avatarData = await res.json()
      const updatedProfile = avatarData.profile || avatarData
      clientLogger.info('Profile avatar updated', { userId: profile.id, imageId })
      onProfileUpdate(updatedProfile)
      setAvatarRefreshKey((k) => k + 1)
      setShowAvatarSelector(false)
      showSuccessToast('Avatar updated successfully')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update avatar'
      clientLogger.error('Failed to update avatar', { error: message })
      showErrorToast(message)
    }
  }

  const hasChanges = name !== (profile.name || '') || email !== (profile.email || '')

  // Build avatar src with cache busting
  const getAvatarSrc = () => {
    if (!profile.image) return null
    // Add cache-busting parameter
    const separator = profile.image.includes('?') ? '&' : '?'
    return `${profile.image}${separator}v=${avatarRefreshKey}`
  }

  const avatarSrc = getAvatarSrc()

  return (
    <>
      <div className="qt-card">
        <div className="qt-card-header">
          <h2 className="text-xl font-semibold">Profile Settings</h2>
          <p className="qt-text-muted text-sm mt-1">
            Manage your personal information
          </p>
        </div>
        <div className="qt-card-content space-y-6">
          {/* Avatar Section */}
          <div className="flex items-center gap-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full overflow-hidden bg-muted flex items-center justify-center">
                {avatarSrc ? (
                  <Image
                    key={avatarRefreshKey}
                    src={avatarSrc}
                    alt={profile.name || 'Profile'}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                ) : (
                  <UserIcon className="w-12 h-12 text-muted-foreground" />
                )}
              </div>
              <button
                onClick={() => setShowAvatarSelector(true)}
                className="absolute bottom-0 right-0 p-2 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
                title="Change avatar"
                aria-label="Change avatar"
              >
                <EditIcon className="w-4 h-4" />
              </button>
            </div>
            <div>
              <p className="font-medium">{profile.name || profile.username}</p>
              <p className="qt-text-muted text-sm">{profile.email || 'No email set'}</p>
              <button
                onClick={() => setShowAvatarSelector(true)}
                className="qt-button qt-button-ghost text-sm mt-2"
              >
                Change avatar
              </button>
            </div>
          </div>

          {/* Name Field */}
          <div>
            <label htmlFor="profile-name" className="qt-label block mb-2">
              Display Name
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your display name"
              className="qt-input w-full"
              maxLength={100}
            />
            <p className="qt-text-xs text-muted-foreground mt-1">
              This name is displayed throughout the application
            </p>
          </div>

          {/* Email Field */}
          <div>
            <label htmlFor="profile-email" className="qt-label block mb-2">
              Email Address
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              className="qt-input w-full"
            />
            <p className="qt-text-xs text-muted-foreground mt-1">
              Your email may be used for account recovery
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-border">
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="qt-button qt-button-primary"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Avatar Selector Modal */}
      <AvatarSelector
        isOpen={showAvatarSelector}
        onClose={() => setShowAvatarSelector(false)}
        onSelect={handleAvatarSelect}
        currentImageId={profile.image?.split('/').pop()?.split('?')[0]}
      />
    </>
  )
}
