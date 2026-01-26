'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ProfileInfoSection,
  ProfileEditSection,
  UserProfile,
} from '@/components/profile'

/**
 * Profile Page (Single-User Mode)
 *
 * Displays and manages user profile information:
 * - Account information (read-only)
 * - Profile settings (editable: name, email, avatar)
 */
export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/user/profile')
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to load profile')
      }

      const data = await res.json()
      const profile = data.profile || data
      setProfile(profile)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profile'
      setError(message)
      console.error('Failed to load profile', { error: message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const handleProfileUpdate = (updatedProfile: UserProfile) => {
    setProfile(updatedProfile)
  }

  if (loading) {
    return (
      <div className="qt-page-container">
        <div className="flex items-center justify-center py-12">
          <div className="qt-text-muted">Loading profile...</div>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="qt-page-container">
        <div className="qt-alert-error">
          {error || 'Failed to load profile'}
        </div>
        <Link href="/" className="qt-button qt-button-secondary mt-4 inline-block">
          Return to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="qt-page-container">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
        >
          ← Back to Home
        </Link>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="qt-text-muted mt-2">
          Manage your profile settings
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile Edit Section (editable fields first) */}
        <ProfileEditSection profile={profile} onProfileUpdate={handleProfileUpdate} />

        {/* Account Information (read-only) */}
        <ProfileInfoSection profile={profile} />
      </div>
    </div>
  )
}
