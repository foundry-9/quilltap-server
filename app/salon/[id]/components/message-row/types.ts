/**
 * Shared types for the MessageRow subcomponents.
 */

export interface MessageAvatarInfo {
  name: string
  /** The character behind the avatar, when there is one — keys what they carry. */
  characterId?: string | null
  title: string | null | undefined
  avatarUrl?: string
  defaultImage?: { id: string; filepath: string; url?: string } | null | undefined
}
