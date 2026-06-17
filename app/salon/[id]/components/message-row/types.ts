/**
 * Shared types for the MessageRow subcomponents.
 */

export interface MessageAvatarInfo {
  name: string
  title: string | null | undefined
  avatarUrl?: string
  defaultImage?: { id: string; filepath: string; url?: string } | null | undefined
}
