/**
 * Profile Component Types
 *
 * Shared types for the profile page and its components (single-user mode)
 */

export interface UserProfile {
  id: string
  username: string
  email: string | null
  name: string | null
  image: string | null
  createdAt: string
  updatedAt: string
}
