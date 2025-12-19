/**
 * Profile Component Types
 *
 * Shared types for the profile page and its components
 */

export interface UserProfile {
  id: string
  username: string
  email: string | null
  name: string | null
  image: string | null
  emailVerified: string | null
  createdAt: string
  updatedAt: string
  totpEnabled: boolean
}

export interface TrustedDevice {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export interface EncryptedTOTPData {
  secret: string
  iv: string
  authTag: string
}
