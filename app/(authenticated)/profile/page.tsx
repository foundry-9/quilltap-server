'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ProfileInfoSection,
  ProfileEditSection,
  TwoFactorSection,
  TrustedDevicesSection,
  UserProfile,
} from '@/components/profile'
import { clientLogger } from '@/lib/client-logger'

/**
 * Profile Page
 *
 * Displays and manages user profile information:
 * - Account information (read-only)
 * - Profile settings (editable: name, email, avatar)
 * - Two-factor authentication (when auth is enabled)
 * - Trusted devices (when 2FA is enabled)
 */
export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [authDisabled, setAuthDisabled] = useState(false)

  useEffect(() => {
    clientLogger.debug('ProfilePage mounted')
  }, [])

  const fetchProfile = useCallback(async () => {
    clientLogger.debug('Fetching user profile')

    try {
      const res = await fetch('/api/user/profile')
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to load profile')
      }

      const data = await res.json()
      setProfile(data)
      clientLogger.debug('Profile loaded', { userId: data.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load profile'
      setError(message)
      clientLogger.error('Failed to load profile', { error: message })
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAuthStatus = useCallback(async () => {
    clientLogger.debug('Fetching auth status for profile page')

    try {
      const res = await fetch('/api/auth/status')
      if (res.ok) {
        const data = await res.json()
        setAuthDisabled(data.authDisabled || false)
        clientLogger.debug('Auth status fetched', { authDisabled: data.authDisabled })
      }
    } catch (err) {
      clientLogger.error('Failed to fetch auth status', { error: err })
      // Default to showing 2FA section if we can't determine auth status
    }
  }, [])

  useEffect(() => {
    fetchProfile()
    fetchAuthStatus()
  }, [fetchProfile, fetchAuthStatus])

  const handleProfileUpdate = (updatedProfile: UserProfile) => {
    setProfile(updatedProfile)
    clientLogger.debug('Profile state updated', { userId: updatedProfile.id })
  }

  const handleTotpStatusChange = (enabled: boolean) => {
    if (profile) {
      setProfile({ ...profile, totpEnabled: enabled })
      clientLogger.debug('TOTP status changed', { enabled })
    }
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
        <Link href="/dashboard" className="qt-button qt-button-secondary mt-4 inline-block">
          Return to Dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="qt-page-container">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center text-sm font-medium text-primary transition hover:text-primary/80"
        >
          ← Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="qt-text-muted mt-2">
          Manage your account settings and security preferences
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile Edit Section (editable fields first) */}
        <ProfileEditSection profile={profile} onProfileUpdate={handleProfileUpdate} />

        {/* Account Information (read-only) */}
        <ProfileInfoSection profile={profile} />

        {/* Two-Factor Authentication (only when auth is enabled) */}
        {!authDisabled && (
          <TwoFactorSection
            totpEnabled={profile.totpEnabled}
            onStatusChange={handleTotpStatusChange}
          />
        )}

        {/* Trusted Devices (only when 2FA is enabled) */}
        {!authDisabled && (
          <TrustedDevicesSection totpEnabled={profile.totpEnabled} />
        )}

        {/* Auth Disabled Notice */}
        {authDisabled && (
          <div className="qt-card">
            <div className="qt-card-content">
              <div className="qt-alert-info">
                <p className="font-medium">Authentication Disabled</p>
                <p className="text-sm mt-1">
                  Two-factor authentication and trusted devices are not available when
                  authentication is disabled. The application is currently in local-only mode.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
